import { useState, useEffect, useCallback } from "react";
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
  Sparkles, Zap, Eye
} from "lucide-react";

// Mock saved reports
const MOCK_REPORTS = [
  { id: "r1", name: "Revenue mensual por categoría", type: "sales",     chart: "bar",     pinned: true,  runs: 142, last_run: "hace 2 hs", shared: true  },
  { id: "r2", name: "Cohort de retención Q1/Q2",     type: "customers", chart: "heatmap", pinned: true,  runs: 38,  last_run: "ayer",      shared: false },
  { id: "r3", name: "ABC análisis semanal",           type: "inventory", chart: "pie",     pinned: false, runs: 67,  last_run: "hace 3 días", shared: true },
  { id: "r4", name: "Gross margin por producto",      type: "finance",   chart: "table",   pinned: false, runs: 29,  last_run: "hace 1 sem", shared: false },
  { id: "r5", name: "Campaña email Q2 — resultados", type: "marketing", chart: "line",    pinned: false, runs: 15,  last_run: "hace 2 días", shared: true },
];

// Mock BI snapshot data
const MOCK_SNAPSHOTS = [
  { date: "2026-05-27", rev_day: 85000, orders_day: 23, aov: 3695, margin: 38.2, new_cust: 4 },
  { date: "2026-05-26", rev_day: 112000, orders_day: 31, aov: 3613, margin: 41.0, new_cust: 7 },
  { date: "2026-05-25", rev_day: 67000, orders_day: 19, aov: 3526, margin: 36.5, new_cust: 3 },
  { date: "2026-05-24", rev_day: 98000, orders_day: 27, aov: 3629, margin: 39.8, new_cust: 5 },
  { date: "2026-05-23", rev_day: 145000, orders_day: 42, aov: 3452, margin: 43.1, new_cust: 11 },
  { date: "2026-05-22", rev_day: 78000, orders_day: 21, aov: 3714, margin: 37.9, new_cust: 6 },
  { date: "2026-05-21", rev_day: 61000, orders_day: 16, aov: 3812, margin: 35.0, new_cust: 2 },
];

// Mock cohort retention
const COHORT_DATA = [
  { month: "Ene", m0: 100, m1: 42, m2: 31, m3: 28, m4: 25, m5: 22 },
  { month: "Feb", m0: 100, m1: 48, m2: 35, m3: 30, m4: 27, m5: null },
  { month: "Mar", m0: 100, m1: 45, m2: 33, m3: 28, m4: null, m5: null },
  { month: "Abr", m0: 100, m1: 51, m2: 38, m3: null, m4: null, m5: null },
  { month: "May", m0: 100, m1: 44, m2: null, m3: null, m4: null, m5: null },
];

