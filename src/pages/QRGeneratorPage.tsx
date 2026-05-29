import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  QrCode,
  Download,
  RefreshCw,
  Package,
  Link,
  CreditCard,
  User,
  Search,
  Copy,
  Printer,
  Plus,
  Globe,
  Smartphone,
  Mail,
  Phone as PhoneIcon,
  MapPin,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
}

interface QRPreset {
  id: string;
  type: string;
  label: string;
  content: string;
  color: string;
  bgColor: string;
  size: number;
  createdAt: number;
}

// ─── QR Rendering (via QRCode.js via CDN script) ─────────────────────────────
// We use the qrcode-generator approach via canvas — bundled via qrcode package from npm

function generateQRDataURL(text: string, size: number, fgColor: string, bgColor: string): string {
  // Build SVG-based QR manually using the fetch approach
  // Since qrcode lib may not be available, we use a URL-based approach via Google Charts API
  // For production, use qrcode npm package
  const encodedText = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodedText}&color=${fgColor.replace("#", "")}&bgcolor=${bgColor.replace("#", "")}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const QR_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; placeholder: string; description: string }> = {
  url: { label: "URL / Link", icon: Globe, placeholder: "https://mitienda.com", description: "Abre un sitio web" },
  product: { label: "Producto", icon: Package, placeholder: "Seleccionar producto", description: "Ficha de producto" },
  payment: { label: "Link de pago", icon: CreditCard, placeholder: "https://pagar.me/link", description: "Botón de pago" },
  vcard: { label: "vCard (contacto)", icon: User, placeholder: "Juan Pérez", description: "Agrega contacto" },
  whatsapp: { label: "WhatsApp", icon: Smartphone, placeholder: "+54911XXXXXXXX", description: "Abre chat directo" },
  email: { label: "Email", icon: Mail, placeholder: "info@empresa.com", description: "Redactar email" },
  wifi: { label: "WiFi", icon: Smartphone, placeholder: "MiRedWifi", description: "Conectar a red" },
  location: { label: "Ubicación", icon: MapPin, placeholder: "-34.603722,-58.381592", description: "Abre Google Maps" },
};

const COLOR_PRESETS = [
  { fg: "#000000", bg: "#ffffff", name: "Clásico" },
  { fg: "#1a1a2e", bg: "#ffffff", name: "Marino" },
  { fg: "#6366f1", bg: "#ffffff", name: "Violeta" },
  { fg: "#10b981", bg: "#ffffff", name: "Verde" },
  { fg: "#ef4444", bg: "#ffffff", name: "Rojo" },
  { fg: "#f59e0b", bg: "#1a1a1a", name: "Dorado" },
  { fg: "#ffffff", bg: "#000000", name: "Inverso" },
  { fg: "#ffffff", bg: "#6366f1", name: "Morado BG" },
];

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ─── vCard builder ────────────────────────────────────────────────────────────

interface VCardData {
  name: string;
  company: string;
  phone: string;
  email: string;
  url: string;
  address: string;
}

function buildVCard(data: VCardData) {
  return [
    "BEGIN:VCARD", "VERSION:3.0",
    `FN:${data.name}`,
    data.company ? `ORG:${data.company}` : "",
    data.phone ? `TEL:${data.phone}` : "",
    data.email ? `EMAIL:${data.email}` : "",
    data.url ? `URL:${data.url}` : "",
    data.address ? `ADR:;;${data.address};;;;` : "",
    "END:VCARD",
  ].filter(Boolean).join("\n");
}

// ─── WiFi builder ─────────────────────────────────────────────────────────────

