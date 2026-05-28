import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  TrendingUp, TrendingDown, Minus, Plus, Pencil, Trash2,
  Globe, Package, BarChart3, AlertTriangle, RefreshCcw,
  ArrowUpRight, ArrowDownRight, Search, ExternalLink, Bell, Loader2
} from "lucide-react";
import { toast } from "sonner";

/* ─────────────────────────── types ─────────────────────────── */
interface Competitor {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  is_active: boolean;
}

interface CompetitorProduct {
  id: string;
  competitor_id: string;
  our_product_id: string | null;
  competitor_sku: string | null;
  competitor_name: string;
  url: string | null;
  notes: string | null;
  competitors: { name: string; website: string | null } | null;
  products: { name: string; price: number | null } | null;
}

interface PriceEntry {
  id: string;
  competitor_product_id: string;
  price: number;
  currency: string;
  in_stock: boolean;
  promotion: string | null;
  recorded_at: string;
  source: string;
}

interface PriceComparison {
  competitor_product_id: string;
  org_id: string;
  competitor_id: string;
  competitor_name: string;
  our_product_id: string | null;
  our_product_name: string | null;
  our_price: number | null;
  their_product_name: string;
  url: string | null;
  their_price: number | null;
  their_in_stock: boolean | null;
  their_promotion: string | null;
  recorded_at: string | null;
  price_diff_pct: number | null;
  position: "undercut" | "above" | "parity" | "unknown";
}