// Category revenue split
const CATEGORY_REV = [
  { name: "Electrónica",  rev: 420000, pct: 38 },
  { name: "Textil",       rev: 231000, pct: 21 },
  { name: "Alimentos",    rev: 198000, pct: 18 },
  { name: "Herramientas", rev: 143000, pct: 13 },
  { name: "Otros",        rev: 110000, pct: 10 },
];

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
function RevTrend({ data }: { data: typeof MOCK_SNAPSHOTS }) {
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

function StatCard({ icon: Icon, label, value, sub, trend, color = "text-primary" }: any) {
  return (
    <div className="bg-card border border-border/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
          </div>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {trend !== undefined && (
          <Badge className={trend >= 0 ? "bg-emerald-500/15 text-emerald-400 border-0 text-xs" : "bg-red-500/15 text-red-400 border-0 text-xs"}>
            {trend >= 0 ? "+" : ""}{trend}%
          </Badge>
        )}
      </div>
      <p className="text-xl font-bold font-display">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function BIReportsPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"overview" | "reports" | "cohort" | "drilldown">("overview");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [newReport, setNewReport] = useState({ name: "", type: "sales", chart: "bar" });

  const runReport = (id: string) => {
    setRunningId(id);
    setTimeout(() => { setRunningId(null); toast.success("Reporte ejecutado — descarga lista"); }, 1800);
  };

  const filtered = MOCK_REPORTS.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const todayRev = MOCK_SNAPSHOTS[0].rev_day;
  const yesterdayRev = MOCK_SNAPSHOTS[1].rev_day;
  const revTrend = Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100);
  const weekRev = MOCK_SNAPSHOTS.slice(0, 7).reduce((a, b) => a + b.rev_day, 0);

  const TABS = [
    { id: "overview",   label: "Overview" },
    { id: "reports",    label: "Reportes Guardados" },
    { id: "cohort",     label: "Cohort Retención" },
    { id: "drilldown",  label: "Drill-down" },
  ];

  const REPORT_TYPES = ["sales", "customers", "inventory", "finance", "marketing"];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold">Business Intelligence</h1>
          </div>
          <p className="text-sm text-muted-foreground">Reportes avanzados, cohort analysis y drill-down por dimensión</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => toast.info("Snapshot generado")}>
            <RefreshCw className="w-3.5 h-3.5" />Actualizar snapshot
          </Button>
          <Button size="sm" onClick={() => setShowNewDialog(true)} className="gap-1.5 gradient-gold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" />Nuevo Reporte
          </Button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Revenue hoy"   value={`$${(todayRev / 1000).toFixed(0)}K`} trend={revTrend} color="text-emerald-400" />
        <StatCard icon={TrendingUp} label="Revenue semana" value={`$${(weekRev / 1000).toFixed(0)}K`} sub="últimos 7 días" />
        <StatCard icon={Users}      label="AOV promedio"   value={`$${MOCK_SNAPSHOTS[0].aov.toLocaleString("es-AR")}`} trend={2} />
        <StatCard icon={Sparkles}   label="Gross Margin"   value={`${MOCK_SNAPSHOTS[0].margin}%`} trend={1} color="text-primary" />
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
            <RevTrend data={MOCK_SNAPSHOTS} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[{ label: "Máx", v: `$${(Math.max(...MOCK_SNAPSHOTS.map(d => d.rev_day)) / 1000).toFixed(0)}K` },
                { label: "Prom", v: `$${((MOCK_SNAPSHOTS.reduce((a, b) => a + b.rev_day, 0) / MOCK_SNAPSHOTS.length) / 1000).toFixed(0)}K` },
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
              {CATEGORY_REV.map((c, i) => {
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
                  {MOCK_SNAPSHOTS.map((s, i) => (
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
                  {COHORT_DATA.map(row => (
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-primary">47%</p>
              <p className="text-xs text-muted-foreground mt-1">Retención mes 1 (prom)</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-blue-400">34%</p>
              <p className="text-xs text-muted-foreground mt-1">Retención mes 2 (prom)</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">29%</p>
              <p className="text-xs text-muted-foreground mt-1">Retención mes 3 (prom)</p>
            </div>
          </div>
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

            {/* Quick drill by product — top 5 */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top Productos — Este Mes</h4>
              <div className="space-y-2">
                {[
                  { name: "Producto Premium Alpha", rev: 185000, orders: 42, margin: 43 },
                  { name: "Kit Estándar XL",        rev: 142000, orders: 67, margin: 38 },
                  { name: "Accesorio Básico Pro",   rev: 98000,  orders: 156, margin: 52 },
                  { name: "Artículo Especial B2B",  rev: 87000,  orders: 8,  margin: 31 },
                  { name: "Bundle Completo V3",     rev: 65000,  orders: 23, margin: 47 },
                ].map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{p.orders} órdenes</span>
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
              <Button onClick={() => { toast.success(`Reporte "${newReport.name}" creado`); setShowNewDialog(false); setNewReport({ name: "", type: "sales", chart: "bar" }); }}
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