function buildWifi(ssid: string, password: string, type = "WPA") {
  return `WIFI:T:${type};S:${ssid};P:${password};;`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QRGeneratorPage() {
  usePageTitle("Generador de QR");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [searchProd, setSearchProd] = useState("");
  const [qrType, setQRType] = useState("url");
  const [qrContent, setQRContent] = useState("https://");
  const [qrSize, setQRSize] = useState(300);
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [savedQRs, setSavedQRs] = useState<QRPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem("gestiona_qr_presets") ?? "[]"); } catch { return []; }
  });
  const [customLabel, setCustomLabel] = useState("");

  // vCard fields
  const [vcName, setVcName] = useState("");
  const [vcCompany, setVcCompany] = useState("");
  const [vcPhone, setVcPhone] = useState("");
  const [vcEmail, setVcEmail] = useState("");
  const [vcUrl, setVcUrl] = useState("");
  const [vcAddress, setVcAddress] = useState("");

  // WiFi fields
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiPass, setWifiPass] = useState("");

  // Batch product QRs
  const [batchProductIds, setBatchProductIds] = useState<string[]>([]);

  useEffect(() => {
    if (!orgId) return;
    supabase.from("products").select("id,name,price,sku,barcode,image_url").eq("org_id", orgId).order("name")
      .then(({ data }) => setProducts(data ?? []));
  }, [orgId]);

  // Compute effective QR content
  const effectiveContent = useMemo(() => {
    switch (qrType) {
      case "vcard": return buildVCard({ name: vcName, company: vcCompany, phone: vcPhone, email: vcEmail, url: vcUrl, address: vcAddress });
      case "whatsapp": return `https://wa.me/${qrContent.replace(/\D/g, "")}`;
      case "email": return `mailto:${qrContent}`;
      case "wifi": return buildWifi(wifiSSID, wifiPass);
      case "location": return `geo:${qrContent}`;
      default: return qrContent;
    }
  }, [qrType, qrContent, vcName, vcCompany, vcPhone, vcEmail, vcUrl, vcAddress, wifiSSID, wifiPass]);

  const qrImageURL = useMemo(() => {
    if (!effectiveContent || effectiveContent.length < 2) return null;
    return generateQRDataURL(effectiveContent, qrSize, fgColor, bgColor);
  }, [effectiveContent, qrSize, fgColor, bgColor]);

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.click();
  };

  const handleSave = () => {
    if (!effectiveContent) return;
    const preset: QRPreset = {
      id: crypto.randomUUID(),
      type: qrType,
      label: customLabel || (QR_TYPE_CONFIG[qrType]?.label ?? qrType),
      content: effectiveContent,
      color: fgColor,
      bgColor,
      size: qrSize,
      createdAt: Date.now(),
    };
    const updated = [preset, ...savedQRs].slice(0, 20);
    setSavedQRs(updated);
    localStorage.setItem("gestiona_qr_presets", JSON.stringify(updated));
    toast.success("QR guardado");
  };

  const handleDeleteSaved = (id: string) => {
    const updated = savedQRs.filter(q => q.id !== id);
    setSavedQRs(updated);
    localStorage.setItem("gestiona_qr_presets", JSON.stringify(updated));
  };

  const filteredProds = products.filter(p =>
    !searchProd || p.name.toLowerCase().includes(searchProd.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(searchProd.toLowerCase())
  ).slice(0, 10);

  const typeConfig = QR_TYPE_CONFIG[qrType];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={QrCode}
        title="Generador de QR"
        description="Creá QR para productos, pagos, contactos, WiFi y más"
      />

      <Tabs defaultValue="generator">
        <TabsList>
          <TabsTrigger value="generator">Generador</TabsTrigger>
          <TabsTrigger value="products">QR por Producto ({products.length})</TabsTrigger>
          <TabsTrigger value="saved">Guardados ({savedQRs.length})</TabsTrigger>
        </TabsList>

        {/* ── Generator ── */}
        <TabsContent value="generator" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Controls */}
            <div className="space-y-4 pb-12">
              <div>
                <Label>Tipo de QR</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {Object.entries(QR_TYPE_CONFIG).map(([k, v]) => {
                    const Icon = v.icon;
                    return (
                      <button
                        key={k}
                        onClick={() => { setQRType(k); if (k !== "vcard" && k !== "wifi") setQRContent(""); }}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-all ${qrType === k ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/30"}`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Content by type */}
              {qrType === "vcard" ? (
                <div className="space-y-3 border border-border rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Datos de contacto</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Nombre</Label><Input value={vcName} onChange={e => setVcName(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Empresa</Label><Input value={vcCompany} onChange={e => setVcCompany(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Teléfono</Label><Input value={vcPhone} onChange={e => setVcPhone(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Email</Label><Input value={vcEmail} onChange={e => setVcEmail(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Sitio web</Label><Input value={vcUrl} onChange={e => setVcUrl(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Dirección</Label><Input value={vcAddress} onChange={e => setVcAddress(e.target.value)} className="h-8" /></div>
                  </div>
                </div>
              ) : qrType === "wifi" ? (
                <div className="space-y-3 border border-border rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Red WiFi</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Nombre de red (SSID)</Label><Input value={wifiSSID} onChange={e => setWifiSSID(e.target.value)} className="h-8" /></div>
                    <div><Label className="text-xs">Contraseña</Label><Input type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} className="h-8" /></div>
                  </div>
                </div>
              ) : (
                <div>
                  <Label>{typeConfig?.label}</Label>
                  <Input
                    value={qrContent}
                    onChange={e => setQRContent(e.target.value)}
                    placeholder={typeConfig?.placeholder ?? "Contenido del QR"}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{typeConfig?.description}</p>
                </div>
              )}

              <div>
                <Label>Etiqueta (opcional)</Label>
                <Input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Nombre para identificar este QR" />
              </div>

              {/* Style */}
              <div className="space-y-3 border border-border rounded-lg p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Estilo</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map(cp => (
                    <button
                      key={cp.name}
                      onClick={() => { setFgColor(cp.fg); setBgColor(cp.bg); }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${fgColor === cp.fg && bgColor === cp.bg ? "border-primary" : "border-border"}`}
                    >
                      <div className="w-3 h-3 rounded-full" style={{ background: cp.fg, border: `1px solid ${cp.bg === "#ffffff" ? "#e2e8f0" : cp.bg}` }} />
                      {cp.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <Label className="text-xs">Color QR</Label>
                    <input type="color" value={fgColor} onChange={e => setFgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                  </div>
                  <div>
                    <Label className="text-xs">Fondo</Label>
                    <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Tamaño: {qrSize}px</Label>
                    <input type="range" min="150" max="500" step="50" value={qrSize} onChange={e => setQRSize(Number(e.target.value))} className="w-full" />
                  </div>
                </div>
              </div>
            </div>

            {/* QR Preview */}
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl border border-border bg-card p-6 w-full flex flex-col items-center gap-4">
                {qrImageURL ? (
                  <img
                    src={qrImageURL}
                    alt="QR Code"
                    width={Math.min(qrSize, 280)}
                    height={Math.min(qrSize, 280)}
                    className="rounded-lg"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <div className="w-48 h-48 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
                    Ingresá un contenido
                  </div>
                )}
                {customLabel && <p className="text-sm font-medium">{customLabel}</p>}
                {effectiveContent && (
                  <p className="text-xs text-muted-foreground text-center break-all max-w-full px-2 line-clamp-2">
                    {effectiveContent}
                  </p>
                )}
              </div>

              <div className="flex gap-2 flex-wrap justify-center">
                {qrImageURL && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => handleDownload(qrImageURL, `qr-${qrType}-${Date.now()}.png`)}>
                      <Download className="w-4 h-4 mr-1.5" /> Descargar PNG
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(effectiveContent); toast.success("Copiado"); }}>
                      <Copy className="w-4 h-4 mr-1.5" /> Copiar contenido
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                      <Plus className="w-4 h-4 mr-1.5" /> Guardar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Products QR ── */}
        <TabsContent value="products" className="mt-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar producto..." value={searchProd} onChange={e => setSearchProd(e.target.value)} className="pl-9" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProds.map(prod => {
              const productUrl = `${window.location.origin}/catalogo-producto/${prod.id}`;
              const qrUrl = generateQRDataURL(productUrl, 200, "#000000", "#ffffff");
              return (
                <div key={prod.id} className="rounded-xl border border-border bg-card p-4 flex flex-col items-center gap-3">
                  <img src={qrUrl} alt={prod.name} width={140} height={140} className="rounded" style={{ imageRendering: "pixelated" }} />
                  <div className="text-center">
                    <p className="font-semibold text-sm">{prod.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtCurrency(prod.price)}{prod.sku ? ` · ${prod.sku}` : ""}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleDownload(qrUrl, `qr-${prod.name.replace(/\s/g, "-")}.png`)}>
                      <Download className="w-3.5 h-3.5 mr-1" /> PNG
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(productUrl); toast.success("Link copiado"); }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Saved QRs ── */}
        <TabsContent value="saved" className="mt-4 space-y-4">
          {savedQRs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <QrCode className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin QR guardados</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {savedQRs.map(qr => {
                const url = generateQRDataURL(qr.content, 200, qr.color, qr.bgColor);
                const typeLabel = QR_TYPE_CONFIG[qr.type]?.label ?? qr.type;
                return (
                  <div key={qr.id} className="rounded-xl border border-border bg-card p-3 flex flex-col items-center gap-2">
                    <img src={url} alt={qr.label} width={120} height={120} className="rounded" style={{ imageRendering: "pixelated" }} />
                    <p className="text-xs font-medium text-center">{qr.label}</p>
                    <Badge className="text-xs bg-muted text-muted-foreground">{typeLabel}</Badge>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => handleDownload(url, `${qr.label}.png`)}>
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteSaved(qr.id)}>
                        ×
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
