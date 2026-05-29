import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, TrendingDown, Target, Clock, DollarSign, Users, Calendar, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from "recharts";
import { formatARS } from "@/lib/supabaseStore";

interface Outcome {
  id: string;
  deal_id: string;
  deal_title: string;
  outcome: "won" | "lost";
  reason: string | null;
  deal_value: number;
  currency: string;
  competitor: string | null;
  customer_name: string | null;
  seller_name: string | null;
  stage_at_close: string | null;
  days_in_pipeline: number | null;
  closed_at: string;
}

const PERIODS = [
  { value: "30",  label: "Últimos 30 días" },
  { value: "90",  label: "Últimos 90 días" },
  { value: "180", label: "Últimos 6 meses" },
  { value: "365", label: "Último año" },
  { value: "all", label: "Todo el período" },
];

export default function WinLossAnalyticsPage() {
  usePageTitle("Win/Loss Analytics");
  const { activeOrg } = useOrg();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("90");

  useEffect(() => {
    if (!activeOrg) return;
    const load = async () => {
      setLoading(true);
      let q = supabase
        .from("deal_outcomes")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("closed_at", { ascending: false });

      if (period !== "all") {
        const from = new Date();
        from.setDate(from.getDate() - Number(period));
        q = q.gte("closed_at", from.toISOString());
      }

      const { data } = await q;
      setOutcomes((data ?? []) as Outcome[]);
      setLoading(false);
    };
    load();
  }, [activeOrg, period]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const won  = outcomes.filter(o => o.outcome === "won");
    const lost = outcomes.filter(o => o.outcome === "lost");
    const total = won.length + lost.length;
    const winRate = total > 0 ? Math.round((won.length / total) * 100) : 0;
    const wonValue  = won.reduce((s, o) => s + (o.deal_value || 0), 0);
    const lostValue = lost.reduce((s, o) => s + (o.deal_value || 0), 0);
    const avgWonValue  = won.length > 0  ? wonValue  / won.length  : 0;
    const avgLostValue = lost.length > 0 ? lostValue / lost.length : 0;
    const wonDays  = won.filter(o => o.days_in_pipeline != null);
    const avgVelocity = wonDays.length > 0
      ? Math.round(wonDays.reduce((s, o) => s + (o.days_in_pipeline ?? 0), 0) / wonDays.length)
      : 0;
    return { won: won.length, lost: lost.length, winRate, wonValue, lostValue, avgWonValue, avgLostValue, avgVelocity, total };
  }, [outcomes]);

  // ── Reason breakdown ────────────────────────────────────────────────────
  const winReasons = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    outcomes.filter(o => o.outcome === "won").forEach(o => {
      const r = o.reason || "Sin registrar";
      if (!map[r]) map[r] = { count: 0, value: 0 };
      map[r].count += 1;
      map[r].value += o.deal_value || 0;
    });
    return Object.entries(map)
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [outcomes]);

  const lossReasons = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    outcomes.filter(o => o.outcome === "lost").forEach(o => {
      const r = o.reason || "Sin registrar";
      if (!map[r]) map[r] = { count: 0, value: 0 };
      map[r].count += 1;
      map[r].value += o.deal_value || 0;
    });
    return Object.entries(map)
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [outcomes]);

  // ── Monthly trend ───────────────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const byMonth: Record<string, { month: string; won: number; lost: number; wonValue: number; lostValue: number }> = {};
    outcomes.forEach(o => {
      const month = o.closed_at.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { month, won: 0, lost: 0, wonValue: 0, lostValue: 0 };
      if (o.outcome === "won") {
        byMonth[month].won += 1;
        byMonth[month].wonValue += o.deal_value || 0;
      } else {
        byMonth[month].lost += 1;
        byMonth[month].lostValue += o.deal_value || 0;
      }
    });
    return Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        ...m,
        label: new Date(m.month + "-01").toLocaleString("es-AR", { month: "short", year: "2-digit" }),
        winRate: (m.won + m.lost) > 0 ? Math.round((m.won / (m.won + m.lost)) * 100) : 0,
      }));
  }, [outcomes]);

  // ── Competitor breakdown ────────────────────────────────────────────────
  const competitors = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    outcomes
      .filter(o => o.outcome === "lost" && o.competitor)
      .forEach(o => {
        const c = o.competitor as string;
        if (!map[c]) map[c] = { count: 0, value: 0 };
        map[c].count += 1;
        map[c].value += o.deal_value || 0;
      });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [outcomes]);

  // ── Recent deals ────────────────────────────────────────────────────────
  const recent = outcomes.slice(0, 12);

  if (loading && outcomes.length === 0) {
    return (
      <div className="space-y-6 pb-12">
        <PageHeader icon={Trophy} title="Win/Loss Analytics" description="Análisis histórico de deals ganados y perdidos" />
        <p className="text-sm text-muted-foreground animate-pulse">Cargando histórico...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Trophy}
        title="Win/Loss Analytics"
        description="Análisis histórico de deals — ganados, perdidos y razones"
        actions={
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Win Rate"           value={`${stats.winRate}%`}              icon={Target}      color={stats.winRate >= 50 ? "success" : "warning"} sub={`${stats.total} deals cerrados`} />
        <KPICard label="Deals ganados"      value={stats.won}                        icon={Trophy}      color="success"     sub={formatARS(stats.wonValue)} />
        <KPICard label="Deals perdidos"     value={stats.lost}                       icon={TrendingDown} color="destructive" sub={formatARS(stats.lostValue)} />
        <KPICard label="Velocidad promedio" value={`${stats.avgVelocity} días`}       icon={Clock}       color="blue"        sub="lead → cierre ganado" />
      </div>

      {/* Monthly trend chart */}
      {monthlyTrend.length > 1 && (
        <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary/70" />
            <h2 className="font-display text-sm font-semibold tracking-tight">Tendencia mensual</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend}>
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left"  stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ background: "hsl(228 24% 9%)", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left"  type="monotone" dataKey="won"     stroke="#10b981" name="Ganados"  strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="left"  type="monotone" dataKey="lost"    stroke="#ef4444" name="Perdidos" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="winRate" stroke="#3b82f6" name="Win %"    strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Two-column: reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Win reasons */}
        <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display text-sm font-semibold tracking-tight">¿Por qué ganamos?</h2>
          </div>
          {winReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin datos en el período.</p>
          ) : (
            <div className="space-y-2">
              {winReasons.map(r => {
                const maxCount = winReasons[0].count;
                const pct = Math.round((r.count / maxCount) * 100);
                return (
                  <div key={r.reason} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{r.reason}</span>
                      <span className="text-muted-foreground">{r.count} · {formatARS(r.value)}</span>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Loss reasons */}
        <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <h2 className="font-display text-sm font-semibold tracking-tight">¿Por qué perdemos?</h2>
          </div>
          {lossReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin datos en el período.</p>
          ) : (
            <div className="space-y-2">
              {lossReasons.map(r => {
                const maxCount = lossReasons[0].count;
                const pct = Math.round((r.count / maxCount) * 100);
                return (
                  <div key={r.reason} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{r.reason}</span>
                      <span className="text-muted-foreground">{r.count} · {formatARS(r.value)}</span>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Competitor breakdown — only if there's competitor data */}
      {competitors.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-400" />
            <h2 className="font-display text-sm font-semibold tracking-tight">Top competidores que nos ganaron</h2>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={competitors} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} width={80} />
                <Tooltip contentStyle={{ background: "hsl(228 24% 9%)", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {competitors.map((_, i) => <Cell key={i} fill="#f97316" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent deals table */}
      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        <div className="p-5 pb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary/70" />
          <h2 className="font-display text-sm font-semibold tracking-tight">Últimos cierres</h2>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 pb-5 text-xs text-muted-foreground">Sin cierres registrados aún.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Deal</th>
                  <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                  <th className="text-right px-4 py-2.5 font-medium">Valor</th>
                  <th className="text-center px-4 py-2.5 font-medium">Días</th>
                  <th className="text-left px-4 py-2.5 font-medium">Razón</th>
                  <th className="text-center px-4 py-2.5 font-medium">Resultado</th>
                  <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {recent.map(o => (
                  <tr key={o.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{o.deal_title}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{o.customer_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{formatARS(o.deal_value)}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">{o.days_in_pipeline ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{o.reason ?? "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      {o.outcome === "won" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px]">Ganado</Badge>
                      ) : (
                        <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-[10px]">Perdido</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(o.closed_at).toLocaleDateString("es-AR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Empty state */}
      {outcomes.length === 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-10 text-center space-y-3">
          <DollarSign className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <p className="text-sm font-medium">Sin cierres en el período</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Los datos de Win/Loss se acumulan cuando marcás un deal como "Cerrado ✓" o "Perdido ✗" en el Pipeline.
            Cuanto más histórico, mejor el análisis.
          </p>
        </div>
      )}
    </div>
  );
}
