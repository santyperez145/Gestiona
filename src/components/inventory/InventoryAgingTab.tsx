/**
 * InventoryAgingTab — ported from the former InventoryAgingPage (/inventario-aging).
 * Rendered as the "Aging" tab inside InventoryValuationPage (/valuacion-inventario).
 *
 * Shows which products have not sold recently, how much capital is locked up
 * in slow-moving inventory, and recommended actions per product.
 *
 * Data: products table (stock, cost) + sales table (last sold date)
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Package, AlertTriangle, TrendingDown, DollarSign,
  RefreshCw, Download, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgingBucket = "0-30" | "31-60" | "61-90" | "90+" | "never";

interface AgingProduct {
  id: string;
  name: string;
  category: string;
  brand: string;
  stock: number;
  cost: number;
  price: number;
  stockValue: number; // stock × cost
  lastSoldDate: string | null;
  daysSinceSold: number; // Infinity if never sold
  bucket: AgingBucket;
  recommendation: string;
  unitsSoldLast90: number;
  daysOfStock: number; // stock / avg_daily_velocity (if >0)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBucket(days: number): AgingBucket {
  if (days === Infinity) return "never";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function getRecommendation(days: number, stock: number, velocity: number): string {
  if (days === Infinity && stock > 0) return "Sin historial de ventas — evaluar descuento o devolución a proveedor";
  if (days > 90) return "Inventario crítico — descuento agresivo o liquidación";
  if (days > 60) return "Movimiento lento — promocionar en campaña o hacer bundle";
  if (days > 30) return "Monitorear — considerar pequeña promoción";
  if (velocity > 0 && stock / velocity > 180) return "Sobrestock — reducir próxima compra";
  return "Stock saludable";
}

const BUCKET_CONFIG: Record<AgingBucket, { label: string; color: string; bg: string; border: string }> = {
  "0-30":  { label: "0-30 días",  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  "31-60": { label: "31-60 días", color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30" },
  "61-90": { label: "61-90 días", color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30" },
  "90+":   { label: "90+ días",   color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30" },
  "never": { label: "Sin ventas", color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border/40" },
};

const PIE_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#6b7280"];

// ─── Tab ──────────────────────────────────────────────────────────────────────

export default function InventoryAgingTab() {
  const { activeOrg } = useOrg();

  const [products, setProducts] = useState<AgingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<AgingBucket | "all">("all");
  const [sortBy, setSortBy] = useState<"daysSinceSold" | "stockValue" | "name">("daysSinceSold");

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const since90 = new Date();
    since90.setDate(since90.getDate() - 90);

    const [productsRes, salesRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, category, brand, stock, cost_usd, sale_price_ars, profit_per_unit_ars")
        .eq("org_id", activeOrg.id)
        .gt("stock", 0)
        .order("name"),
      supabase
        .from("sales")
        .select("product_name, product_id, date, quantity")
        .eq("org_id", activeOrg.id)
        .order("date", { ascending: false }),
    ]);

    const allSales: any[] = salesRes.data || [];
    const today = Date.now();

    // Map: product_id → latest sale date + units sold last 90d
    const productSaleMap = new Map<string, { lastDate: string; units90d: number }>();
    allSales.forEach((s: any) => {
      const key = s.product_id || s.product_name;
      if (!key) return;
      const entry = productSaleMap.get(key);
      const dAgo = (today - new Date(s.date).getTime()) / 86400000;
      if (!entry) {
        productSaleMap.set(key, {
          lastDate: s.date,
          units90d: dAgo <= 90 ? (s.quantity || 1) : 0,
        });
      } else {
        if (new Date(s.date) > new Date(entry.lastDate)) {
          entry.lastDate = s.date;
        }
        if (dAgo <= 90) {
          entry.units90d += s.quantity || 1;
        }
      }
    });

    const rows: AgingProduct[] = (productsRes.data || []).map((p: any) => {
      const saleInfo = productSaleMap.get(p.id) || productSaleMap.get(p.name);
      const lastSoldDate = saleInfo?.lastDate || null;
      const units90d = saleInfo?.units90d || 0;
      const daysSinceSold = lastSoldDate
        ? Math.floor((today - new Date(lastSoldDate).getTime()) / 86400000)
        : Infinity;
      const bucket = getBucket(daysSinceSold);
      const avgDailyVelocity = units90d / 90;
      const daysOfStock = avgDailyVelocity > 0
        ? Math.round(p.stock / avgDailyVelocity)
        : Infinity;
      // cost in ARS = sale_price_ars - profit_per_unit_ars (both stored in DB)
      const costARS = Math.max(0, (p.sale_price_ars || 0) - (p.profit_per_unit_ars || 0));
      const stockValue = (p.stock || 0) * costARS;

      return {
        id: p.id,
        name: p.name,
        category: p.category || "Sin categoría",
        brand: p.brand || "",
        stock: p.stock || 0,
        cost: costARS,
        price: p.sale_price_ars || 0,
        stockValue,
        lastSoldDate,
        daysSinceSold,
        bucket,
        recommendation: getRecommendation(daysSinceSold, p.stock, avgDailyVelocity),
        unitsSoldLast90: units90d,
        daysOfStock: isFinite(daysOfStock) ? daysOfStock : 9999,
      };
    });

    setProducts(rows);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
    }
    if (bucketFilter !== "all") {
      list = list.filter(p => p.bucket === bucketFilter);
    }
    return [...list].sort((a, b) => {
      if (sortBy === "daysSinceSold") {
        const aD = isFinite(a.daysSinceSold) ? a.daysSinceSold : 9999;
        const bD = isFinite(b.daysSinceSold) ? b.daysSinceSold : 9999;
        return bD - aD;
      }
      if (sortBy === "stockValue") return b.stockValue - a.stockValue;
      return a.name.localeCompare(b.name);
    });
  }, [products, search, bucketFilter, sortBy]);

  const kpis = useMemo(() => {
    const atRisk = products.filter(p => p.bucket === "90+" || p.bucket === "never");
    const capitalAtRisk = atRisk.reduce((s, p) => s + p.stockValue, 0);
    const totalCapital = products.reduce((s, p) => s + p.stockValue, 0);
    const slowMovers = products.filter(p => p.bucket === "61-90" || p.bucket === "90+" || p.bucket === "never").length;
    return { atRisk: atRisk.length, capitalAtRisk, totalCapital, slowMovers };
  }, [products]);

  // Pie data: capital by aging bucket
  const pieData = useMemo(() => {
    const buckets: AgingBucket[] = ["0-30", "31-60", "61-90", "90+", "never"];
    return buckets.map(b => ({
      name: BUCKET_CONFIG[b].label,
      value: products.filter(p => p.bucket === b).reduce((s, p) => s + p.stockValue, 0),
    })).filter(d => d.value > 0);
  }, [products]);

  const exportCSV = () => {
    const rows = [
      ["Producto", "Categoría", "Stock", "Costo Unit.", "Valor Stock", "Último venta", "Días sin vender", "Vendido últimos 90d", "Días de Stock", "Bucket", "Recomendación"],
      ...filtered.map(p => [
        p.name, p.category, p.stock, p.cost, p.stockValue,
        p.lastSoldDate || "Nunca", isFinite(p.daysSinceSold) ? p.daysSinceSold : "∞",
        p.unitsSoldLast90, p.daysOfStock >= 9999 ? "∞" : p.daysOfStock,
        BUCKET_CONFIG[p.bucket].label, p.recommendation,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aging-inventario-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success("CSV exportado");
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">Productos con poco movimiento y capital inmovilizado</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
          <Download className="w-3.5 h-3.5" /> Exportar CSV
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Productos en riesgo"
          value={String(kpis.atRisk)}
          icon={AlertTriangle}
          sub="Sin venta en +90 días"
          color="destructive"
        />
        <KPICard
          label="Capital inmovilizado"
          value={formatARS(kpis.capitalAtRisk)}
          icon={DollarSign}
          sub={kpis.totalCapital > 0 ? `${Math.round(kpis.capitalAtRisk / kpis.totalCapital * 100)}% del total` : "—"}
          color="warning"
        />
        <KPICard
          label="Capital total en stock"
          value={formatARS(kpis.totalCapital)}
          icon={Package}
          sub={`${products.length} productos con stock`}
          color="success"
        />
        <KPICard
          label="Movimiento lento"
          value={String(kpis.slowMovers)}
          icon={TrendingDown}
          sub="+60 días sin vender"
          color="warning"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando inventario…
        </div>
      ) : (
        <div className="space-y-6 pb-12">
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pie: capital by aging */}
            {pieData.length > 0 && (
              <div className="bg-card border border-border/60 rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Capital por antigüedad de stock</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => formatARS(v)}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border)/0.6)",
                          borderRadius: "12px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  {pieData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-semibold">{formatARS(d.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bucket summary */}
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4">Resumen por aging</h3>
              <div className="space-y-3 pb-12">
                {(["0-30", "31-60", "61-90", "90+", "never"] as AgingBucket[]).map(b => {
                  const cfg = BUCKET_CONFIG[b];
                  const inBucket = products.filter(p => p.bucket === b);
                  if (inBucket.length === 0) return null;
                  const capital = inBucket.reduce((s, p) => s + p.stockValue, 0);
                  const pct = kpis.totalCapital > 0 ? Math.round(capital / kpis.totalCapital * 100) : 0;
                  return (
                    <div key={b} className="flex items-center gap-3">
                      <span className={`text-[10px] font-semibold w-20 shrink-0 ${cfg.color}`}>{cfg.label}</span>
                      <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cfg.bg.replace('/10', '/40').replace('bg-', 'bg-')}`}
                          style={{
                            width: `${pct}%`,
                            background:
                              b === "0-30" ? "#22c55e" :
                              b === "31-60" ? "#eab308" :
                              b === "61-90" ? "#f97316" :
                              b === "90+" ? "#ef4444" : "#6b7280",
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                      <span className="text-xs font-semibold w-16 text-right">{inBucket.length} prod.</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <Input
              placeholder="Buscar producto, categoría…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
            <Select value={bucketFilter} onValueChange={v => setBucketFilter(v as AgingBucket | "all")}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <Filter className="w-3 h-3 mr-1" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="0-30">0-30 días</SelectItem>
                <SelectItem value="31-60">31-60 días</SelectItem>
                <SelectItem value="61-90">61-90 días</SelectItem>
                <SelectItem value="90+">90+ días</SelectItem>
                <SelectItem value="never">Sin ventas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daysSinceSold">Mayor antigüedad</SelectItem>
                <SelectItem value="stockValue">Mayor capital</SelectItem>
                <SelectItem value="name">Nombre</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} productos</span>
          </div>

          {/* Table */}
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-muted-foreground text-sm">Sin productos con las condiciones seleccionadas</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Categoría</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Stock</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Valor</th>
                      <th className="text-center px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Último venta</th>
                      <th className="text-center px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Días sin vender</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Vendido 90d</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Recomendación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {filtered.map(p => {
                      const cfg = BUCKET_CONFIG[p.bucket];
                      return (
                        <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-sm leading-snug">{p.name}</p>
                              {p.brand && <p className="text-[11px] text-muted-foreground">{p.brand}</p>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{p.category}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">{p.stock}</td>
                          <td className="px-4 py-3 text-right text-xs hidden md:table-cell">
                            <span className={p.bucket === "90+" || p.bucket === "never" ? "text-red-400 font-semibold" : ""}>
                              {formatARS(p.stockValue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                            {p.lastSoldDate
                              ? new Date(p.lastSoldDate).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
                              : <span className="text-muted-foreground/50">Nunca</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-semibold ${cfg.color} ${cfg.border}`}
                            >
                              {isFinite(p.daysSinceSold) ? `${p.daysSinceSold}d` : "∞"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden lg:table-cell">
                            {p.unitsSoldLast90} u.
                          </td>
                          <td className="px-4 py-3 hidden xl:table-cell">
                            <p className="text-[11px] text-muted-foreground max-w-[220px] leading-snug">{p.recommendation}</p>
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
