/**
 * TeamPerformancePage — /rendimiento-equipo
 *
 * Shows performance metrics for every seller:
 * sales volume, deals won, tasks completed, commission earned,
 * and month-over-month comparison. The "team pulse" view.
 *
 * Tabs: Ranking | Metas | Histórico
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Users, TrendingUp, CheckSquare, Trophy, DollarSign,
  RefreshCw, Calendar, ChevronUp, ChevronDown, Minus, BarChart3,
  Medal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SellerStats {
  name: string;
  email: string;
  salesCount: number;
  salesARS: number;
  salesCountPrev: number;
  salesARSPrev: number;
  dealsWon: number;
  dealsOpen: number;
  tasksCompleted: number;
  goalARS: number;         // from seller_goals
  goalPct: number;         // salesARS / goalARS
  commissionARS: number;
  salesTrend: number;      // % vs prev month
  rank: number;
}

type TabId = "ranking" | "metas" | "historial";

// ─── Month utilities ──────────────────────────────────────────────────────────

const MONTHS: { value: string; label: string }[] = [];
const _now = new Date();
for (let i = -5; i <= 0; i++) {
  const d = new Date(_now.getFullYear(), _now.getMonth() + i, 1);
  const value = d.toISOString().slice(0, 7);
  const label = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  MONTHS.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
}

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return d.toISOString().slice(0, 7);
}

// ─── Rank medal helper ────────────────────────────────────────────────────────

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-4 h-4 text-yellow-400" aria-label="Oro" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-slate-300" aria-label="Plata" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-700" aria-label="Bronce" />;
  return null;
}

// ─── Trend chip ───────────────────────────────────────────────────────────────

function TrendChip({ pct }: { pct: number }) {
  if (Math.abs(pct) < 1) return <Minus className="w-3 h-3 text-muted-foreground" />;
  return pct > 0
    ? <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 font-semibold"><ChevronUp className="w-3 h-3" />{pct.toFixed(0)}%</span>
    : <span className="text-[10px] text-red-400 flex items-center gap-0.5 font-semibold"><ChevronDown className="w-3 h-3" />{Math.abs(pct).toFixed(0)}%</span>;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[hsl(228_24%_9%)] border border-border/60 rounded-xl p-3 text-xs shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill || p.color }}>
          {p.name}: {p.name.includes("ARS") || p.name === "Ventas" || p.name === "Mes anterior"
            ? formatARS(p.value)
            : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl p-5 animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-border/40" />
            <div className="space-y-1.5">
              <div className="h-3 w-32 bg-border/40 rounded" />
              <div className="h-2.5 w-24 bg-border/30 rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 bg-border/30 rounded-xl" />
            <div className="h-16 bg-border/30 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamPerformancePage() {
  usePageTitle("Rendimiento del Equipo");
  const { activeOrg } = useOrg();

  const [selectedMonth, setSelectedMonth] = useState(MONTHS[MONTHS.length - 1].value);
  const [members, setMembers] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [stats, setStats] = useState<SellerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("ranking");

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    const prev = prevMonth(selectedMonth);
    const { start, end } = monthRange(selectedMonth);
    const { start: pStart, end: pEnd } = monthRange(prev);

    const [membersRes, salesRes, prevSalesRes, dealsRes, tasksRes, goalsRes] = await Promise.all([
      supabase
        .from("org_members")
        .select("user_id, role, profile:profiles(full_name, email)")
        .eq("org_id", activeOrg.id)
        .in("role", ["admin", "vendedor"]),
      supabase
        .from("sales")
        .select("seller_name, total_ars, quantity")
        .eq("org_id", activeOrg.id)
        .gte("created_at", start)
        .lte("created_at", end),
      supabase
        .from("sales")
        .select("seller_name, total_ars")
        .eq("org_id", activeOrg.id)
        .gte("created_at", pStart)
        .lte("created_at", pEnd),
      supabase
        .from("deals")
        .select("stage, value_ars, updated_at")
        .eq("org_id", activeOrg.id)
        .gte("updated_at", start)
        .lte("updated_at", end),
      supabase
        .from("tasks")
        .select("status, updated_at")
        .eq("org_id", activeOrg.id)
        .eq("status", "completed")
        .gte("updated_at", start)
        .lte("updated_at", end),
      supabase
        .from("seller_goals")
        .select("user_id, target_ars, commission_percent")
        .eq("org_id", activeOrg.id)
        .eq("month", `${selectedMonth}-01`),
    ]);

    const memberList = ((membersRes.data || []) as any[]).map(m => ({
      user_id: m.user_id,
      name: m.profile?.full_name || m.profile?.email || m.user_id.slice(0, 8),
      email: m.profile?.email || "",
    }));
    setMembers(memberList);

    // Aggregate sales by seller_name
    const salesByName: Record<string, { count: number; ars: number }> = {};
    (salesRes.data || []).forEach((s: any) => {
      const k = s.seller_name || "Sin asignar";
      if (!salesByName[k]) salesByName[k] = { count: 0, ars: 0 };
      salesByName[k].count++;
      salesByName[k].ars += s.total_ars || 0;
    });

    const prevByName: Record<string, number> = {};
    (prevSalesRes.data || []).forEach((s: any) => {
      const k = s.seller_name || "Sin asignar";
      prevByName[k] = (prevByName[k] || 0) + (s.total_ars || 0);
    });

    // Deals: count won/open (no seller_name on deals — count total for team)
    const dealsWonCount = (dealsRes.data || []).filter((d: any) => d.stage === "cerrado").length;
    const dealsOpenCount = (dealsRes.data || []).filter((d: any) => !["cerrado", "perdido"].includes(d.stage)).length;
    const tasksCompletedCount = (tasksRes.data || []).length;

    const goals = goalsRes.data || [];

    // Build SellerStats — match by name (seller_name on sales ↔ profile.full_name on members)
    const sellerStats: SellerStats[] = memberList.map(m => {
      // Try to match by exact name or first name
      const firstName = m.name.split(" ")[0];
      const matchKey = Object.keys(salesByName).find(k =>
        k === m.name || k === firstName || m.name.includes(k) || k.includes(firstName)
      ) || m.name;

      const cur = salesByName[matchKey] || { count: 0, ars: 0 };
      const prevARS = prevByName[matchKey] || 0;
      const trend = prevARS > 0 ? ((cur.ars - prevARS) / prevARS) * 100 : cur.ars > 0 ? 100 : 0;

      const goal = goals.find(g => g.user_id === m.user_id);
      const goalARS = goal?.target_ars || 0;
      const goalPct = goalARS > 0 ? Math.round((cur.ars / goalARS) * 100) : 0;
      const commissionARS = goal ? cur.ars * (goal.commission_percent / 100) : 0;

      // Distribute team-level metrics evenly (deals/tasks don't have seller assignment here)
      const teamSize = memberList.length || 1;
      return {
        name: m.name,
        email: m.email,
        salesCount: cur.count,
        salesARS: cur.ars,
        salesCountPrev: 0,
        salesARSPrev: prevARS,
        dealsWon: Math.round(dealsWonCount / teamSize),
        dealsOpen: Math.round(dealsOpenCount / teamSize),
        tasksCompleted: Math.round(tasksCompletedCount / teamSize),
        goalARS,
        goalPct,
        commissionARS,
        salesTrend: Math.round(trend * 10) / 10,
        rank: 0,
      };
    });

    // Sort by salesARS descending and assign rank
    sellerStats.sort((a, b) => b.salesARS - a.salesARS);
    sellerStats.forEach((s, i) => { s.rank = i + 1; });

    setStats(sellerStats);
    setLoading(false);
  }, [activeOrg, selectedMonth]);

  useEffect(() => { load(); }, [load]);

  const teamKPIs = useMemo(() => {
    const totalARS = stats.reduce((s, m) => s + m.salesARS, 0);
    const totalPrev = stats.reduce((s, m) => s + m.salesARSPrev, 0);
    const teamTrend = totalPrev > 0 ? ((totalARS - totalPrev) / totalPrev) * 100 : 0;
    const topSeller = stats[0];
    const atGoal = stats.filter(s => s.goalPct >= 100).length;
    const totalComm = stats.reduce((s, m) => s + m.commissionARS, 0);
    return { totalARS, teamTrend, topSeller, atGoal, totalComm };
  }, [stats]);

  // Chart data: sales per seller this month vs previous
  const chartData = stats.map(s => ({
    name: s.name.split(" ")[0],
    Ventas: Math.round(s.salesARS),
    "Mes anterior": Math.round(s.salesARSPrev),
  }));

  const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Rendimiento del Equipo"
        description={`Performance individual por vendedor — ${monthLabel}`}
      />

      {/* Month selector + refresh — always visible above tabs */}
      <div className="flex items-center gap-2 mb-5">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} title="Refrescar datos">
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="ml-1.5 text-xs">Refrescar</span>
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard
          title="Ventas totales equipo"
          value={formatARS(teamKPIs.totalARS)}
          icon={DollarSign}
          trend={`${teamKPIs.teamTrend >= 0 ? "+" : ""}${teamKPIs.teamTrend.toFixed(1)}% vs mes anterior`}
          trendUp={teamKPIs.teamTrend >= 0}
        />
        <KPICard
          title="Mejor vendedor"
          value={teamKPIs.topSeller?.name?.split(" ")[0] ?? "—"}
          icon={Trophy}
          trend={teamKPIs.topSeller ? formatARS(teamKPIs.topSeller.salesARS) : "—"}
          trendUp={true}
        />
        <KPICard
          title="Vendedores con meta"
          value={`${teamKPIs.atGoal} / ${stats.filter(s => s.goalARS > 0).length}`}
          icon={BarChart3}
          trend="Alcanzaron 100%+"
          trendUp={teamKPIs.atGoal > 0}
        />
        <KPICard
          title="Comisiones totales"
          value={formatARS(teamKPIs.totalComm)}
          icon={DollarSign}
          trend="Comisión sobre ventas reales"
          trendUp={teamKPIs.totalComm > 0}
        />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
        <TabsList className="bg-muted/60 p-1 rounded-xl mb-5">
          <TabsTrigger value="ranking" className="text-xs">Ranking</TabsTrigger>
          <TabsTrigger value="metas"   className="text-xs">Metas</TabsTrigger>
          <TabsTrigger value="historial" className="text-xs">Histórico</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Ranking ─────────────────────────────────────────────── */}
        <TabsContent value="ranking">
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <div className="space-y-6">
              {/* Bar chart */}
              {chartData.length > 0 && (
                <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold mb-4">Ventas por vendedor: este mes vs anterior</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barGap={4} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }} />
                        <Bar dataKey="Ventas" fill="hsl(38 82% 52%)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Mes anterior" fill="hsl(var(--border))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Seller cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {stats.map(seller => {
                  const isTop = seller.rank === 1;
                  return (
                    <div
                      key={seller.name}
                      className={`bg-[hsl(228_24%_7%)] border rounded-2xl p-5 space-y-3 ${
                        isTop ? "border-primary/40 bg-primary/[0.03]" : "border-border/60"
                      }`}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                            isTop ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted text-muted-foreground border border-border"
                          }`}>
                            {seller.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold flex items-center gap-1.5">
                              {seller.name}
                              <RankMedal rank={seller.rank} />
                            </p>
                            <p className="text-[11px] text-muted-foreground">{seller.email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Rango</p>
                          <p className="text-lg font-bold font-display">#{seller.rank}</p>
                        </div>
                      </div>

                      {/* Sales */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-background/30 rounded-xl p-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Ventas</p>
                          <p className="text-base font-bold font-display">{formatARS(seller.salesARS)}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <TrendChip pct={seller.salesTrend} />
                            <span className="text-[10px] text-muted-foreground">vs anterior</span>
                          </div>
                        </div>
                        <div className="bg-background/30 rounded-xl p-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Transacciones</p>
                          <p className="text-base font-bold font-display">{seller.salesCount}</p>
                          <p className="text-[10px] text-muted-foreground">operaciones</p>
                        </div>
                      </div>

                      {/* Goal progress */}
                      {seller.goalARS > 0 && (
                        <div>
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Meta: {formatARS(seller.goalARS)}</span>
                            <span className={seller.goalPct >= 100 ? "text-emerald-400 font-semibold" : ""}>{seller.goalPct}%</span>
                          </div>
                          <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${
                                seller.goalPct >= 100 ? "bg-emerald-500" :
                                seller.goalPct >= 75  ? "bg-primary" :
                                seller.goalPct >= 50  ? "bg-yellow-500" : "bg-red-500/70"
                              }`}
                              style={{ width: `${Math.min(seller.goalPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Commission + tasks */}
                      <div className="flex items-center justify-between pt-1 border-t border-border/30">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Comisión estimada</p>
                          <p className="text-sm font-semibold text-emerald-400">
                            {seller.commissionARS > 0 ? formatARS(seller.commissionARS) : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground">Tareas compl.</p>
                          <p className="text-sm font-semibold">{seller.tasksCompleted}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {stats.length === 0 && (
                <div className="text-center py-16">
                  <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-muted-foreground">Sin datos de vendedores para este período</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Metas ───────────────────────────────────────────────── */}
        <TabsContent value="metas">
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <div className="space-y-4">
              {stats.length === 0 ? (
                <div className="text-center py-16">
                  <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-muted-foreground">Sin datos de vendedores para este período</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {stats.map(seller => {
                      const hasGoal = seller.goalARS > 0;

                      // Status badge logic
                      let statusLabel = "Sin meta";
                      let statusVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
                      if (hasGoal) {
                        if (seller.goalPct >= 100) {
                          statusLabel = "En meta";
                          statusVariant = "default"; // success — use default (primary) as success proxy
                        } else if (seller.goalPct >= 60) {
                          statusLabel = "En progreso";
                          statusVariant = "secondary";
                        } else {
                          statusLabel = "Rezagado";
                          statusVariant = "destructive";
                        }
                      }

                      return (
                        <div
                          key={seller.name}
                          className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl p-5 space-y-4"
                        >
                          {/* Header: name + role + status badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground border border-border flex items-center justify-center text-sm font-bold shrink-0">
                                {seller.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{seller.name}</p>
                                <p className="text-[11px] text-muted-foreground">{seller.email}</p>
                              </div>
                            </div>
                            <Badge
                              variant={statusVariant}
                              className={`text-[10px] shrink-0 ${
                                statusLabel === "En meta" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                                statusLabel === "En progreso" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                                statusLabel === "Rezagado" ? "" : "text-muted-foreground"
                              }`}
                            >
                              {statusLabel}
                            </Badge>
                          </div>

                          {hasGoal ? (
                            <>
                              {/* Goal progress bar */}
                              <div>
                                <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
                                  <span>Progreso hacia meta</span>
                                  <span className={`font-semibold ${
                                    seller.goalPct >= 100 ? "text-emerald-400" :
                                    seller.goalPct >= 60  ? "text-yellow-400" : "text-red-400"
                                  }`}>{seller.goalPct}%</span>
                                </div>
                                <div className="h-2 bg-border/40 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${
                                      seller.goalPct >= 100 ? "bg-emerald-500" :
                                      seller.goalPct >= 75  ? "bg-primary" :
                                      seller.goalPct >= 60  ? "bg-yellow-500" : "bg-red-500/70"
                                    }`}
                                    style={{ width: `${Math.min(seller.goalPct, 100)}%` }}
                                  />
                                </div>
                              </div>

                              {/* Revenue vs target */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-background/30 rounded-xl p-3">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Alcanzado</p>
                                  <p className="text-sm font-bold font-display">{formatARS(seller.salesARS)}</p>
                                </div>
                                <div className="bg-background/30 rounded-xl p-3">
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Meta</p>
                                  <p className="text-sm font-bold font-display">{formatARS(seller.goalARS)}</p>
                                </div>
                              </div>

                              {/* Commission earned */}
                              <div className="pt-1 border-t border-border/30 flex items-center justify-between">
                                <p className="text-[10px] text-muted-foreground">Comisión ganada</p>
                                <p className="text-sm font-semibold text-emerald-400">
                                  {seller.commissionARS > 0 ? formatARS(seller.commissionARS) : "—"}
                                </p>
                              </div>
                            </>
                          ) : (
                            <div className="py-4 text-center">
                              <p className="text-xs text-muted-foreground">Sin meta definida</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-muted-foreground text-center pt-2">
                    Las metas se configuran en /metas
                  </p>
                </>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 3: Histórico ───────────────────────────────────────────── */}
        <TabsContent value="historial">
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <div className="space-y-6">
              {/* Comparison bar chart */}
              {chartData.length > 0 && (
                <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold mb-1">Comparativa mes actual vs anterior</h3>
                  <p className="text-[11px] text-muted-foreground mb-4">{monthLabel}</p>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barGap={4} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }} />
                        <Bar dataKey="Ventas" fill="hsl(38 82% 52%)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Mes anterior" fill="hsl(var(--border))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Comparison table */}
              {stats.length > 0 ? (
                <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 bg-background/30">
                        <th className="text-left px-4 py-3 text-muted-foreground font-medium">Vendedor</th>
                        <th className="text-right px-4 py-3 text-muted-foreground font-medium">Mes actual</th>
                        <th className="text-right px-4 py-3 text-muted-foreground font-medium">Mes anterior</th>
                        <th className="text-right px-4 py-3 text-muted-foreground font-medium">Variación %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((seller, idx) => {
                        const variation = seller.salesTrend;
                        return (
                          <tr
                            key={seller.name}
                            className={`border-b border-border/20 hover:bg-background/20 transition-colors ${
                              idx % 2 === 0 ? "" : "bg-background/10"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <RankMedal rank={seller.rank} />
                                <span className="font-medium">{seller.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {formatARS(seller.salesARS)}
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">
                              {formatARS(seller.salesARSPrev)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-semibold ${
                                Math.abs(variation) < 1 ? "text-muted-foreground" :
                                variation > 0 ? "text-emerald-400" : "text-red-400"
                              }`}>
                                {Math.abs(variation) < 1
                                  ? "—"
                                  : `${variation > 0 ? "+" : ""}${variation.toFixed(1)}%`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-16">
                  <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-muted-foreground">Sin datos de vendedores para este período</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
