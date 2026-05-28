import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, TrendingUp, PieChart, LineChart, Plus, Download, Share2,
  Play, Search, Star, Clock, Filter, RefreshCw, Calendar,
  Users, Package, DollarSign, ChevronRight, Table, Layers,
  Sparkles, Zap, Eye, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";


const MONTH_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CHART_ICONS: Record<string, any> = {
  bar: BarChart3, line: LineChart, pie: PieChart, heatmap: Layers, table: Table,
};

const TYPE_COLORS: Record<string, string> = {
  sales: "bg-emerald-500/15 text-emerald-400",
  customers: "bg-blue-500/15 text-blue-400",
  inventory: "bg-purple-500/15 text-purple-400",
  finance: "bg-yellow-500/15 text-yellow-400",
  marketing: "bg-pink-500/15 text-pink-400",
  custom: "bg-primary/15 text-primary",
};

// Mini bar chart for revenue trend
function RevTrend({ data }: { data: SnapshotRow[] }) {
  const max = Math.max(...data.map(d => d.rev_day));
  return (
    <div className="flex items-end gap-1 h-16">
      {data.slice().reverse().map((d, i) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full rounded-t-sm bg-primary/60 hover:bg-primary transition-colors"
            style={{ height: `${(d.rev_day / max) * 48}px` }}
            title={`${d.date}: $${(d.rev_day / 1000).toFixed(0)}K`} />
          <span className="text-[8px] text-muted-foreground">{d.date.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

// Heatmap cell for cohort
function CohortCell({ value }: { value: number | null }) {
  if (value === null) return <td className="px-2 py-2 text-center text-xs text-muted-foreground/30">—</td>;
  const intensity = value / 100;
  return (
    <td className="px-2 py-2 text-center">
      <div className="rounded px-2 py-1 text-xs font-semibold transition-all" style={{
        background: `hsla(160, 60%, 45%, ${intensity * 0.7 + 0.05})`,
        color: intensity > 0.3 ? "white" : "#6b7280",
      }}>
        {value}%
      </div>
    </td>
  );
}

type SnapshotRow = { date: string; rev_day: number; orders_day: number; aov: number; margin: number; new_cust: number };
type ReportRow = { id: string; name: string; type: string; chart: string; pinned: boolean; runs: number; last_run: string; shared: boolean };
type CohortRow = { month: string; m0: number; m1: number | null; m2: number | null; m3: number | null; m4: number | null; m5: number | null };
type CatRevRow = { name: string; rev: number; pct: number };
type TopProductRow = { name: string; rev: number; orders: number; margin: number };

export default function BIReportsPage() {
  usePageTitle("Business Intelligence");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"overview" | "reports" | "cohort" | "drilldown">("overview");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [newReport, setNewReport] = useState({ name: "", type: "sales", chart: "bar" });
  const [savedReports, setSavedReports] = useState<ReportRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [cohortData, setCohortData] = useState<CohortRow[]>([]);
  const [categoryRev, setCategoryRev] = useState<CatRevRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);

  useEffect(() => {
    if (!orgId) return;
    // Load saved reports
    supabase
      .from("saved_reports")
      .select("id, name, report_type, chart_type, is_pinned, run_count, last_run_at, is_shared")
      .eq("org_id", orgId)
      .order("is_pinned", { ascending: false })
      .order("run_count", { ascending: false })
      .then(({ data }) => {
        setSavedReports((data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          type: r.report_type,
          chart: r.chart_type ?? "bar",
          pinned: r.is_pinned,
          runs: r.run_count,
          last_run: r.last_run_at ? new Date(r.last_run_at).toLocaleDateString("es-AR") : "—",
          shared: r.is_shared,
        })));
      });
    // Load BI snapshots (last 7 days)
    supabase
      .from("bi_snapshots")
      .select("snapshot_date, revenue_day, orders_day, avg_order_value, new_customers")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(7)
      .then(({ data }) => {
        setSnapshots((data ?? []).map((s: any) => ({
          date: s.snapshot_date,
          rev_day: Number(s.revenue_day),
          orders_day: s.orders_day,
          aov: Number(s.avg_order_value),
          margin: 0,
          new_cust: s.new_customers,
        })));
      });

    // Cohort retention — built from ecommerce_orders by customer first-purchase month
    supabase
      .from("ecommerce_orders")
      .select("customer_email, created_at, total")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const firstPurchase: Record<string, string> = {};
        const purchasesByCustomer: Record<string, Set<string>> = {};
        data.forEach((o: any) => {
          const email = o.customer_email;
          const month = (o.created_at as string).slice(0, 7);
          if (!firstPurchase[email]) firstPurchase[email] = month;
          if (!purchasesByCustomer[email]) purchasesByCustomer[email] = new Set();
          purchasesByCustomer[email].add(month);
        });
        const nowMonth = new Date().toISOString().slice(0, 7);
        const cohortMonths = [...new Set(Object.values(firstPurchase))].sort().slice(-5);
        const rows: CohortRow[] = cohortMonths.map((cohortMonth) => {
          const [, monthNum] = cohortMonth.split("-");
          const label = MONTH_LABELS[parseInt(monthNum, 10) - 1];
          const cohortCustomers = Object.keys(firstPurchase).filter(e => firstPurchase[e] === cohortMonth);
          const cohortSize = cohortCustomers.length || 1;
          const getRetention = (offset: number): number | null => {
            const target = addMonths(cohortMonth, offset);
            if (target > nowMonth) return null;
            const retained = cohortCustomers.filter(e => purchasesByCustomer[e].has(target)).length;
            return Math.round((retained / cohortSize) * 100);
          };
          return { month: label, m0: 100, m1: getRetention(1), m2: getRetention(2), m3: getRetention(3), m4: getRetention(4), m5: getRetention(5) };
        });
        setCohortData(rows);
      });

    // Category revenue — from sale_items joined to products
    supabase
      .from("sale_items")
      .select("quantity, unit_price, products(category)")
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const byCategory: Record<string, number> = {};
        data.forEach((item: any) => {
          const cat = item.products?.category || "Otros";
          byCategory[cat] = (byCategory[cat] || 0) + (Number(item.unit_price) * Number(item.quantity));
        });
        const total = Object.values(byCategory).reduce((a, b) => a + b, 0) || 1;
        const result: CatRevRow[] = Object.entries(byCategory)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([name, rev]) => ({ name, rev, pct: Math.round((rev / total) * 100) }));
        setCategoryRev(result);
      });

    // Top products drill-down — from products ordered by current_stock * cost or use sale_items
    supabase
      .from("sale_items")
      .select("quantity, unit_price, sale_id, products(name, cost_price)")
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const byProduct: Record<string, { rev: number; orders: Set<string>; cost: number }> = {};
        data.forEach((item: any) => {
          const name = item.products?.name || "Sin nombre";
          const cost = Number(item.products?.cost_price ?? 0);
          const rev = Number(item.unit_price) * Number(item.quantity);
          if (!byProduct[name]) byProduct[name] = { rev: 0, orders: new Set(), cost };
          byProduct[name].rev += rev;
          byProduct[name].orders.add(item.sale_id);
          byProduct[name].cost = cost;
        });
        const top: TopProductRow[] = Object.entries(byProduct)
          .sort(([, a], [, b]) => b.rev - a.rev)
          .slice(0, 5)
          .map(([name, d]) => ({
            name,
            rev: Math.round(d.rev),
            orders: d.orders.size,
            margin: d.rev > 0 ? Math.round(((d.rev - d.cost * d.orders.size) / d.rev) * 100) : 0,
          }));
        setTopProducts(top);
      });
  }, [orgId]);

  const runReport = async (id: string) => {
    setRunningId(id);
    await supabase.from("saved_reports").update({ run_count: (savedReports.find(r => r.id === id)?.runs ?? 0) + 1, last_run_at: new Date().toISOString() }).eq("id", id);
    setSavedReports(prev => prev.map(r => r.id === id ? { ...r, runs: r.runs + 1, last_run: "ahora" } : r));
    setTimeout(() => { setRunningId(null); toast.success("Reporte ejecutado — descarga lista"); }, 1800);
  };

  const filtered = savedReports.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const todayRev = snapshots[0]?.rev_day ?? 0;
  const yesterdayRev = snapshots[1]?.rev_day ?? 1;
  const revTrend = yesterdayRev > 0 ? Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100) : 0;
  const weekRev = snapshots.reduce((a, b) => a + b.rev_day, 0);

  const TABS = [
    { id: "overview",   label: "Overview" },
    { id: "reports",    label: "Reportes Guardados" },
    { id: "cohort",     label: "Cohort Retención" },
    { id: "drilldown",  label: "Drill-down" },
  ];

  const REPORT_TYPES = ["sales", "customers", "inventory", "finance", "marketing"];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={BarChart3}
        title="Business Intelligence"
        description="Reportes avanzados, cohort analysis y drill-down por dimensión"
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => toast.info("Snapshot generado")}>
              <RefreshCw className="w-3.5 h-3.5" />Actualizar snapshot
            </Button>
            <Button size="sm" onClick={() => setShowNewDialog(true)} className="gap-1.5 gradient-gold text-primary-foreground">
              <Plus className="w-3.5 h-3.5" />Nuevo Reporte
            </Button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Revenue hoy" value={`$${(todayRev / 1000).toFixed(0)}K`} icon={DollarSign} color="success" trend={snapshots.length > 1 ? { value: revTrend, label: "vs ayer" } : undefined} sub="ingresos del día" />
        <KPICard label="Revenue semana" value={`$${(weekRev / 1000).toFixed(0)}K`} icon={TrendingUp} color="primary" sub="últimos 7 días" />
        <KPICard label="AOV promedio" value={`$${(snapshots[0]?.aov ?? 0).toLocaleString("es-AR")}`} icon={Users} color="blue" sub="ticket promedio" />
        <KPICard label="Reportes guardados" value={savedReports.length} icon={BarChart3} color="purple" sub={`${savedReports.filter(r => r.pinned).length} fijados`} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Overview tab ─── */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue trend chart */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><LineChart className="w-4 h-4 text-primary" />Revenue últimos 7 días</h3>
              <Badge className="bg-primary/15 text-primary border-0 text-xs">diario</Badge>
            </div>
            <RevTrend data={snapshots} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[{ label: "Máx", v: `$${((snapshots.length ? Math.max(...snapshots.map(d => d.rev_day)) : 0) / 1000).toFixed(0)}K` },
                { label: "Prom", v: `$${((snapshots.length ? snapshots.reduce((a, b) => a + b.rev_day, 0) / snapshots.length : 0) / 1000).toFixed(0)}K` },
                { label: "Total", v: `$${(weekRev / 1000).toFixed(0)}K` }].map(m => (
                <div key={m.label} className="bg-muted/30 rounded-lg p-2">
                  <span className="text-[10px] text-muted-foreground">{m.label}</span>
                  <p className="font-semibold text-sm mt-0.5">{m.v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Category breakdown */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><PieChart className="w-4 h-4 text-primary" />Revenue por Categoría</h3>
            </div>
            <div className="space-y-3">
              {categoryRev.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sin datos de ventas por categoría</p>
              ) : categoryRev.map((c, i) => {
                const colors = ["bg-primary", "bg-blue-400", "bg-purple-400", "bg-emerald-400", "bg-yellow-400"];
                return (
                  <div key={c.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${colors[i]}`} />
                        <span>{c.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">${(c.rev / 1000).toFixed(0)}K</span>
                        <span className="font-semibold w-8 text-right">{c.pct}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full">
                      <div className={`h-1.5 rounded-full ${colors[i]}`} style={{ width: `${c.pct}%`, opacity: 0.8 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily metrics table */}
          <div className="lg:col-span-2 bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <h3 className="font-semibold flex items-center gap-2"><Table className="w-4 h-4 text-primary" />Snapshots Diarios</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Fecha", "Revenue", "Órdenes", "AOV", "Margen", "Nuevos Clientes"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s, i) => (
                    <tr key={s.date} className={`border-b border-border/20 hover:bg-muted/20 ${i === 0 ? "bg-primary/3" : ""}`}>
                      <td className="px-4 py-3 text-xs font-mono font-semibold">{s.date}{i === 0 ? " (hoy)" : ""}</td>
                      <td className="px-4 py-3 text-xs font-semibold">${(s.rev_day / 1000).toFixed(0)}K</td>
                      <td className="px-4 py-3 text-xs">{s.orders_day}</td>
                      <td className="px-4 py-3 text-xs">${s.aov.toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full">
                            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${s.margin}%` }} />
                          </div>
                          <span>{s.margin}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{s.new_cust}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reports tab ─── */}
      {tab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Buscar reporte..." className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setTypeFilter(null)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${!typeFilter ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                Todos
              </button>
              {REPORT_TYPES.map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${typeFilter === t ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(r => {
              const ChartIcon = CHART_ICONS[r.chart] || BarChart3;
              return (
                <div key={r.id} className="bg-card border border-border/40 rounded-xl p-5 hover:border-primary/30 transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <ChartIcon className="w-4 h-4 text-primary" />
                      </div>
                      {r.pinned && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                    </div>
                    <div className="flex items-center gap-1">
                      {r.shared && <Badge className="bg-blue-500/15 text-blue-400 border-0 text-xs">compartido</Badge>}
                      <Badge className={`${TYPE_COLORS[r.type]} border-0 text-xs`}>{r.type}</Badge>
                    </div>
                  </div>
                  <h4 className="font-semibold text-sm mb-1 leading-tight">{r.name}</h4>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                    <span className="flex items-center gap-1"><Play className="w-3 h-3" />{r.runs} ejecuciones</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.last_run}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 h-7 text-xs gap-1"
                      onClick={() => runReport(r.id)} disabled={runningId === r.id}>
                      {runningId === r.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      {runningId === r.id ? "Corriendo..." : "Ejecutar"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success("Descargando CSV...")}>
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success("Link copiado")}>
                      <Share2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Cohort tab ─── */}
      {tab === "cohort" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-primary" />Cohort de Retención de Clientes</h3>
              <p className="text-xs text-muted-foreground">% de clientes que volvieron a comprar en cada mes</p>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm min-w-[500px]">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-2 text-xs font-semibold text-muted-foreground">Cohorte</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 0</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 1</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 2</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 3</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 4</th>
                    <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">Mes 5</th>
                  </tr>
                </thead>
                <tbody>
                  {cohortData.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Sin datos de compras repetidas aún</td></tr>
                  ) : cohortData.map(row => (
                    <tr key={row.month}>
                      <td className="px-2 py-2 text-xs font-semibold text-muted-foreground">{row.month}</td>
                      <CohortCell value={row.m0} />
                      <CohortCell value={row.m1} />
                      <CohortCell value={row.m2} />
                      <CohortCell value={row.m3} />
                      <CohortCell value={row.m4} />
                      <CohortCell value={row.m5} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[0.1, 0.3, 0.5, 0.7, 1].map(i => (
                    <div key={i} className="w-4 h-4 rounded" style={{ background: `hsla(160, 60%, 45%, ${i * 0.7 + 0.05})` }} />
                  ))}
                </div>
                <span>Menor → Mayor retención</span>
              </div>
            </div>
          </div>

          {cohortData.length > 0 && (() => {
            const avg = (key: "m1"|"m2"|"m3") => {
              const vals = cohortData.map(r => r[key]).filter(v => v !== null) as number[];
              return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
            };
            return (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{avg("m1")}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Retención mes 1 (prom)</p>
                </div>
                <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-blue-400">{avg("m2")}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Retención mes 2 (prom)</p>
                </div>
                <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-400">{avg("m3")}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Retención mes 3 (prom)</p>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── Drilldown tab ─── */}
      {tab === "drilldown" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><Zap className="w-4 h-4 text-primary" />Drill-down por Dimensión</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { icon: Package, label: "Por Producto", desc: "Revenue, margen y velocidad por SKU" },
                { icon: Users, label: "Por Cliente", desc: "LTV, frecuencia, AOV por segmento" },
                { icon: BarChart3, label: "Por Categoría", desc: "Comparativa de categorías en el tiempo" },
                { icon: TrendingUp, label: "Por Vendedor", desc: "Performance, comisiones y pipeline" },
              ].map(d => (
                <button key={d.label} onClick={() => toast.info(`Drill-down: ${d.label}`)}
                  className="bg-muted/30 border border-border/40 hover:border-primary/30 rounded-xl p-4 text-left transition-all group">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                    <d.icon className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-sm font-semibold mb-1">{d.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{d.desc}</p>
                  <ChevronRight className="w-3.5 h-3.5 text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>

            {/* Quick drill by product — top 5 from real sale_items */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top Productos por Revenue</h4>
              <div className="space-y-2">
                {topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Sin datos de ventas disponibles</p>
                ) : topProducts.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{p.orders} ventas</span>
                        <span className="text-emerald-400">{p.margin}% margen</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold">${(p.rev / 1000).toFixed(0)}K</span>
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── New Report dialog ─── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Nuevo Reporte</h3>
              <button onClick={() => setShowNewDialog(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nombre del reporte</label>
                <Input value={newReport.name} onChange={e => setNewReport(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Revenue semanal por vendedor" className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tipo</label>
                  <select value={newReport.type} onChange={e => setNewReport(p => ({ ...p, type: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {REPORT_TYPES.map(t => <option key={t}>{t}</option>)}
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de gráfico</label>
                  <select value={newReport.chart} onChange={e => setNewReport(p => ({ ...p, chart: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {["bar", "line", "pie", "area", "table", "heatmap"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!newReport.name || !orgId) return;
                const { data, error } = await supabase.from("saved_reports").insert({
                  org_id: orgId, name: newReport.name, report_type: newReport.type, chart_type: newReport.chart,
                  is_pinned: false, run_count: 0, is_shared: false,
                }).select().single();
                if (error) { toast.error("Error guardando reporte"); return; }
                setSavedReports(prev => [{ id: data.id, name: data.name, type: data.report_type, chart: data.chart_type ?? "bar", pinned: false, runs: 0, last_run: "—", shared: false }, ...prev]);
                toast.success(`Reporte "${newReport.name}" creado`); setShowNewDialog(false); setNewReport({ name: "", type: "sales", chart: "bar" });
              }}
                disabled={!newReport.name} className="gradient-gold text-primary-foreground">
                Crear Reporte
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
