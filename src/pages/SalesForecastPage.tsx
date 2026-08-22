import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, AreaChart, Area, BarChart, Bar, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Target, AlertTriangle, Info, Loader2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function yyyymm(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

function addMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return yyyymm(d);
}

// Linear regression: returns slope and intercept
function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// R² goodness of fit
function rSquared(points: { x: number; y: number }[], slope: number, intercept: number) {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

// Moving average (window = 3)
function movingAvg(values: number[], window = 3): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((s, v) => s + v, 0) / window;
  });
}

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtK = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return fmt(n);
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function SalesForecastPage() {
  usePageTitle("Forecast de Ventas");
  const { activeOrg } = useOrg();
  const [salesRows, setSalesRows] = useState<{ created_at: string; total_ars: number }[]>([]);
  const [goalRows, setGoalRows] = useState<{ month: string; target_ars: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [forecastMonths, setForecastMonths] = useState(3);
  const [historyMonths, setHistoryMonths] = useState(12);

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    Promise.all([
      supabase.from("sales").select("created_at, total_ars").eq("org_id", activeOrg.id).gte("created_at", since.toISOString()),
      supabase.from("seller_goals").select("month, target_ars").eq("org_id", activeOrg.id).gte("month", since.toISOString().slice(0, 10)),
    ]).then(([{ data: s }, { data: g }]) => {
      setSalesRows((s as any[]) || []);
      setGoalRows((g as any[]) || []);
      setLoading(false);
    });
  }, [activeOrg]);

  // ── Monthly actuals ────────────────────────────────────────────────────────
  const monthlySales = useMemo(() => {
    const map = new Map<string, number>();
    salesRows.forEach(s => {
      const ym = yyyymm(new Date(s.created_at));
      map.set(ym, (map.get(ym) || 0) + (s.total_ars || 0));
    });
    return map;
  }, [salesRows]);

  // ── Monthly goals (aggregated across sellers) ─────────────────────────────
  const monthlyGoals = useMemo(() => {
    const map = new Map<string, number>();
    goalRows.forEach(g => {
      const ym = g.month.slice(0, 7);
      map.set(ym, (map.get(ym) || 0) + (g.target_ars || 0));
    });
    return map;
  }, [goalRows]);

  // ── Regression + forecast ─────────────────────────────────────────────────
  const { chartData, forecast, trend, r2 } = useMemo(() => {
    const today = new Date();
    const currentYm = yyyymm(today);

    // Build history array (last N months)
    const history: { ym: string; actual: number }[] = [];
    for (let i = historyMonths - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const ym = yyyymm(d);
      history.push({ ym, actual: monthlySales.get(ym) || 0 });
    }

    // Linear regression on past data (exclude current incomplete month)
    const pastHistory = history.filter(h => h.ym < currentYm);
    const regPoints = pastHistory.map((h, i) => ({ x: i, y: h.actual }));
    const { slope, intercept } = linearRegression(regPoints);
    const r2Val = rSquared(regPoints, slope, intercept);

    // Moving average
    const actuals = history.map(h => h.actual);
    const ma = movingAvg(actuals, 3);

    // Build chart data (history)
    const data: Record<string, any>[] = history.map((h, i) => ({
      ym: h.ym,
      label: monthLabel(h.ym),
      actual: h.actual,
      trend: ma[i] !== null ? Math.max(0, Math.round(ma[i]!)) : undefined,
      goal: monthlyGoals.get(h.ym) || undefined,
    }));

    // Future forecast
    const futureData: Record<string, any>[] = [];
    for (let i = 1; i <= forecastMonths; i++) {
      const ym = addMonth(currentYm, i);
      const x = pastHistory.length + i - 1;
      const predicted = Math.max(0, Math.round(slope * x + intercept));
      // Confidence band ±15% based on r²
      const uncertainty = Math.round(predicted * (1 - r2Val) * 0.5);
      futureData.push({
        ym,
        label: monthLabel(ym),
        forecast: predicted,
        upper: predicted + uncertainty,
        lower: Math.max(0, predicted - uncertainty),
        goal: monthlyGoals.get(ym) || undefined,
      });
    }

    // Trend: compare last 3 months vs previous 3
    const last3 = history.slice(-3).reduce((s, h) => s + h.actual, 0);
    const prev3 = history.slice(-6, -3).reduce((s, h) => s + h.actual, 0);
    const trendPct = prev3 > 0 ? ((last3 - prev3) / prev3) * 100 : 0;

    return {
      chartData: [...data, ...futureData],
      forecast: futureData,
      trend: trendPct,
      r2: r2Val,
    };
  }, [monthlySales, monthlyGoals, historyMonths, forecastMonths]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const today = new Date();
    const currentYm = yyyymm(today);
    const lastYm = addMonth(currentYm, -1);
    const currentActual = monthlySales.get(currentYm) || 0;
    const lastActual = monthlySales.get(lastYm) || 0;
    const nextForecast = forecast[0]?.forecast || 0;
    const currentGoal = monthlyGoals.get(currentYm) || 0;
    return { currentActual, lastActual, nextForecast, currentGoal };
  }, [monthlySales, monthlyGoals, forecast]);

  const TrendChip = ({ pct }: { pct: number }) => {
    if (Math.abs(pct) < 1) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Minus className="w-3 h-3" />Estable</span>;
    if (pct > 0) return <span className="flex items-center gap-1 text-xs text-emerald-400"><TrendingUp className="w-3 h-3" />+{pct.toFixed(1)}%</span>;
    return <span className="flex items-center gap-1 text-xs text-red-400"><TrendingDown className="w-3 h-3" />{pct.toFixed(1)}%</span>;
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  const todayLabel = monthLabel(yyyymm(new Date()));
  const momPct = kpis.lastActual > 0 ? ((kpis.currentActual - kpis.lastActual) / kpis.lastActual) * 100 : 0;
  const forecastPct = kpis.currentActual > 0 ? ((kpis.nextForecast - kpis.currentActual) / kpis.currentActual) * 100 : 0;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={TrendingUp}
        title="Forecast de Ventas"
        description={`Proyección basada en regresión lineal · últimos ${historyMonths} meses`}
        actions={
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Historial:</label>
              <Select value={String(historyMonths)} onValueChange={value => setHistoryMonths(Number(value))}>
                <SelectTrigger className="h-9 w-[108px] text-xs" aria-label="Meses de historial"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 meses</SelectItem>
                  <SelectItem value="12">12 meses</SelectItem>
                  <SelectItem value="18">18 meses</SelectItem>
                  <SelectItem value="24">24 meses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Proyección:</label>
              <Select value={String(forecastMonths)} onValueChange={value => setForecastMonths(Number(value))}>
                <SelectTrigger className="h-9 w-[100px] text-xs" aria-label="Meses de proyección"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 mes</SelectItem>
                  <SelectItem value="3">3 meses</SelectItem>
                  <SelectItem value="6">6 meses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          label="Mes actual"
          value={fmtK(kpis.currentActual)}
          sub={kpis.currentGoal > 0 ? `Meta: ${fmtK(kpis.currentGoal)} (${Math.round(kpis.currentActual / kpis.currentGoal * 100)}%)` : "en curso"}
          icon={TrendingUp}
          color="primary"
          trend={{ value: momPct, label: "vs mes ant." }}
        />
        <KPICard
          label="Mes pasado"
          value={fmtK(kpis.lastActual)}
          sub="ventas cerradas"
          icon={Target}
          color="blue"
        />
        <KPICard
          label="Forecast próx. mes"
          value={fmtK(kpis.nextForecast)}
          sub="proyección central"
          icon={TrendingUp}
          color="success"
          trend={{ value: forecastPct, label: "vs actual" }}
        />
        <KPICard
          label="Tendencia 3M"
          value={`${trend >= 0 ? "+" : ""}${trend.toFixed(1)}%`}
          sub={`Ajuste R²: ${(r2 * 100).toFixed(0)}%`}
          icon={trend >= 0 ? TrendingUp : TrendingDown}
          color={trend >= 0 ? "success" : "destructive"}
        />
      </div>

      {/* R² info */}
      {r2 < 0.5 && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-yellow-300">
            <span className="font-semibold">Ajuste bajo (R²={( r2 * 100).toFixed(0)}%).</span>{" "}
            Las ventas muestran alta variabilidad — el forecast es orientativo. Con más historial la precisión mejora.
          </p>
        </div>
      )}

      {/* Main chart */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Ventas reales + Forecast</h3>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-primary inline-block" />Real</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-blue-400 border-dashed border-t-2 inline-block" style={{ borderTop: '2px dashed #60a5fa', background: 'transparent' }} />Forecast</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-cyan-400 inline-block opacity-60" />Media móvil 3M</span>
            {monthlyGoals.size > 0 && <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-amber-400 border-dashed inline-block" />Meta</span>}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} width={70} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [fmt(v), { actual: "Real", forecast: "Forecast", trend: "Media 3M", goal: "Meta" }[name] || name]}
            />
            <ReferenceLine x={todayLabel} stroke="hsl(var(--primary) / 0.6)" strokeDasharray="4 4" label={{ value: "hoy", position: "top", fontSize: 10, fill: "hsl(var(--primary))" }} />
            <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="trend" stroke="#22d3ee" strokeWidth={1.5} dot={false} strokeOpacity={0.7} connectNulls />
            {monthlyGoals.size > 0 && (
              <Line type="monotone" dataKey="goal" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Forecast detail table */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Detalle del forecast</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs text-muted-foreground">
                <th className="py-2 px-4 text-left">Mes</th>
                <th className="py-2 px-4 text-right">Forecast central</th>
                <th className="py-2 px-4 text-right">Rango optimista</th>
                <th className="py-2 px-4 text-right">Rango conservador</th>
                {monthlyGoals.size > 0 && <th className="py-2 px-4 text-right">Meta equipo</th>}
                <th className="py-2 px-4 text-right">vs Meta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {forecast.map((f, i) => {
                const goalVal = f.goal || 0;
                const vsMeta = goalVal > 0 ? ((f.forecast - goalVal) / goalVal) * 100 : null;
                return (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="py-3 px-4 font-medium">{f.label}</td>
                    <td className="py-3 px-4 text-right font-semibold text-primary">{fmt(f.forecast)}</td>
                    <td className="py-3 px-4 text-right text-emerald-400 text-xs">{fmt(f.upper)}</td>
                    <td className="py-3 px-4 text-right text-orange-400 text-xs">{fmt(f.lower)}</td>
                    {monthlyGoals.size > 0 && <td className="py-3 px-4 text-right text-muted-foreground">{goalVal > 0 ? fmt(goalVal) : "—"}</td>}
                    <td className="py-3 px-4 text-right">
                      {vsMeta !== null ? (
                        <span className={`text-xs font-semibold ${vsMeta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {vsMeta >= 0 ? "+" : ""}{vsMeta.toFixed(1)}%
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>
            El forecast usa regresión lineal sobre los últimos {historyMonths} meses de datos reales.
            La banda de confianza se ajusta según la variabilidad histórica (R²={( r2 * 100).toFixed(0)}%).
            A mayor R², mayor precisión del modelo.
          </p>
        </div>
      </div>

      {/* Monthly bar comparison */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Ventas reales por mes</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData.filter(d => d.actual !== undefined)} margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} width={70} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [fmt(v), "Ventas"]}
            />
            <Bar dataKey="actual" radius={[4, 4, 0, 0]}>
              {chartData.filter(d => d.actual !== undefined).map((entry, i, arr) => (
                <Cell
                  key={i}
                  fill={i === arr.length - 1 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.4)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
