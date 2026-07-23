/**
 * CompetitorIntelligenceTab — "Inteligencia" tab inside PricingEnginePage (/motor-precios).
 *
 * Merges:
 *  1) The former PricingIntelligencePage (/precios-inteligentes) — margin analysis per
 *     product, zone classification, scatter/category charts, what-if rate simulator.
 *  2) The competitor price benchmarking capability from the former CompetitorPricingPage
 *     (/precios-competencia, deleted) — competitors, tracked rival products and a live
 *     price comparison table. CompetitorIntelligencePage (/inteligencia-competitiva) was a
 *     near-duplicate of CompetitorPricingPage; only the richer one (price comparison table +
 *     CRUD) was kept here to avoid a redundant panel.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  DollarSign, TrendingUp, AlertTriangle, Percent,
  RefreshCw, Download, ArrowUpRight, Zap, Globe, Package,
  ExternalLink, Plus, Pencil, Trash2, Minus, TrendingDown, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, BarChart, Bar,
} from "recharts";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";

// ─────────────────────────── margin analysis types (ex-PricingIntelligencePage) ───────

type MarginZone = "excellent" | "good" | "warning" | "critical";

interface ProductMargin {
  id: string;
  name: string;
  category: string;
  brand: string;
  costUsd: number;
  totalCostUsd: number;
  costArs: number;
  salePrice: number;
  profitArs: number;
  marginPct: number;
  zone: MarginZone;
  stock: number;
  unitsSold30d: number;
  revenueImpact: number;
  suggestedPrice: number;
}

const ZONE_CONFIG: Record<MarginZone, { label: string; color: string; bg: string; border: string }> = {
  excellent: { label: "Excelente",  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  good:      { label: "Bueno",      color: "text-primary",     bg: "bg-primary/10",     border: "border-primary/30" },
  warning:   { label: "Bajo",       color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30" },
  critical:  { label: "Crítico",    color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30" },
};

function getZone(margin: number): MarginZone {
  if (margin >= 40) return "excellent";
  if (margin >= 25) return "good";
  if (margin >= 10) return "warning";
  return "critical";
}

const SCATTER_COLORS: Record<MarginZone, string> = {
  excellent: "#22c55e", good: "#f59e0b", warning: "#f97316", critical: "#ef4444",
};

function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ProductMargin;
  if (!d) return null;
  return (
    <div className="bg-popover border border-border/60 rounded-xl p-3 text-xs shadow-xl max-w-[200px]">
      <p className="font-semibold mb-1 truncate">{d.name}</p>
      <p>Margen: <span className="font-bold">{d.marginPct.toFixed(1)}%</span></p>
      <p>Precio: <span className="font-bold">{formatARS(d.salePrice)}</span></p>
      <p>Vendido 30d: <span className="font-bold">{d.unitsSold30d} u.</span></p>
    </div>
  );
}

// ─────────────────────────── competitor benchmarking types (ex-CompetitorPricingPage) ─

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

interface PriceComparison {
  competitor_product_id: string;
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

const POSITION_CONFIG = {
  undercut: { label: "Competidor más barato", color: "bg-red-500/15 text-red-400",      icon: <TrendingDown className="w-3.5 h-3.5" /> },
  above:    { label: "Nosotros más barato",   color: "bg-emerald-500/15 text-emerald-400", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  parity:   { label: "Precio igual",          color: "bg-muted/40 text-muted-foreground",  icon: <Minus className="w-3.5 h-3.5" /> },
  unknown:  { label: "Sin comparar",          color: "bg-yellow-500/15 text-yellow-400",   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

// ─────────────────────────── Component ─────────────────────────────────────────────────

export default function CompetitorIntelligenceTab() {
  const { activeOrg } = useOrg();
  const { orgId } = useOrganization();

  // ── Margin analysis state ────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductMargin[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchangeRate, setExchangeRate] = useState(1695);
  const [targetMargin, setTargetMargin] = useState(30);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<MarginZone | "all">("all");
  const [sortBy, setSortBy] = useState<"marginPct" | "revenueImpact" | "name" | "unitsSold30d">("revenueImpact");
  const [simRate, setSimRate] = useState<string>("");
  const effectiveRate = simRate ? Number(simRate) : exchangeRate;

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);

    const [productsRes, settingsRes, salesRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, category, brand, cost_usd, total_cost_usd, sale_price_ars, profit_per_unit_ars, stock")
        .eq("org_id", activeOrg.id)
        .gt("sale_price_ars", 0)
        .order("name"),
      supabase
        .from("settings")
        .select("exchange_rate")
        .eq("org_id", activeOrg.id)
        .single(),
      supabase
        .from("sales")
        .select("product_id, product_name, quantity")
        .eq("org_id", activeOrg.id)
        .gte("date", since30.toISOString().slice(0, 10)),
    ]);

    const rate = Number(settingsRes.data?.exchange_rate) || 1695;
    setExchangeRate(rate);

    const soldMap: Record<string, number> = {};
    (salesRes.data || []).forEach((s: any) => {
      const key = s.product_id || s.product_name;
      if (key) soldMap[key] = (soldMap[key] || 0) + (s.quantity || 1);
    });

    const rows: ProductMargin[] = (productsRes.data || []).map((p: any) => {
      const costArs = (p.total_cost_usd || 0) * effectiveRate;
      const profitArs = p.sale_price_ars - costArs;
      const marginPct = p.sale_price_ars > 0 ? (profitArs / p.sale_price_ars) * 100 : 0;
      const units30d = soldMap[p.id] || soldMap[p.name] || 0;
      const suggestedPrice = costArs > 0
        ? Math.ceil(costArs / (1 - targetMargin / 100) / 100) * 100
        : p.sale_price_ars;

      return {
        id: p.id,
        name: p.name,
        category: p.category || "Sin categoría",
        brand: p.brand || "",
        costUsd: p.cost_usd || 0,
        totalCostUsd: p.total_cost_usd || 0,
        costArs,
        salePrice: p.sale_price_ars || 0,
        profitArs,
        marginPct: Math.round(marginPct * 10) / 10,
        zone: getZone(marginPct),
        stock: p.stock || 0,
        unitsSold30d: units30d,
        revenueImpact: profitArs * units30d,
        suggestedPrice,
      };
    });

    setProducts(rows);
    setLoading(false);
  }, [activeOrg, effectiveRate, targetMargin]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
    }
    if (zoneFilter !== "all") list = list.filter(p => p.zone === zoneFilter);
    return [...list].sort((a, b) => {
      if (sortBy === "marginPct") return a.marginPct - b.marginPct;
      if (sortBy === "revenueImpact") return b.revenueImpact - a.revenueImpact;
      if (sortBy === "unitsSold30d") return b.unitsSold30d - a.unitsSold30d;
      return a.name.localeCompare(b.name);
    });
  }, [products, search, zoneFilter, sortBy]);

  const kpis = useMemo(() => {
    const avgMargin = products.length > 0 ? products.reduce((s, p) => s + p.marginPct, 0) / products.length : 0;
    const critical = products.filter(p => p.zone === "critical").length;
    const totalMarginContrib = products.reduce((s, p) => s + Math.max(0, p.revenueImpact), 0);
    return { avgMargin, critical, totalMarginContrib };
  }, [products]);

  const categoryData = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    products.forEach(p => {
      if (!map[p.category]) map[p.category] = { total: 0, count: 0 };
      map[p.category].total += p.marginPct;
      map[p.category].count++;
    });
    return Object.entries(map)
      .map(([cat, { total, count }]) => ({ name: cat.length > 18 ? cat.slice(0, 16) + "…" : cat, margin: Math.round(total / count * 10) / 10 }))
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10);
  }, [products]);

  const exportCSV = () => {
    const rows = [
      ["Producto", "Categoría", "Costo USD", "Costo ARS", "Precio", "Ganancia", "Margen%", "Vendido 30d", "Precio sugerido", "Zona"],
      ...filtered.map(p => [
        p.name, p.category, p.totalCostUsd.toFixed(2),
        Math.round(p.costArs), p.salePrice, Math.round(p.profitArs),
        p.marginPct, p.unitsSold30d, p.suggestedPrice, ZONE_CONFIG[p.zone].label,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `margenes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success("CSV exportado");
  };

  // ── Competitor benchmarking state ────────────────────────────────────────────────────
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [compProducts, setCompProducts] = useState<CompetitorProduct[]>([]);
  const [comparison, setComparison] = useState<PriceComparison[]>([]);
  const [ourProducts, setOurProducts] = useState<OurProduct[]>([]);
  const [compLoading, setCompLoading] = useState(true);
  const [compSearch, setCompSearch] = useState("");
  const [filterPosition, setFilterPosition] = useState("all");
  const [compSubTab, setCompSubTab] = useState<"comparativa" | "competidores" | "productos">("comparativa");

  const [showCompDialog, setShowCompDialog] = useState(false);
  const [showProdDialog, setShowProdDialog] = useState(false);
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [editingComp, setEditingComp] = useState<Competitor | null>(null);
  const [editingProd, setEditingProd] = useState<CompetitorProduct | null>(null);
  const [pricingForProduct, setPricingForProduct] = useState<string | null>(null);

  const [compForm, setCompForm] = useState({ name: "", website: "", notes: "", is_active: true });
  const [prodForm, setProdForm] = useState({ competitor_id: "", our_product_id: "", competitor_sku: "", competitor_name: "", url: "", notes: "" });
  const [priceForm, setPriceForm] = useState({ price: "", currency: "ARS", in_stock: true, promotion: "" });

  const loadCompetitors = useCallback(async () => {
    if (!orgId) return;
    setCompLoading(true);
    const [cr, cpr, vr, opr] = await Promise.allSettled([
      supabase.from("competitors").select("id, name, website, notes, is_active").eq("org_id", orgId).order("name"),
      supabase.from("competitor_products").select("*, competitors(name,website), products(name,price)").eq("org_id", orgId).order("competitor_name"),
      supabase.from("competitor_price_comparison").select("*").eq("org_id", orgId),
      supabase.from("products").select("id,name,price").eq("org_id", orgId).order("name"),
    ]);
    if (cr.status === "fulfilled" && cr.value.data) setCompetitors(cr.value.data as Competitor[]);
    if (cpr.status === "fulfilled" && cpr.value.data) setCompProducts(cpr.value.data as CompetitorProduct[]);
    if (vr.status === "fulfilled" && vr.value.data) setComparison(vr.value.data as PriceComparison[]);
    if (opr.status === "fulfilled" && opr.value.data) setOurProducts(opr.value.data as OurProduct[]);
    setCompLoading(false);
  }, [orgId]);

  useEffect(() => { loadCompetitors(); }, [loadCompetitors]);

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
    const { error } = editingComp
      ? await supabase.from("competitors").update(payload).eq("id", editingComp.id)
      : await supabase.from("competitors").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Competidor guardado");
    setShowCompDialog(false);
    loadCompetitors();
  }

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
    const { error } = editingProd
      ? await supabase.from("competitor_products").update(payload).eq("id", editingProd.id)
      : await supabase.from("competitor_products").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Producto guardado");
    setShowProdDialog(false);
    loadCompetitors();
  }

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
    loadCompetitors();
  }

  const filteredComparison = comparison.filter(c => {
    const matchSearch = !compSearch || c.their_product_name.toLowerCase().includes(compSearch.toLowerCase()) || (c.our_product_name ?? "").toLowerCase().includes(compSearch.toLowerCase()) || c.competitor_name.toLowerCase().includes(compSearch.toLowerCase());
    const matchPos = filterPosition === "all" || c.position === filterPosition;
    return matchSearch && matchPos;
  });

  const undercutCount = comparison.filter(c => c.position === "undercut").length;
  const aboveCount    = comparison.filter(c => c.position === "above").length;
  const avgDiffPct    = comparison.filter(c => c.price_diff_pct !== null).reduce((s, c, _, a) => s + (c.price_diff_pct ?? 0) / a.length, 0);

  return (
    <div className="space-y-8">
      {/* ═══════════════════════ Margin analysis (ex-Precios Inteligentes) ═══════════════ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Percent className="w-4 h-4 text-primary" />Análisis de Márgenes</h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Margen promedio" value={`${kpis.avgMargin.toFixed(1)}%`} icon={Percent}
            color={kpis.avgMargin >= 30 ? "success" : kpis.avgMargin >= 15 ? "warning" : "destructive"}
            sub={kpis.avgMargin >= 30 ? "por encima del objetivo" : "por debajo del objetivo"} />
          <KPICard label="Productos críticos" value={kpis.critical} icon={AlertTriangle} color={kpis.critical === 0 ? "success" : "destructive"} sub="margen < 10%" />
          <KPICard label="Contribución margen 30d" value={formatARS(kpis.totalMarginContrib)} icon={TrendingUp} color="blue" sub="ganancia × unidades vendidas" />
          <KPICard label="Tipo de cambio" value={`$${exchangeRate.toLocaleString("es-AR")}`} icon={DollarSign} color="primary" sub="USD → ARS configurado" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Cargando análisis…
          </div>
        ) : (
          <div className="space-y-6">
            {/* What-if rate simulator + target margin */}
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Simulador de escenarios</h4>
                <Badge variant="outline" className="text-[10px] ml-auto">¿Qué pasaría si…?</Badge>
              </div>
              <div className="flex gap-4 flex-wrap">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">TC USD simulado</label>
                  <Input type="number" placeholder={String(exchangeRate)} value={simRate} onChange={e => setSimRate(e.target.value)} className="w-36 h-8 text-xs" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Margen objetivo (%)</label>
                  <Input type="number" value={targetMargin} onChange={e => setTargetMargin(Number(e.target.value))} min="5" max="80" className="w-24 h-8 text-xs" />
                </div>
                <div className="flex items-end">
                  <Button size="sm" className="h-8 gradient-gold text-primary-foreground text-xs" onClick={load}>Simular</Button>
                </div>
                {simRate && (
                  <div className="flex items-end">
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSimRate("")}>Resetear</Button>
                  </div>
                )}
              </div>
              {simRate && Number(simRate) !== exchangeRate && (
                <p className="text-xs text-primary mt-2">
                  ⚡ Simulando TC ${Number(simRate).toLocaleString("es-AR")} (real: ${exchangeRate.toLocaleString("es-AR")}) — variación {((Number(simRate) - exchangeRate) / exchangeRate * 100).toFixed(1)}%
                </p>
              )}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {products.length > 0 && (
                <div className="bg-card border border-border/60 rounded-2xl p-5">
                  <h4 className="text-sm font-semibold mb-4">Precio vs Margen (scatter)</h4>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                        <XAxis dataKey="salePrice" name="Precio" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="marginPct" name="Margen" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ScatterTooltip />} />
                        <Scatter data={products} name="Productos">
                          {products.map((p, i) => <Cell key={i} fill={SCATTER_COLORS[p.zone]} fillOpacity={0.8} />)}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {categoryData.length > 0 && (
                <div className="bg-card border border-border/60 rounded-2xl p-5">
                  <h4 className="text-sm font-semibold mb-4">Margen promedio por categoría</h4>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" horizontal={false} />
                        <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number) => [`${v}%`, "Margen"]} contentStyle={{ background: "hsl(228 24% 9%)", border: "1px solid hsl(var(--border)/0.6)", borderRadius: "12px", fontSize: "12px" }} />
                        <Bar dataKey="margin" radius={[0, 4, 4, 0]}>
                          {categoryData.map((d, i) => <Cell key={i} fill={d.margin >= 30 ? "#22c55e" : d.margin >= 15 ? "#f59e0b" : "#ef4444"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* Zone legend */}
            <div className="flex gap-3 flex-wrap">
              {(Object.entries(ZONE_CONFIG) as [MarginZone, typeof ZONE_CONFIG[MarginZone]][]).map(([zone, cfg]) => {
                const count = products.filter(p => p.zone === zone).length;
                return (
                  <button key={zone} onClick={() => setZoneFilter(zoneFilter === zone ? "all" : zone)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs ${zoneFilter === zone ? `${cfg.bg} ${cfg.border} ${cfg.color}` : "border-border/40 text-muted-foreground hover:border-border"}`}>
                    <span className="w-2 h-2 rounded-full" style={{ background: zone === "excellent" ? "#22c55e" : zone === "good" ? "#f59e0b" : zone === "warning" ? "#f97316" : "#ef4444" }} />
                    {cfg.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-wrap items-center">
              <Input placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs h-8 text-xs" />
              <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="revenueImpact">Mayor impacto en margen</SelectItem>
                  <SelectItem value="marginPct">Menor margen primero</SelectItem>
                  <SelectItem value="unitsSold30d">Más vendidos 30d</SelectItem>
                  <SelectItem value="name">Nombre</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">{filtered.length} productos</span>
            </div>

            {/* Products table */}
            <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              {filtered.length === 0 ? (
                <div className="text-center py-12">
                  <Percent className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                  <p className="text-muted-foreground text-sm">Sin productos</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Costo ARS</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Precio</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ganancia</th>
                        <th className="text-center px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Margen</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Vendido 30d</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Precio sugerido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {filtered.map(p => {
                        const cfg = ZONE_CONFIG[p.zone];
                        const priceDiff = p.suggestedPrice - p.salePrice;
                        const needsPriceIncrease = priceDiff > 100;
                        return (
                          <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <div>
                                <p className="font-medium text-sm leading-snug">{p.name}</p>
                                <p className="text-[11px] text-muted-foreground">{p.brand || p.category}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden md:table-cell">
                              {formatARS(p.costArs)}
                              <span className="block text-[10px] opacity-60">USD {p.totalCostUsd.toFixed(2)}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">{formatARS(p.salePrice)}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${p.profitArs >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatARS(p.profitArs)}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant="outline" className={`text-[10px] font-bold ${cfg.color} ${cfg.border}`}>{p.marginPct.toFixed(1)}%</Badge>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden lg:table-cell">
                              {p.unitsSold30d > 0 ? `${p.unitsSold30d} u.` : <span className="opacity-40">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right hidden xl:table-cell">
                              {needsPriceIncrease ? (
                                <div>
                                  <p className="text-xs font-semibold text-primary">{formatARS(p.suggestedPrice)}</p>
                                  <p className="text-[10px] text-primary/60 flex items-center justify-end gap-0.5"><ArrowUpRight className="w-3 h-3" />+{formatARS(priceDiff)}</p>
                                </div>
                              ) : <span className="text-xs text-muted-foreground/40">OK</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════ Competitor benchmarking (ex-CompetitorPricingPage) ═══════ */}
      <div className="space-y-4 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between pt-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-primary" />Benchmarking de Precios vs Competencia</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadCompetitors}><RefreshCw className="w-3.5 h-3.5 mr-1" />Actualizar</Button>
            {compSubTab === "competidores" && <Button size="sm" onClick={openNewComp}><Plus className="w-3.5 h-3.5 mr-1" />Competidor</Button>}
            {compSubTab === "productos" && <Button size="sm" onClick={openNewProd}><Plus className="w-3.5 h-3.5 mr-1" />Producto</Button>}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Nos superan en precio" value={undercutCount} icon={TrendingDown} color="destructive" />
          <KPICard label="Somos más baratos" value={aboveCount} icon={TrendingUp} color="success" />
          <KPICard label="Competidores rastreados" value={competitors.filter(c => c.is_active).length} icon={Globe} color="primary" sub={`${competitors.length} en total`} />
          <KPICard label="Dif. promedio" value={`${avgDiffPct.toFixed(1)}%`} icon={Percent} color={avgDiffPct >= 0 ? "success" : "destructive"} />
        </div>

        <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
          {(["comparativa", "competidores", "productos"] as const).map(t => (
            <button key={t} onClick={() => setCompSubTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${compSubTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>

        {compLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Cargando competidores…
          </div>
        ) : (
          <>
            {compSubTab === "comparativa" && (
              <div className="space-y-4">
                <div className="flex gap-3 flex-wrap">
                  <Input placeholder="Buscar producto…" value={compSearch} onChange={e => setCompSearch(e.target.value)} className="w-56 h-9" />
                  <div className="flex gap-2">
                    {(["all", "undercut", "above", "parity", "unknown"] as const).map(pos => (
                      <button key={pos} onClick={() => setFilterPosition(pos)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterPosition === pos ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground hover:border-primary/30"}`}>
                        {pos === "all" ? "Todos" : POSITION_CONFIG[pos].label}
                      </button>
                    ))}
                  </div>
                </div>

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
                              {c.their_promotion && <span className="text-xs text-orange-400 bg-orange-500/10 px-1 rounded">{c.their_promotion}</span>}
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">
                              {c.our_price != null ? `$${c.our_price.toLocaleString("es-AR")}` : <span className="text-muted-foreground/70">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`font-medium ${c.their_price == null ? "text-muted-foreground/70" : c.position === "undercut" ? "text-red-600" : "text-foreground"}`}>
                                {c.their_price != null ? `$${c.their_price.toLocaleString("es-AR")}` : "—"}
                              </span>
                              {!c.their_in_stock && <Badge className="bg-muted/40 text-muted-foreground text-xs ml-1">Sin stock</Badge>}
                              {c.recorded_at && <p className="text-xs text-muted-foreground/70">{new Date(c.recorded_at).toLocaleDateString("es-AR")}</p>}
                            </td>
                            <td className="px-4 py-3">
                              {c.price_diff_pct != null ? (
                                <span className={`font-semibold flex items-center gap-1 ${c.price_diff_pct >= 0 ? "text-green-600" : "text-red-500"}`}>
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

            {compSubTab === "competidores" && (
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
                          <button onClick={() => supabase.from("competitors").delete().eq("id", c.id).then(loadCompetitors)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{prodCount} productos monitoreados</span>
                        <Badge className={c.is_active ? "bg-green-500/15 text-green-400 border-green-500/20" : "bg-muted/40 text-muted-foreground border-border/30"}>
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

            {compSubTab === "productos" && (
              <div className="bg-card rounded-xl border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>
                      {["Competidor", "Producto rival", "SKU rival", "Nuestro producto", "URL", ""].map(h => (
                        <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {compProducts.map(p => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">{p.competitors?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-foreground/80">{p.competitor_name}</td>
                        <td className="px-4 py-3 text-muted-foreground/70 font-mono text-xs">{p.competitor_sku ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.products?.name ?? <span className="text-muted-foreground/70 italic text-xs">Sin mapear</span>}</td>
                        <td className="px-4 py-3">
                          {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink className="w-4 h-4" /></a> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openRecordPrice(p.id)}><Plus className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => openEditProd(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => supabase.from("competitor_products").delete().eq("id", p.id).then(loadCompetitors)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {compProducts.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-12 text-muted-foreground/70">Sin productos cargados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Competitor Dialog ── */}
      <Dialog open={showCompDialog} onOpenChange={setShowCompDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingComp ? "Editar Competidor" : "Nuevo Competidor"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
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
          <div className="space-y-3 py-2">
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
          <div className="space-y-3 py-2">
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
