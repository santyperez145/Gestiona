import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Download, Plus, Edit2, Trash2, Copy, RefreshCw, Search,
  FileDown, Key, Eye, TrendingUp, DollarSign, Users, CheckCircle2,
  XCircle, Link2, ExternalLink, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DigitalProduct {
  id: string;
  name: string;
  description: string | null;
  file_url: string | null;
  preview_url: string | null;
  price: number;
  currency: string;
  category: string | null;
  tags: string[];
  download_limit: number | null;
  total_sold: number;
  total_revenue: number;
  active: boolean;
  created_at: string;
}

interface License {
  id: string;
  product_id: string;
  customer_name: string;
  customer_email: string;
  license_key: string;
  download_token: string;
  amount_paid: number;
  downloads_used: number;
  max_downloads: number | null;
  expires_at: string | null;
  revoked: boolean;
  last_downloaded_at: string | null;
  created_at: string;
  digital_products?: { name: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCurrency(n: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
function copyText(t: string, label = "Copiado") {
  navigator.clipboard.writeText(t).then(() => toast.success(label));
}

// ── Product Form ──────────────────────────────────────────────────────────────
const blankDP = () => ({
  name: "", description: "", file_url: "", preview_url: "",
  price: 0, currency: "ARS", category: "", tags: "",
  download_limit: "", active: true,
});

function ProductForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: DigitalProduct | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankDP());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    setF(editing ? {
      name: editing.name, description: editing.description || "",
      file_url: editing.file_url || "", preview_url: editing.preview_url || "",
      price: editing.price, currency: editing.currency,
      category: editing.category || "", tags: editing.tags?.join(", ") || "",
      download_limit: editing.download_limit !== null ? String(editing.download_limit) : "",
      active: editing.active,
    } : blankDP());
  }, [editing, open]);

  async function save() {
    if (!f.name.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    const payload = {
      org_id: orgId, name: f.name.trim(), description: f.description || null,
      file_url: f.file_url || null, preview_url: f.preview_url || null,
      price: Number(f.price), currency: f.currency,
      category: f.category || null,
      tags: f.tags ? f.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      download_limit: f.download_limit ? Number(f.download_limit) : null,
      active: f.active,
    };
    const { error } = editing
      ? await supabase.from("digital_products").update(payload).eq("id", editing.id)
      : await supabase.from("digital_products").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Producto digital guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar producto digital" : "Nuevo producto digital"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="Guía de cocina, Preset de Lightroom, Ebook..." />
          </div>
          <div><Label>Descripción</Label>
            <Textarea value={f.description as string} onChange={e => upd("description", e.target.value)} rows={3} />
          </div>
          <div><Label>URL del archivo (Google Drive, S3, Dropbox…)</Label>
            <Input value={f.file_url as string} onChange={e => upd("file_url", e.target.value)} placeholder="https://drive.google.com/..." />
          </div>
          <div><Label>URL de preview / imagen</Label>
            <Input value={f.preview_url as string} onChange={e => upd("preview_url", e.target.value)} placeholder="https://..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Precio</Label>
              <Input type="number" min="0" value={f.price} onChange={e => upd("price", e.target.value)} />
            </div>
            <div><Label>Moneda</Label>
              <Select value={f.currency} onValueChange={v => upd("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">🇦🇷 ARS</SelectItem>
                  <SelectItem value="USD">🇺🇸 USD</SelectItem>
                  <SelectItem value="EUR">🇪🇺 EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Límite descargas</Label>
              <Input type="number" min="1" value={f.download_limit as string} onChange={e => upd("download_limit", e.target.value)} placeholder="∞" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Categoría</Label>
              <Input value={f.category as string} onChange={e => upd("category", e.target.value)} placeholder="Ebooks, Presets, Cursos..." />
            </div>
            <div><Label>Tags (coma separados)</Label>
              <Input value={f.tags as string} onChange={e => upd("tags", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="dp-active" checked={f.active as boolean} onChange={e => upd("active", e.target.checked)} className="w-4 h-4" />
            <label htmlFor="dp-active" className="text-sm">Activo (visible para vender)</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── License Issue Form ────────────────────────────────────────────────────────
function LicenseForm({ open, onClose, products, orgId, onSaved }: {
  open: boolean; onClose: () => void;
  products: DigitalProduct[]; orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState({
    product_id: products[0]?.id || "",
    customer_name: "", customer_email: "",
    amount_paid: products[0]?.price || 0,
    max_downloads: "", expires_days: "",
  });
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const prod = products.find(p => p.id === f.product_id);
    if (prod) upd("amount_paid", prod.price);
  }, [f.product_id]);

  async function save() {
    if (!f.customer_name.trim() || !f.customer_email.trim() || !f.product_id) {
      toast.error("Nombre, email y producto son requeridos"); return;
    }
    setSaving(true);
    const expiresAt = f.expires_days
      ? new Date(Date.now() + Number(f.expires_days) * 86400000).toISOString()
      : null;
    const { error } = await supabase.from("digital_product_licenses").insert({
      org_id: orgId, product_id: f.product_id,
      customer_name: f.customer_name.trim(), customer_email: f.customer_email.trim(),
      amount_paid: Number(f.amount_paid),
      max_downloads: f.max_downloads ? Number(f.max_downloads) : null,
      expires_at: expiresAt,
      license_key: "", download_token: "",  // auto-generated by trigger
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Licencia generada y enviada");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Emitir licencia de descarga</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Producto *</Label>
            <Select value={f.product_id} onValueChange={v => upd("product_id", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} — {fmtCurrency(p.price, p.currency)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nombre *</Label>
              <Input value={f.customer_name} onChange={e => upd("customer_name", e.target.value)} />
            </div>
            <div><Label>Email *</Label>
              <Input type="email" value={f.customer_email} onChange={e => upd("customer_email", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Monto cobrado</Label>
              <Input type="number" min="0" value={f.amount_paid} onChange={e => upd("amount_paid", e.target.value)} />
            </div>
            <div><Label>Límite descargas</Label>
              <Input type="number" min="1" value={f.max_downloads} onChange={e => upd("max_downloads", e.target.value)} placeholder="∞" />
            </div>
            <div><Label>Expira en (días)</Label>
              <Input type="number" min="1" value={f.expires_days} onChange={e => upd("expires_days", e.target.value)} placeholder="∞" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Se generará automáticamente una clave de licencia y un token de descarga único.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Generando..." : "Emitir licencia"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DigitalProductsPage() {
  usePageTitle("Productos Digitales");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [products, setProducts] = useState<DigitalProduct[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("products");
  const [prodFormOpen, setProdFormOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<DigitalProduct | null>(null);
  const [licFormOpen, setLicFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterProd, setFilterProd] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [prods, lics] = await Promise.all([
      supabase.from("digital_products").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("digital_product_licenses").select("*, digital_products(name)")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
    ]);
    setProducts(prods.data || []);
    setLicenses((lics.data || []) as License[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function revokeKey(id: string) {
    if (!confirm("¿Revocar esta licencia? El cliente ya no podrá descargar.")) return;
    const { error } = await supabase.from("digital_product_licenses").update({ revoked: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Licencia revocada");
    loadData();
  }

  async function deleteProd(id: string) {
    if (!confirm("¿Eliminar este producto digital y todas sus licencias?")) return;
    await supabase.from("digital_products").delete().eq("id", id);
    toast.success("Producto eliminado");
    loadData();
  }

  const filteredLics = useMemo(() => licenses.filter(l => {
    const matchSearch = l.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      l.customer_email.toLowerCase().includes(search.toLowerCase()) ||
      l.license_key.toLowerCase().includes(search.toLowerCase());
    const matchProd = filterProd === "all" || l.product_id === filterProd;
    return matchSearch && matchProd;
  }), [licenses, search, filterProd]);

  const totalRevenue = products.reduce((s, p) => s + p.total_revenue, 0);
  const totalSold = products.reduce((s, p) => s + p.total_sold, 0);
  const activeProducts = products.filter(p => p.active).length;
  const revokedCount = licenses.filter(l => l.revoked).length;

  const kpis = useMemo(() => [
    { label: "Productos activos", value: String(activeProducts),          sub: `${products.length} total`,            icon: FileDown,    color: "primary"     as const },
    { label: "Licencias emitidas", value: String(licenses.length),        sub: `${revokedCount} revocadas`,           icon: Key,         color: "blue"        as const },
    { label: "Total vendido",      value: String(totalSold),              sub: "unidades digitales",                  icon: TrendingUp,  color: "warning"     as const },
    { label: "Ingresos totales",   value: fmtCurrency(totalRevenue),      sub: "acumulado",                           icon: DollarSign,  color: "success"     as const },
  ], [activeProducts, products.length, licenses.length, revokedCount, totalSold, totalRevenue]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileDown}
        title="Productos Digitales"
        description="Vendé ebooks, presets, cursos y cualquier descarga digital con licencias únicas."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLicFormOpen(true)} disabled={products.filter(p => p.active).length === 0}>
              <Key className="w-4 h-4 mr-1" /> Emitir licencia
            </Button>
            <Button onClick={() => { setEditingProd(null); setProdFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo producto
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} color={k.color} />
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="products">Productos ({products.length})</TabsTrigger>
          <TabsTrigger value="licenses">Licencias ({licenses.length})</TabsTrigger>
        </TabsList>

        {/* Products */}
        <TabsContent value="products" className="space-y-3 pt-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Sin productos digitales. Creá uno para empezar a vender.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {products.map(prod => (
                <div key={prod.id} className={`rounded-2xl border overflow-hidden transition-all ${prod.active ? "border-border/50 bg-card" : "border-border/20 bg-muted/20 opacity-60"}`}>
                  {prod.preview_url && (
                    <div className="h-36 overflow-hidden bg-muted">
                      <img src={prod.preview_url} alt={prod.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  {!prod.preview_url && (
                    <div className="h-20 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <FileDown className="w-8 h-8 text-primary/40" />
                    </div>
                  )}
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{prod.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${prod.active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                          {prod.active ? "Activo" : "Inactivo"}
                        </span>
                      </div>
                      {prod.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{prod.description}</p>}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold text-primary text-lg">{fmtCurrency(prod.price, prod.currency)}</span>
                      <div className="text-xs text-muted-foreground text-right">
                        <p>{prod.total_sold} vendidos</p>
                        {prod.download_limit && <p>Límite: {prod.download_limit}</p>}
                      </div>
                    </div>
                    {prod.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {prod.tags.map(t => <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{t}</span>)}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      {prod.file_url && (
                        <Button size="sm" variant="outline" className="flex-1 text-xs" asChild>
                          <a href={prod.file_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Ver archivo
                          </a>
                        </Button>
                      )}
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => { setEditingProd(prod); setProdFormOpen(true); }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteProd(prod.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Licenses */}
        <TabsContent value="licenses" className="space-y-3 pt-2">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar por nombre, email o clave..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={filterProd} onValueChange={setFilterProd}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Todos los productos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los productos</SelectItem>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
          </div>

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 bg-muted/20">
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left px-3 py-2.5">Cliente</th>
                  <th className="text-left px-3 py-2.5 hidden md:table-cell">Producto</th>
                  <th className="text-left px-3 py-2.5">Clave</th>
                  <th className="text-center px-3 py-2.5">Descargas</th>
                  <th className="text-center px-3 py-2.5">Estado</th>
                  <th className="text-right px-3 py-2.5">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLics.map(lic => (
                  <tr key={lic.id} className={`border-b border-border/30 hover:bg-muted/20 ${lic.revoked ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{lic.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{lic.customer_email}</p>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <p className="text-xs">{lic.digital_products?.name}</p>
                      <p className="text-xs text-muted-foreground">{fmtCurrency(lic.amount_paid)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{lic.license_key}</code>
                        <button onClick={() => copyText(lic.license_key, "Clave copiada")}
                          className="text-muted-foreground hover:text-foreground transition-colors">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-xs font-mono">
                        {lic.downloads_used}{lic.max_downloads ? `/${lic.max_downloads}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lic.revoked ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">Revocada</span>
                      ) : lic.expires_at && new Date(lic.expires_at) < new Date() ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500">Expirada</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Activa</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button title="Copiar token de descarga"
                          onClick={() => copyText(lic.download_token, "Token copiado")}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                        {!lic.revoked && (
                          <button title="Revocar licencia"
                            onClick={() => revokeKey(lic.id)}
                            className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredLics.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Sin licencias emitidas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <ProductForm open={prodFormOpen} onClose={() => setProdFormOpen(false)}
        editing={editingProd} orgId={orgId} onSaved={loadData} />
      <LicenseForm open={licFormOpen} onClose={() => setLicFormOpen(false)}
        products={products.filter(p => p.active)} orgId={orgId} onSaved={loadData} />
    </div>
  );
}
