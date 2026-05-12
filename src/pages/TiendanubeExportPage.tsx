import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Store, Download, Upload, RefreshCw, CheckCircle2, AlertCircle, Link2, ShoppingBag } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { TableSkeleton } from "@/components/shared/PageSkeleton";

// Tiendanube usa ; como separador y comillas dobles para escapar
function csvEscape(v: any) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[";\n\r]/.test(s) ? `"${s}"` : s;
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = "\uFEFF" + rows.map(r => r.map(csvEscape).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Plantilla OFICIAL de Tiendanube (orden y nombres exactos)
const TN_HEADERS = [
  "Identificador de URL",
  "Nombre",
  "Categorías",
  "Nombre de propiedad 1",
  "Valor de propiedad 1",
  "Nombre de propiedad 2",
  "Valor de propiedad 2",
  "Nombre de propiedad 3",
  "Valor de propiedad 3",
  "Precio",
  "Precio promocional",
  "Peso (kg)",
  "Alto (cm)",
  "Ancho (cm)",
  "Profundidad (cm)",
  "Stock",
  "SKU",
  "Código de barras",
  "Mostrar en tienda",
  "Envío sin cargo",
  "Descripción",
  "Tags",
  "Título para SEO",
  "Descripción para SEO",
  "Marca",
  "Producto Físico",
  "MPN (Número de pieza del fabricante)",
  "Sexo",
  "Rango de edad",
  "Costo",
  "Imágenes",
];

function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    perfume_arabe: "Perfumes Árabes",
    "perfume_diseñador": "Perfumes de Diseñador",
    perfume_disenador: "Perfumes de Diseñador",
    vaper: "Vapers",
    electronico: "Electrónica",
  };
  return map[cat] || cat || "Productos";
}

function genderLabel(g: string) {
  if (g === "masculino") return "Hombre";
  if (g === "femenino") return "Mujer";
  return "Sin género";
}

