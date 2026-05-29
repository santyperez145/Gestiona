/**
 * PricingIntelligencePage — /precios-inteligentes
 *
 * Shows margin analysis per product, identifies underpriced or low-margin
 * items, and provides bulk price-update suggestions based on cost/rate changes.
 *
 * Data: products (cost_usd, sale_price_ars, profit_per_unit_ars, total_cost_usd)
 *       + settings (exchange_rate) + sales (to weigh by volume)
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Percent,
  RefreshCw, Download, Filter, ArrowUpRight, BarChart3, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, BarChart, Bar,
} from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type MarginZone = "excellent" | "good" | "warning" | "critical";

interface ProductMargin {
  id: string;
  name: string;
  category: string;
  brand: string;
  costUsd: number;
  totalCostUsd: number;
  costArs: number;         // totalCostUsd × exchangeRate
  salePrice: number;       // sale_price_ars
  profitArs: number;       // profit_per_unit_ars (from DB)
  marginPct: number;       // profitArs / salePrice * 100
  zone: MarginZone;
  stock: number;
  unitsSold30d: number;
  revenueImpact: number;   // profitArs × unitsSold30d (margin contribution)
  suggestedPrice: number;  // to hit targetMarginPct
}

// ─── Margin zones ──────────────────────────────────────────────────────────────

const ZONE_CONFIG: Record<MarginZone, { label: string; color: string; bg: string; border: string; min: number; max: number }> = {
  excellent: { label: "Excelente",  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", min: 40,  max: 100 },
  good:      { label: "Bueno",      color: "text-primary",     bg: "bg-primary/10",     border: "border-primary/30",     min: 25,  max: 40 },
  warning:   { label: "Bajo",       color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30",  min: 10,  max: 25 },
  critical:  { label: "Crítico",    color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     min: -999, max: 10 },
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

// ─── Custom Tooltip ────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingIntelligencePage() {
  usePageTitle("Precios Inteligentes");
  const { activeOrg } = useOrg();

  const [products, setProducts] = useState<ProductMargin[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchangeRate, setExchangeRate] = useState(1695);
  const [targetMargin, setTargetMargin] = useState(30); // %
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<MarginZone | "all">("all");
  const [sortBy, setSortBy] = useState<"marginPct" | "revenueImpact" | "name" | "unitsSold30d">("revenueImpact");

  // Simulated rate override for "what-if" analysis
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
    if (!simRate) setSimRate("");

    // Aggregate units sold per product_id/name
    const soldMap: Record<string, number> = {};
    (salesRes.data || []).forEach((s: any) => {
      const key = s.product_id || s.product_name;
      if (key) soldMap[key] = (soldMap[key] || 0) + (s.quantity || 1);
    });

    const rows: ProductMargin[] = (productsRes.data || []).map((p: any) => {
      const costArs = (p.total_cost_usd || 0) * effectiveRate;
      const profitArs = p.sale_price_ars - costArs;
      const marginPct = p.sale_price_ars > 0
        ? (profitArs / p.sale_price_ars) * 100
        : 0;
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
    const avgMargin = products.length > 0
      ? products.reduce((s, p) => s + p.marginPct, 0) / products.length
      : 0;
    const critical = products.filter(p => p.zone === "critical").length;
    const totalMarginContrib = products.reduce((s, p) => s + Math.max(0, p.revenueImpact), 0);
    const weightedAvg = products.reduce((s, p) => s + p.salePrice * p.unitsSold30d, 0);
    return { avgMargin, critical, totalMarginContrib, weightedAvg };
  }, [products]);

  // Category margin chart
  const categoryData = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    products.forEach(p => {
      if (!map[p.category]) map[p.category] = { total: 0, count: 0 };
      map[p.category].total += p.marginPct;
      map[p.category].count++;
    });
    return Object.entries(map)
      .map(([cat, { total, count }]) => ({
        name: cat.length > 18 ? cat.slice(0, 16) + "…" : cat,
        margin: Math.round(total / count * 10) / 10,
      }))
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

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Percent}
        title="Precios Inteligentes"
        description="Análisis de márgenes, rentabilidad por producto y simulación de precios"
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Margen promedio"
          value={`${kpis.avgMargin.toFixed(1)}%`}
          icon={Percent}
          color={kpis.avgMargin >= 30 ? "success" : kpis.avgMargin >= 15 ? "warning" : "destructive"}
          sub={kpis.avgMargin >= 30 ? "por encima del objetivo" : "por debajo del objetivo"}
        />
        <KPICard
          label="Productos críticos"
          value={kpis.critical}
          icon={AlertTriangle}
          color={kpis.critical === 0 ? "success" : "destructive"}
          sub="margen < 10%"
        />
        <KPICard
          label="Contribución margen 30d"
          value={formatARS(kpis.totalMarginContrib)}
          icon={TrendingUp}
          color="blue"
          sub="ganancia × unidades vendidas"
        />
        <KPICard
          label="Tipo de cambio"
          value={`$${exchangeRate.toLocaleString("es-AR")}`}
          icon={DollarSign}
          color="primary"
          sub="USD → ARS configurado"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando análisis…
        </div>
      ) : (
        <div className="space-y-6 pb-12">
          {/* What-if rate simulator + target margin */}
          <div className="bg-card border border-border/60 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Simulador de escenarios</h3>
              <Badge variant="outline" className="text-[10px] ml-auto">¿Qué pasaría si…?</Badge>
            </div>
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">TC USD simulado</label>
                <Input
                  type="number"
                  placeholder={String(exchangeRate)}
                  value={simRate}
                  onChange={e => setSimRate(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Margen objetivo (%)</label>
                <Input
                  type="number"
                  value={targetMargin}
                  onChange={e => setTargetMargin(Number(e.target.value))}
                  min="5"
                  max="80"
                  className="w-24 h-8 text-xs"
                />
              </div>
              <div className="flex items-end">
                <Button
                  size="sm"
                  className="h-8 gradient-gold text-primary-foreground text-xs"
                  onClick={load}
                >
                  Simular
                </Button>
              </div>
              {simRate && (
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => { setSimRate(""); }}
                  >
                    Resetear
                  </Button>
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
            {/* Scatter: price vs margin */}
            {products.length > 0 && (
              <div className="bg-card border border-border/60 rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Precio vs Margen (scatter)</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                      <XAxis
                        dataKey="salePrice"
                        name="Precio"
                        tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        dataKey="marginPct"
                        name="Margen"
                        tickFormatter={(v: number) => `${v}%`}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ScatterTooltip />} />
                      <Scatter data={products} name="Productos">
                        {products.map((p, i) => (
                          <Cell key={i} fill={SCATTER_COLORS[p.zone]} fillOpacity={0.8} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Bar: margin by category */}
            {categoryData.length > 0 && (
              <div className="bg-card border border-border/60 rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Margen promedio por categoría</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v: number) => [`${v}%`, "Margen"]}
                        contentStyle={{ background: "hsl(228 24% 9%)", border: "1px solid hsl(var(--border)/0.6)", borderRadius: "12px", fontSize: "12px" }}
                      />
                      <Bar dataKey="margin" radius={[0, 4, 4, 0]}>
                        {categoryData.map((d, i) => (
                          <Cell key={i} fill={d.margin >= 30 ? "#22c55e" : d.margin >= 15 ? "#f59e0b" : "#ef4444"} />
                        ))}
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
                <button
                  key={zone}
                  onClick={() => setZoneFilter(zoneFilter === zone ? "all" : zone)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs ${
                    zoneFilter === zone ? `${cfg.bg} ${cfg.border} ${cfg.color}` : "border-border/40 text-muted-foreground hover:border-border"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${cfg.bg.replace('/10', '')}`} style={{
                    background: zone === "excellent" ? "#22c55e" : zone === "good" ? "#f59e0b" : zone === "warning" ? "#f97316" : "#ef4444"
                  }} />
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <Input
              placeholder="Buscar producto…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
            <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
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
                          <td className={`px-4 py-3 text-right font-semibold ${p.profitArs >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatARS(p.profitArs)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-bold ${cfg.color} ${cfg.border}`}
                            >
                              {p.marginPct.toFixed(1)}%
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden lg:table-cell">
                            {p.unitsSold30d > 0 ? `${p.unitsSold30d} u.` : <span className="opacity-40">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right hidden xl:table-cell">
                            {needsPriceIncrease ? (
                              <div>
                                <p className="text-xs font-semibold text-primary">{formatARS(p.suggestedPrice)}</p>
                                <p className="text-[10px] text-primary/60 flex items-center justify-end gap-0.5">
                                  <ArrowUpRight className="w-3 h-3" />+{formatARS(priceDiff)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">OK</span>
                            )}
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
  );
}