interface OurProduct {
  id: string;
  name: string;
  price: number | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const POSITION_CONFIG = {
  undercut: { label: "Competidor más barato", color: "bg-red-500/15 text-red-400",      icon: <TrendingDown className="w-3.5 h-3.5" />, dot: "bg-red-500" },
  above:    { label: "Nosotros más barato",   color: "bg-emerald-500/15 text-emerald-400", icon: <TrendingUp className="w-3.5 h-3.5" />, dot: "bg-emerald-500" },
  parity:   { label: "Precio igual",          color: "bg-muted/40 text-muted-foreground",  icon: <Minus className="w-3.5 h-3.5" />,     dot: "bg-muted-foreground" },
  unknown:  { label: "Sin comparar",          color: "bg-yellow-500/15 text-yellow-400",   icon: <AlertTriangle className="w-3.5 h-3.5" />, dot: "bg-yellow-400" },
};

const TABS = ["Comparativa", "Competidores", "Productos", "Historial"] as const;
type Tab = typeof TABS[number];

/* ─────────────────────────── sparkline ─────────────────────────── */
function MiniTrend({ prices }: { prices: number[] }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * 60;
    const y = 20 - ((p - min) / range) * 18;
    return `${x},${y}`;
  }).join(" ");
  const isUp = prices[prices.length - 1] > prices[0];
  return (
    <svg width={64} height={24} viewBox="0 0 64 24" className="shrink-0">
      <polyline points={pts} fill="none" stroke={isUp ? "#ef4444" : "#22c55e"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CompetitorPricingPage() {
  usePageTitle("Inteligencia de Precios");
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<Tab>("Comparativa");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [compProducts, setCompProducts] = useState<CompetitorProduct[]>([]);
  const [comparison, setComparison] = useState<PriceComparison[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceEntry[]>([]);
  const [ourProducts, setOurProducts] = useState<OurProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPosition, setFilterPosition] = useState("all");

  /* dialogs */
  const [showCompDialog, setShowCompDialog] = useState(false);
  const [showProdDialog, setShowProdDialog] = useState(false);
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [editingComp, setEditingComp] = useState<Competitor | null>(null);
  const [editingProd, setEditingProd] = useState<CompetitorProduct | null>(null);
  const [pricingForProduct, setPricingForProduct] = useState<string | null>(null);

  /* forms */
  const [compForm, setCompForm] = useState({ name: "", website: "", notes: "", is_active: true });
  const [prodForm, setProdForm] = useState({ competitor_id: "", our_product_id: "", competitor_sku: "", competitor_name: "", url: "", notes: "" });
  const [priceForm, setPriceForm] = useState({ price: "", currency: "ARS", in_stock: true, promotion: "" });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [cr, cpr, vr, hr, opr] = await Promise.allSettled([
      supabase.from("competitors").select("*").eq("org_id", orgId).order("name"),
      supabase.from("competitor_products").select("*, competitors(name,website), products(name,price)").eq("org_id", orgId).order("competitor_name"),
      supabase.from("competitor_price_comparison").select("*").eq("org_id", orgId),
      supabase.from("competitor_prices").select("*").eq("org_id", orgId).order("recorded_at", { ascending: false }).limit(200),
      supabase.from("products").select("id,name,price").eq("org_id", orgId).order("name"),
    ]);
    if (cr.status === "fulfilled" && cr.value.data) setCompetitors(cr.value.data as Competitor[]);
    if (cpr.status === "fulfilled" && cpr.value.data) setCompProducts(cpr.value.data as CompetitorProduct[]);
    if (vr.status === "fulfilled" && vr.value.data) setComparison(vr.value.data as PriceComparison[]);
    if (hr.status === "fulfilled" && hr.value.data) setPriceHistory(hr.value.data as PriceEntry[]);
    if (opr.status === "fulfilled" && opr.value.data) setOurProducts(opr.value.data as OurProduct[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  /* ── Competitor CRUD ── */
  function openNewComp() {
    setEditingComp(null);
    setCompForm({ name: "", website: "", notes: "", is_active: true });
    setShowCompDialog(true);
  }
  function openEditComp(c: Competitor) {
    setEditingComp(c);
    setCompForm({ name: c.name, website: c.website ?? "", notes: c.notes ?? "", is_active: c.is_active });
    setShowCompDialog(true);
  }
  async function saveComp() {
    if (!orgId || !compForm.name.trim()) return;
    const payload = { org_id: orgId, name: compForm.name.trim(), website: compForm.website || null, notes: compForm.notes || null, is_active: compForm.is_active };
    if (editingComp) {
      const { error } = await supabase.from("competitors").update(payload).eq("id", editingComp.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("competitors").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Competidor guardado");
    setShowCompDialog(false);
    load();
  }

  /* ── Competitor Product CRUD ── */
  function openNewProd() {
    setEditingProd(null);
    setProdForm({ competitor_id: competitors[0]?.id ?? "", our_product_id: "", competitor_sku: "", competitor_name: "", url: "", notes: "" });
    setShowProdDialog(true);
  }
  function openEditProd(p: CompetitorProduct) {
    setEditingProd(p);
    setProdForm({ competitor_id: p.competitor_id, our_product_id: p.our_product_id ?? "", competitor_sku: p.competitor_sku ?? "", competitor_name: p.competitor_name, url: p.url ?? "", notes: p.notes ?? "" });
    setShowProdDialog(true);
  }
  async function saveProd() {
    if (!orgId || !prodForm.competitor_name.trim() || !prodForm.competitor_id) return;
    const payload = {
      org_id: orgId, competitor_id: prodForm.competitor_id,
      our_product_id: prodForm.our_product_id || null,
      competitor_sku: prodForm.competitor_sku || null,
      competitor_name: prodForm.competitor_name,
      url: prodForm.url || null, notes: prodForm.notes || null,
    };
    if (editingProd) {
      const { error } = await supabase.from("competitor_products").update(payload).eq("id", editingProd.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("competitor_products").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Producto guardado");
    setShowProdDialog(false);
    load();
  }

  /* ── Price recording ── */
  function openRecordPrice(cpId: string) {
    setPricingForProduct(cpId);
    setPriceForm({ price: "", currency: "ARS", in_stock: true, promotion: "" });
    setShowPriceDialog(true);
  }
  async function savePrice() {
    if (!orgId || !pricingForProduct || !priceForm.price) return;
    const { error } = await supabase.from("competitor_prices").insert({
      org_id: orgId, competitor_product_id: pricingForProduct,
      price: parseFloat(priceForm.price), currency: priceForm.currency,
      in_stock: priceForm.in_stock, promotion: priceForm.promotion || null,
      source: "manual",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Precio registrado");
    setShowPriceDialog(false);
    load();
  }

  /* ── filtered comparison ── */
  const filteredComparison = comparison.filter(c => {
    const matchSearch = !searchQuery || c.their_product_name.toLowerCase().includes(searchQuery.toLowerCase()) || (c.our_product_name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) || c.competitor_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchPos = filterPosition === "all" || c.position === filterPosition;
    return matchSearch && matchPos;
  });

  /* ── stats ── */
  const undercutCount = comparison.filter(c => c.position === "undercut").length;
  const aboveCount    = comparison.filter(c => c.position === "above").length;
  const parityCount   = comparison.filter(c => c.position === "parity").length;
  const avgDiffPct    = comparison.filter(c => c.price_diff_pct !== null).reduce((s, c, _, a) => s + (c.price_diff_pct ?? 0) / a.length, 0);

  /* ── history per product ── */
  function historyFor(cpId: string) {
    return priceHistory.filter(h => h.competitor_product_id === cpId).slice(0, 10);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Inteligencia de Precios"
        description="Monitoreo de precios de la competencia en tiempo real"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}><RefreshCcw className="w-4 h-4 mr-1" /> Actualizar</Button>
            {activeTab === "Competidores" && <Button size="sm" onClick={openNewComp}><Plus className="w-4 h-4 mr-1" /> Competidor</Button>}
            {activeTab === "Productos" && <Button size="sm" onClick={openNewProd}><Plus className="w-4 h-4 mr-1" /> Producto</Button>}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Nos superan en precio" value={undercutCount} icon={TrendingDown} color="destructive" />
        <KPICard label="Somos más baratos" value={aboveCount} icon={TrendingUp} color="success" />
        <KPICard label="Precio paridad" value={parityCount} icon={Minus} color="primary" />
        <KPICard label="Dif. promedio" value={`${avgDiffPct.toFixed(1)}%`} icon={BarChart3} color={avgDiffPct >= 0 ? "success" : "destructive"} />
      </div>

      {/* tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      <>
          {/* ── Comparativa ── */}
          {activeTab === "Comparativa" && (
            <div className="space-y-4">
              {/* filters */}
              <div className="flex gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                  <Input placeholder="Buscar producto…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 w-56" />
                </div>
                <div className="flex gap-2">
                  {(["all","undercut","above","parity","unknown"] as const).map(pos => (
                    <button key={pos} onClick={() => setFilterPosition(pos)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterPosition === pos ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground hover:border-primary/30"}`}>
                      {pos === "all" ? "Todos" : POSITION_CONFIG[pos].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* comparison table */}
              <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>
                      {["Nuestro producto", "Competidor", "Su producto", "Nuestro precio", "Su precio", "Diferencia", "Posición", ""].map(h => (
                        <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredComparison.map(c => {
                      const pos = POSITION_CONFIG[c.position] ?? POSITION_CONFIG.unknown;
                      const hist = historyFor(c.competitor_product_id).map(h => h.price);
                      return (
                        <tr key={c.competitor_product_id} className="hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-muted-foreground/70" />
                              <span className="font-medium text-foreground">{c.our_product_name ?? <span className="text-muted-foreground/70 italic">Sin mapear</span>}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{c.competitor_name}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <span className="text-foreground/80">{c.their_product_name}</span>
                              {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-600"><ExternalLink className="w-3 h-3" /></a>}
                            </div>
                            {c.their_promotion && <span className="text-xs text-orange-600 bg-orange-50 px-1 rounded">{c.their_promotion}</span>}
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {c.our_price != null ? `$${c.our_price.toLocaleString("es-AR")}` : <span className="text-muted-foreground/70">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium ${c.their_price == null ? "text-muted-foreground/70" : c.position === "undercut" ? "text-red-600" : "text-foreground"}`}>
                                {c.their_price != null ? `$${c.their_price.toLocaleString("es-AR")}` : "—"}
                              </span>
                              {!c.their_in_stock && <Badge className="bg-muted/40 text-muted-foreground text-xs">Sin stock</Badge>}
                              {hist.length > 1 && <MiniTrend prices={hist.reverse()} />}
                            </div>
                            {c.recorded_at && <p className="text-xs text-muted-foreground/70">{new Date(c.recorded_at).toLocaleDateString("es-AR")}</p>}
                          </td>
                          <td className="px-4 py-3">
                            {c.price_diff_pct != null ? (
                              <span className={`font-semibold flex items-center gap-1 ${c.price_diff_pct >= 0 ? "text-green-600" : "text-red-500"}`}>
                                {c.price_diff_pct >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                                {Math.abs(c.price_diff_pct).toFixed(1)}%
                              </span>
                            ) : <span className="text-muted-foreground/70">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`${pos.color} flex items-center gap-1 text-xs w-fit`}>{pos.icon}{pos.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Button variant="outline" size="sm" onClick={() => openRecordPrice(c.competitor_product_id)}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Precio
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredComparison.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-12 text-muted-foreground/70">Sin datos de comparación</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Competidores ── */}
          {activeTab === "Competidores" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {competitors.map(c => {
                const prodCount = compProducts.filter(p => p.competitor_id === c.id).length;
                return (
                  <div key={c.id} className={`bg-card rounded-xl border border-border/40 p-4 space-y-3 ${!c.is_active ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-indigo-500" />
                        <div>
                          <p className="font-semibold text-foreground">{c.name}</p>
                          {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">{c.website} <ExternalLink className="w-3 h-3" /></a>}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEditComp(c)} className="p-1 rounded hover:bg-muted/40 text-muted-foreground/70"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => supabase.from("competitors").delete().eq("id", c.id).then(load)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{prodCount} productos monitoreados</span>
                      <Badge className={c.is_active ? "bg-green-100 text-green-700" : "bg-muted/40 text-muted-foreground"}>
                        {c.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
              {competitors.length === 0 && (
                <div className="col-span-3 text-center py-16 text-muted-foreground/70">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Sin competidores cargados</p>
                  <p className="text-sm mt-1">Agregá competidores para empezar a monitorear precios</p>
                </div>
              )}
            </div>
          )}

          {/* ── Productos ── */}
          {activeTab === "Productos" && (
            <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Competidor", "Producto rival", "SKU rival", "Nuestro producto", "URL", "Últ. precio", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {compProducts.map(p => {
                    const latest = priceHistory.find(h => h.competitor_product_id === p.id);
                    return (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">{p.competitors?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-foreground/80">{p.competitor_name}</td>
                        <td className="px-4 py-3 text-muted-foreground/70 font-mono text-xs">{p.competitor_sku ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{(p.products as CompetitorProduct["products"])?.name ?? <span className="text-muted-foreground/70 italic text-xs">Sin mapear</span>}</td>
                        <td className="px-4 py-3">
                          {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink className="w-4 h-4" /></a> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {latest ? (
                            <span className="font-medium text-foreground">${latest.price.toLocaleString("es-AR")}</span>
                          ) : <span className="text-muted-foreground/70 text-xs">Sin datos</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openRecordPrice(p.id)}><Plus className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => openEditProd(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => supabase.from("competitor_products").delete().eq("id", p.id).then(load)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {compProducts.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground/70">Sin productos cargados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Historial ── */}
          {activeTab === "Historial" && (
            <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Fecha y hora", "Producto rival", "Competidor", "Precio", "Moneda", "En stock", "Promoción", "Fuente"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {priceHistory.map(h => {
                    const cp = compProducts.find(p => p.id === h.competitor_product_id);
                    return (
                      <tr key={h.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(h.recorded_at).toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{cp?.competitor_name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{cp?.competitors?.name ?? "—"}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">${h.price.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 text-muted-foreground">{h.currency}</td>
                        <td className="px-4 py-3">
                          {h.in_stock ? <Badge className="bg-green-100 text-green-700 text-xs">Sí</Badge> : <Badge className="bg-red-100 text-red-700 text-xs">No</Badge>}
                        </td>
                        <td className="px-4 py-3 text-orange-600 text-xs">{h.promotion ?? "—"}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className="text-xs capitalize">{h.source}</Badge></td>
                      </tr>
                    );
                  })}
                  {priceHistory.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground/70">Sin historial de precios</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
      </>

      {/* ── Competitor Dialog ── */}
      <Dialog open={showCompDialog} onOpenChange={setShowCompDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingComp ? "Editar Competidor" : "Nuevo Competidor"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={compForm.name} onChange={e => setCompForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Sitio web</Label><Input value={compForm.website} onChange={e => setCompForm(p => ({ ...p, website: e.target.value }))} placeholder="https://" /></div>
            <div><Label>Notas</Label><Input value={compForm.notes} onChange={e => setCompForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <Switch checked={compForm.is_active} onCheckedChange={v => setCompForm(p => ({ ...p, is_active: v }))} />
              <Label>Activo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompDialog(false)}>Cancelar</Button>
            <Button onClick={saveComp}>{editingComp ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Product Dialog ── */}
      <Dialog open={showProdDialog} onOpenChange={setShowProdDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingProd ? "Editar Producto Rival" : "Nuevo Producto Rival"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Competidor *</Label>
              <Select value={prodForm.competitor_id} onValueChange={v => setProdForm(p => ({ ...p, competitor_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>{competitors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Nombre del producto rival *</Label><Input value={prodForm.competitor_name} onChange={e => setProdForm(p => ({ ...p, competitor_name: e.target.value }))} /></div>
            <div><Label>SKU rival</Label><Input value={prodForm.competitor_sku} onChange={e => setProdForm(p => ({ ...p, competitor_sku: e.target.value }))} /></div>
            <div>
              <Label>Nuestro producto equivalente</Label>
              <Select value={prodForm.our_product_id} onValueChange={v => setProdForm(p => ({ ...p, our_product_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Sin mapear" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin mapear</SelectItem>
                  {ourProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>URL del producto</Label><Input value={prodForm.url} onChange={e => setProdForm(p => ({ ...p, url: e.target.value }))} placeholder="https://" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProdDialog(false)}>Cancelar</Button>
            <Button onClick={saveProd}>{editingProd ? "Guardar" : "Agregar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Price Dialog ── */}
      <Dialog open={showPriceDialog} onOpenChange={setShowPriceDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar precio de competidor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Precio *</Label><Input type="number" step="0.01" value={priceForm.price} onChange={e => setPriceForm(p => ({ ...p, price: e.target.value }))} /></div>
              <div>
                <Label>Moneda</Label>
                <Select value={priceForm.currency} onValueChange={v => setPriceForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Promoción (si aplica)</Label><Input value={priceForm.promotion} onChange={e => setPriceForm(p => ({ ...p, promotion: e.target.value }))} placeholder="ej. 20% off, 3x2, etc." /></div>
            <div className="flex items-center gap-3">
              <Switch checked={priceForm.in_stock} onCheckedChange={v => setPriceForm(p => ({ ...p, in_stock: v }))} />
              <Label>En stock</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPriceDialog(false)}>Cancelar</Button>
            <Button onClick={savePrice}><Bell className="w-4 h-4 mr-1" /> Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