function collectImages(p: any): string[] {
  const arr: string[] = Array.isArray(p.image_urls) ? p.image_urls.filter(Boolean) : [];
  if (arr.length === 0 && p.image_url) arr.push(p.image_url);
  // Tiendanube exige URLs absolutas https. Limpio espacios y dedup preservando orden.
  const clean = arr
    .map((u) => String(u).trim())
    .filter((u) => /^https?:\/\//i.test(u));
  return Array.from(new Set(clean));
}

const PRICE_MODES = [
  { value: "sale_price_ars", label: "Precio de lista (sin descuento)" },
  { value: "discount_price_ars", label: "Precio con descuento" },
];

// Aplica markup + comisión Tiendanube + comisión pasarela y redondeo opcional.
// Las comisiones se "inflan" sobre el neto que querés cobrar:
//   precio_publicado = neto / (1 - (fee_tn + fee_pago)/100)
// Así, después de que la plataforma descuenta, te queda el neto deseado.
function applyAllFees(
  base: number,
  markup: number,
  platformFee: number,
  paymentFee: number,
  roundTo: number
): number {
  if (!base || base <= 0) return 0;
  const neto = base * (1 + (markup || 0) / 100);
  const totalFee = ((platformFee || 0) + (paymentFee || 0)) / 100;
  const grossed = totalFee >= 1 ? neto : neto / (1 - totalFee);
  if (roundTo && roundTo > 0) {
    return Math.ceil(grossed / roundTo) * roundTo;
  }
  return Math.round(grossed);
}

export default function TiendanubeExportPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [integration, setIntegration] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<any[]>([]);

  // form
  const [storeId, setStoreId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [priceMode, setPriceMode] = useState("sale_price_ars");
  const [markupPercent, setMarkupPercent] = useState("0");
  const [syncStock, setSyncStock] = useState(true);
  const [syncImages, setSyncImages] = useState(true);
  const [publishStatus, setPublishStatus] = useState("visible");
  const [platformFeePercent, setPlatformFeePercent] = useState("0");
  const [paymentFeePercent, setPaymentFeePercent] = useState("0");
  const [roundTo, setRoundTo] = useState("0");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [intRes, prodRes, logRes] = await Promise.all([
      supabase.from("tiendanube_integrations").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("products").select("id,name,brand,category,gender,content_ml,description,sale_price_ars,discount_price_ars,stock,image_url,image_urls,tiendanube_product_id").eq("org_id", orgId).order("name"),
      supabase.from("tiendanube_sync_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (intRes.data) {
      setIntegration(intRes.data);
      setStoreId(intRes.data.store_id);
      setAccessToken(intRes.data.access_token);
      setStoreUrl(intRes.data.store_url || "");
      setPriceMode(intRes.data.price_mode);
      setMarkupPercent(String(intRes.data.markup_percent));
      setSyncStock(intRes.data.sync_stock);
      setSyncImages(intRes.data.sync_images);
      setPublishStatus(intRes.data.publish_status);
      setPlatformFeePercent(String(intRes.data.platform_fee_percent ?? 0));
      setPaymentFeePercent(String(intRes.data.payment_fee_percent ?? 0));
      setRoundTo(String(intRes.data.round_to ?? 0));
    }
    setProducts(prodRes.data || []);
    setLogs(logRes.data || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!orgId) return;
    if (!storeId || !accessToken) {
      toast.error("Store ID y Access Token son obligatorios");
      return;
    }
    setSaving(true);
    const payload = {
      org_id: orgId,
      store_id: storeId.trim(),
      access_token: accessToken.trim(),
      store_url: storeUrl.trim() || null,
      price_mode: priceMode,
      markup_percent: Number(markupPercent) || 0,
      sync_stock: syncStock,
      sync_images: syncImages,
      publish_status: publishStatus,
      platform_fee_percent: Number(platformFeePercent) || 0,
      payment_fee_percent: Number(paymentFeePercent) || 0,
      round_to: Number(roundTo) || 0,
    };
    const { error } = integration
      ? await supabase.from("tiendanube_integrations").update(payload).eq("org_id", orgId)
      : await supabase.from("tiendanube_integrations").insert(payload);
    setSaving(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success("Configuración guardada");
    load();
  };

  const handleTest = async () => {
    if (!integration) { toast.error("Primero guardá la configuración"); return; }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("tiendanube-export", {
      body: { org_id: orgId, action: "test" },
    });
    setTesting(false);
    if (error || !data?.success) {
      toast.error("Conexión fallida: " + (data?.error || error?.message || "error"));
      return;
    }
    toast.success(`Conectado a "${data.store?.name?.es || data.store?.name || "tu tienda"}"`);
  };

  const handleSync = async (all: boolean) => {
    if (!integration) { toast.error("Configurá la integración primero"); return; }
    const ids = all ? undefined : Array.from(selected);
    if (!all && ids?.length === 0) { toast.error("Seleccioná al menos un producto"); return; }
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("tiendanube-export", {
      body: { org_id: orgId, product_ids: ids, action: "sync" },
    });
    setSyncing(false);
    if (error || !data?.success) {
      toast.error("Error: " + (data?.error || error?.message || "fallo"));
      return;
    }
    toast.success(`Sincronizados: ${data.ok} ok, ${data.fail} fallidos (de ${data.total})`);
    load();
  };

  const handleExportCSV = () => {
    const rows: string[][] = [TN_HEADERS];
    const list = selected.size > 0 ? products.filter(p => selected.has(p.id)) : products;
    const markup = Number(markupPercent) || 0;
    const pf = Number(platformFeePercent) || 0;
    const pay = Number(paymentFeePercent) || 0;
    const rt = Number(roundTo) || 0;
    for (const p of list) {
      const basePrice = priceMode === "discount_price_ars" && p.discount_price_ars ? p.discount_price_ars : p.sale_price_ars;
      const finalPrice = applyAllFees(Number(basePrice), markup, pf, pay, rt);
      const promo = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)
        ? applyAllFees(Number(p.discount_price_ars), markup, pf, pay, rt)
        : "";
      const images = collectImages(p);
      const desc = [
        p.description || "",
        p.content_ml ? `<p><strong>Contenido:</strong> ${p.content_ml} ml</p>` : "",
      ].filter(Boolean).join("\n");
      const seoDesc = (p.description || `${p.name} - ${p.brand}`).replace(/<[^>]+>/g, "").slice(0, 160);

      rows.push([
        `${slugify(p.name || "producto")}-${(p.id || "").slice(0, 6)}`, // Identificador de URL (único)
        (p.name || "").toUpperCase(),                  // Nombre
        categoryLabel(p.category),                     // Categorías
        "", "", "", "", "", "",                        // Propiedades 1/2/3 (sin variantes en export)
        String(finalPrice),                            // Precio
        promo === "" ? "" : String(promo),             // Precio promocional
        "0.300",                                       // Peso (kg)
        "15",                                          // Alto (cm)
        "8",                                           // Ancho (cm)
        "8",                                           // Profundidad (cm)
        String(p.stock ?? 0),                          // Stock
        (p.id || "").slice(0, 12).toUpperCase(),       // SKU
        "",                                            // Código de barras
        publishStatus === "draft" ? "NO" : "SI",       // Mostrar en tienda (Tiendanube exige SI/NO)
        "NO",                                          // Envío sin cargo
        desc,                                          // Descripción
        [p.brand, p.category, p.gender].filter(Boolean).join(","), // Tags
        `${(p.name || "").toUpperCase()} ${p.brand || ""}`.trim(), // Título para SEO
        seoDesc,                                       // Descripción para SEO
        (p.brand || "").toUpperCase(),                 // Marca
        "SI",                                          // Producto Físico (mayúsculas)
        "",                                            // MPN
        genderLabel(p.gender),                         // Sexo
        "",                                            // Rango de edad
        "",                                            // Costo (lo dejamos vacío para no exponer)
        images.join(","),                              // Imágenes (separadas por coma)
      ]);
    }
    downloadCSV(`tiendanube-productos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`CSV generado con ${list.length} productos (plantilla oficial Tiendanube)`);
  };

  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map(p => p.id)));
  };

  if (loading) return <TableSkeleton rows={6} cols={3} />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        title="Exportar a Tiendanube"
        description="Sincronizá tus productos con tu ecommerce automáticamente."
        badge={integration ? { label: "Conectado", variant: "success" } : undefined}
      />

      <Tabs defaultValue={integration ? "sync" : "config"} className="w-full">
        <TabsList>
          <TabsTrigger value="config"><Store className="w-4 h-4 mr-1" /> Configuración</TabsTrigger>
          <TabsTrigger value="sync" disabled={!integration}><Upload className="w-4 h-4 mr-1" /> Sincronizar API</TabsTrigger>
          <TabsTrigger value="csv"><Download className="w-4 h-4 mr-1" /> Exportar CSV</TabsTrigger>
          <TabsTrigger value="logs"><RefreshCw className="w-4 h-4 mr-1" /> Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Credenciales de Tiendanube</CardTitle>
              <CardDescription>
                Obtené tu Store ID y Access Token desde tu panel de Tiendanube → Configuración → API.
                Si todavía no tenés app, podés crear una en <a className="underline text-primary" href="https://partners.tiendanube.com" target="_blank" rel="noreferrer">partners.tiendanube.com</a>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Store ID *</Label>
                  <Input value={storeId} onChange={e => setStoreId(e.target.value)} placeholder="123456" />
                </div>
                <div>
                  <Label>Access Token *</Label>
                  <Input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="••••••••••••" />
                </div>
                <div className="md:col-span-2">
                  <Label>URL de tu tienda (opcional)</Label>
                  <Input value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="https://mitienda.com.ar" />
                </div>
              </div>

              <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Precio a publicar</Label>
                  <Select value={priceMode} onValueChange={setPriceMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRICE_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Markup adicional (%)</Label>
                  <Input type="number" value={markupPercent} onChange={e => setMarkupPercent(e.target.value)} placeholder="0" />
                  <p className="text-xs text-muted-foreground mt-1">Suma este % sobre el precio antes de publicar</p>
                </div>
                <div>
                  <Label>Estado al publicar</Label>
                  <Select value={publishStatus} onValueChange={setPublishStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visible">Visible en tienda</SelectItem>
                      <SelectItem value="draft">Borrador (oculto)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Comisión Tiendanube (%)</Label>
                  <Input type="number" step="0.1" value={platformFeePercent} onChange={e => setPlatformFeePercent(e.target.value)} placeholder="9" />
                  <p className="text-xs text-muted-foreground mt-1">Plan Inicial 9% · Avanzado 4.5% · Evolución 2%</p>
                </div>
                <div>
                  <Label>Comisión pasarela de pago (%)</Label>
                  <Input type="number" step="0.1" value={paymentFeePercent} onChange={e => setPaymentFeePercent(e.target.value)} placeholder="6" />
                  <p className="text-xs text-muted-foreground mt-1">Mercado Pago acreditación inmediata ~6.29%</p>
                </div>
                <div>
                  <Label>Redondear precio a múltiplo de</Label>
                  <Select value={roundTo} onValueChange={setRoundTo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sin redondeo</SelectItem>
                      <SelectItem value="10">$10</SelectItem>
                      <SelectItem value="50">$50</SelectItem>
                      <SelectItem value="100">$100</SelectItem>
                      <SelectItem value="500">$500</SelectItem>
                      <SelectItem value="1000">$1.000</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Redondea hacia arriba para precios "lindos"</p>
                </div>
                <div className="flex flex-col gap-3 justify-end">
                  <div className="flex items-center justify-between">
                    <Label>Sincronizar stock</Label>
                    <Switch checked={syncStock} onCheckedChange={setSyncStock} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Sincronizar imágenes</Label>
                    <Switch checked={syncImages} onCheckedChange={setSyncImages} />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar configuración"}</Button>
                <Button variant="outline" onClick={handleTest} disabled={testing || !integration}>
                  <Link2 className="w-4 h-4 mr-1" />
                  {testing ? "Probando..." : "Probar conexión"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sincronizar productos vía API</CardTitle>
              <CardDescription>
                Crea o actualiza los productos seleccionados en tu tienda. Los productos ya sincronizados se actualizan; los nuevos se crean.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => handleSync(true)} disabled={syncing}>
                  <Upload className="w-4 h-4 mr-1" />
                  {syncing ? "Sincronizando..." : `Sincronizar TODOS (${products.length})`}
                </Button>
                <Button variant="outline" onClick={() => handleSync(false)} disabled={syncing || selected.size === 0}>
                  Sincronizar seleccionados ({selected.size})
                </Button>
                <Button variant="ghost" size="sm" onClick={toggleAll} className="ml-auto">
                  {selected.size === products.length ? "Deseleccionar todo" : "Seleccionar todo"}
                </Button>
              </div>

              <div className="border border-border rounded-lg overflow-hidden max-h-[480px] overflow-y-auto table-wrap">
                <table className="w-full text-sm table-compact-mobile">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2 w-10"></th>
                      <th className="p-2">Producto</th>
                      <th className="p-2">Marca</th>
                      <th className="p-2 text-right">Precio</th>
                      <th className="p-2 text-right">Stock</th>
                      <th className="p-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                        <td className="p-2">
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={(c) => {
                              const next = new Set(selected);
                              if (c) next.add(p.id); else next.delete(p.id);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-medium">{p.name}</td>
                        <td className="p-2 text-muted-foreground">{p.brand}</td>
                        <td className="p-2 text-right">${Number(p.sale_price_ars).toLocaleString("es-AR")}</td>
                        <td className="p-2 text-right">{p.stock}</td>
                        <td className="p-2 text-center">
                          {p.tiendanube_product_id
                            ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">Sincronizado</Badge>
                            : <Badge variant="outline" className="text-xs">Pendiente</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="csv" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Exportar CSV para Tiendanube</CardTitle>
              <CardDescription>
                Generá el CSV en el formato oficial de Tiendanube y subilo desde tu panel: Productos → Importar/Exportar.
                No requiere credenciales de API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleExportCSV} disabled={!products.length}>
                <Download className="w-4 h-4 mr-1" />
                Descargar CSV ({selected.size > 0 ? `${selected.size} seleccionados` : `${products.length} productos`})
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                El CSV usa el modo de precio y markup configurado en la pestaña de Configuración.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Historial de sincronización</CardTitle>
              <CardDescription>Últimas 50 operaciones</CardDescription>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay sincronizaciones registradas.</p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto">
                  {logs.map(l => (
                    <div key={l.id} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                      {l.status === "success"
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm truncate">{l.product_name}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(l.created_at).toLocaleString("es-AR")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {l.action} · {l.status}
                          {l.error_message && <span className="text-destructive"> — {l.error_message}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}