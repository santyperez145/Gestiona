import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Target, Trophy, TrendingUp, Users, Plus, ChevronUp, ChevronDown,
  Medal, Flame, CheckCircle2, AlertCircle, BarChart3, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SellerGoal {
  id: string;
  user_id: string;
  month: string;          // YYYY-MM-01
  target_ars: number;
  commission_percent: number;
  total_sales_ars: number;
  total_commission_ars: number;
}

interface OrgMember {
  user_id: string;
  role: string;
  profile?: { full_name?: string; email?: string };
}

interface SellerRow {
  user_id: string;
  name: string;
  email: string;
  goal: SellerGoal | null;
  actualSales: number;     // from sales table (current month)
  pct: number;             // actualSales / target * 100
  commission: number;      // actualSales * commission_percent / 100
}

// ─── Month helpers ────────────────────────────────────────────────────────────

const MONTHS: { value: string; label: string }[] = [];
const _now = new Date();
for (let i = -5; i <= 1; i++) {
  const d = new Date(_now.getFullYear(), _now.getMonth() + i, 1);
  const value = d.toISOString().slice(0, 7); // YYYY-MM
  const label = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  MONTHS.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
}

function monthToDate(ym: string) { return `${ym}-01`; } // YYYY-MM → YYYY-MM-01

function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Rank medal ──────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-bold text-base">🥇</span>;
  if (rank === 2) return <span className="text-slate-300 font-bold text-base">🥈</span>;
  if (rank === 3) return <span className="text-amber-600 font-bold text-base">🥉</span>;
  return <span className="text-muted-foreground text-sm font-mono">#{rank}</span>;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const color =
    pct >= 100 ? "bg-emerald-500" :
    pct >= 75  ? "bg-primary" :
    pct >= 50  ? "bg-yellow-500" :
                 "bg-red-500/70";
  return (
    <div className="relative w-full h-2 bg-border/40 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${clamped}%` }}
      />
      {pct >= 100 && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        </div>
      )}
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[hsl(228_24%_9%)] border border-border/60 rounded-xl p-3 text-xs shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill || p.color }}>
          {p.name}: {formatARS(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SellerGoalsPage() {
  usePageTitle("Metas de Ventas");
  const { activeOrg } = useOrg();

  const [selectedMonth, setSelectedMonth] = useState(MONTHS.find(m => m.value === _now.toISOString().slice(0, 7))?.value ?? MONTHS[5].value);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [goals, setGoals] = useState<SellerGoal[]>([]);
  const [salesByName, setSalesByName] = useState<Record<string, number>>({}); // seller_name → total
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialog, setDialog] = useState(false);
  const [editGoal, setEditGoal] = useState<SellerGoal | null>(null);
  const [formUserId, setFormUserId] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formCommission, setFormCommission] = useState("10");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { start, end } = monthRange(selectedMonth);

    const [membersRes, goalsRes, salesRes] = await Promise.all([
      supabase
        .from("org_members")
        .select("user_id, role, profile:profiles(full_name, email)")
        .eq("org_id", activeOrg.id)
        .in("role", ["admin", "vendedor"]),
      supabase
        .from("seller_goals")
        .select("id, user_id, month, target_ars, commission_percent, total_sales_ars, total_commission_ars")
        .eq("org_id", activeOrg.id)
        .eq("month", monthToDate(selectedMonth)),
      supabase
        .from("sales")
        .select("seller_name, total_ars")
        .eq("org_id", activeOrg.id)
        .gte("created_at", start)
        .lte("created_at", end),
    ]);

    setMembers((membersRes.data || []) as OrgMember[]);
    setGoals((goalsRes.data || []) as SellerGoal[]);

    // Aggregate sales by seller_name
    const byName: Record<string, number> = {};
    (salesRes.data || []).forEach((s: any) => {
      if (s.seller_name) {
        byName[s.seller_name] = (byName[s.seller_name] || 0) + (s.total_ars || 0);
      }
    });
    setSalesByName(byName);
    setLoading(false);
  }, [activeOrg, selectedMonth]);

  useEffect(() => { load(); }, [load]);

  // Build seller rows
  const sellerRows = useMemo<SellerRow[]>(() => {
    return members.map(m => {
      const name = (m.profile as any)?.full_name || (m.profile as any)?.email || m.user_id.slice(0, 8);
      const goal = goals.find(g => g.user_id === m.user_id) || null;
      const actual = salesByName[name] || 0;
      const target = goal?.target_ars || 0;
      const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
      const commPct = goal?.commission_percent || 0;
      return {
        user_id: m.user_id,
        name,
        email: (m.profile as any)?.email || "",
        goal,
        actualSales: actual,
        pct,
        commission: actual * (commPct / 100),
      };
    }).sort((a, b) => b.actualSales - a.actualSales);
  }, [members, goals, salesByName]);

  // KPI aggregates
  const kpis = useMemo(() => {
    const totalTarget = sellerRows.reduce((s, r) => s + (r.goal?.target_ars || 0), 0);
    const totalActual = sellerRows.reduce((s, r) => s + r.actualSales, 0);
    const teamPct = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
    const achieved = sellerRows.filter(r => r.pct >= 100).length;
    return { totalTarget, totalActual, teamPct, achieved };
  }, [sellerRows]);

  // Chart data
  const chartData = sellerRows
    .filter(r => r.goal?.target_ars || r.actualSales)
    .map(r => ({
      name: r.name.split(" ")[0], // first name only
      Target: r.goal?.target_ars || 0,
      Actual: r.actualSales,
    }));

  // Dialog helpers
  const openCreate = () => {
    setEditGoal(null);
    setFormUserId(members[0]?.user_id || "");
    setFormTarget("");
    setFormCommission("10");
    setDialog(true);
  };

  const openEdit = (row: SellerRow) => {
    setEditGoal(row.goal);
    setFormUserId(row.user_id);
    setFormTarget(String(row.goal?.target_ars || ""));
    setFormCommission(String(row.goal?.commission_percent || 10));
    setDialog(true);
  };

  const handleSave = async () => {
    if (!activeOrg || !formUserId || !formTarget) return;
    setSaving(true);
    const payload = {
      org_id: activeOrg.id,
      user_id: formUserId,
      owner_id: formUserId,
      month: monthToDate(selectedMonth),
      target_ars: Number(formTarget),
      commission_percent: Number(formCommission),
      total_sales_ars: 0,
      total_commission_ars: 0,
    };

    const { error } = editGoal
      ? await supabase.from("seller_goals").update({
          target_ars: payload.target_ars,
          commission_percent: payload.commission_percent,
        }).eq("id", editGoal.id)
      : await supabase.from("seller_goals").upsert(payload, { onConflict: "user_id,month" });

    if (error) {
      toast.error("Error al guardar meta");
    } else {
      toast.success(editGoal ? "Meta actualizada" : "Meta creada");
      setDialog(false);
      load();
    }
    setSaving(false);
  };

  const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div>
      <PageHeader
        icon={Target}
        title="Metas de Ventas"
        description={`Cuotas y performance del equipo — ${monthLabel}`}
        actions={
          <div className="flex gap-2">
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
            <Button size="sm" className="gap-1.5 gradient-gold text-primary-foreground" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5" /> Nueva Meta
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard
          title="Meta Total Equipo"
          value={formatARS(kpis.totalTarget)}
          icon={Target}
          trend={kpis.totalTarget > 0 ? `${kpis.teamPct}% logrado` : "Sin metas"}
          trendUp={kpis.teamPct >= 100}
        />
        <KPICard
          title="Ventas Reales"
          value={formatARS(kpis.totalActual)}
          icon={TrendingUp}
          trend={kpis.teamPct > 0 ? `${kpis.teamPct}% del objetivo` : "—"}
          trendUp={kpis.teamPct >= 75}
        />
        <KPICard
          title="% Objetivo Equipo"
          value={`${kpis.teamPct}%`}
          icon={BarChart3}
          trend={kpis.teamPct >= 100 ? "🎯 Meta superada" : kpis.teamPct >= 75 ? "En camino" : "Por debajo"}
          trendUp={kpis.teamPct >= 75}
        />
        <KPICard
          title="Vendedores al 100%"
          value={`${kpis.achieved} / ${sellerRows.length}`}
          icon={Trophy}
          trend={kpis.achieved > 0 ? `${kpis.achieved} cumplieron la meta` : "Ninguno aún"}
          trendUp={kpis.achieved > 0}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando datos…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Target vs Real por Vendedor
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={4} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Target" fill="hsl(var(--border))" radius={[4, 4, 0, 0]} name="Target" />
                    <Bar dataKey="Actual" radius={[4, 4, 0, 0]} name="Actual">
                      {chartData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.Actual >= entry.Target ? "hsl(142 71% 45%)" :
                            entry.Actual >= entry.Target * 0.75 ? "hsl(38 82% 52%)" :
                            "hsl(4 86% 58%)"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-2 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-border inline-block" /> Target</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-500 inline-block" /> Real (logrado)</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-primary inline-block" /> Real (en camino)</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-red-500/70 inline-block" /> Real (bajo)</span>
              </div>
            </div>
          )}

          {/* Leaderboard */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Leaderboard — {monthLabel}</h3>
              <Badge variant="outline" className="ml-auto text-[10px]">{sellerRows.length} vendedores</Badge>
            </div>

            {sellerRows.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-muted-foreground text-sm">Sin vendedores en la organización</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {sellerRows.map((row, idx) => {
                  const rank = idx + 1;
                  const hasGoal = row.goal !== null;
                  const isOver = row.pct >= 100;
                  const isAtRisk = hasGoal && row.pct < 50 && row.actualSales > 0;

                  return (
                    <div
                      key={row.user_id}
                      className={`px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors ${rank === 1 ? 'bg-yellow-500/[0.04]' : ''}`}
                    >
                      {/* Rank */}
                      <div className="w-8 text-center shrink-0">
                        <RankBadge rank={rank} />
                      </div>

                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {row.name.charAt(0).toUpperCase()}
                        </span>
                      </div>

                      {/* Name + email */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold truncate">{row.name}</p>
                          {isOver && <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5"><Flame className="w-3 h-3" /> Meta!</span>}
                          {isAtRisk && <span className="text-[10px] text-orange-400 flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> En riesgo</span>}
                          {!hasGoal && <Badge variant="outline" className="text-[9px] text-muted-foreground">Sin meta</Badge>}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{row.email}</p>
                      </div>

                      {/* Progress */}
                      <div className="w-40 shrink-0 hidden sm:block">
                        {hasGoal ? (
                          <>
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                              <span>{formatARS(row.actualSales)}</span>
                              <span>{row.pct}%</span>
                            </div>
                            <ProgressBar pct={row.pct} />
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Meta: {formatARS(row.goal!.target_ars)}
                            </p>
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {formatARS(row.actualSales)} vendido
                          </div>
                        )}
                      </div>

                      {/* Commission */}
                      <div className="text-right shrink-0 hidden md:block w-28">
                        {hasGoal && row.goal!.commission_percent > 0 ? (
                          <>
                            <p className="text-sm font-semibold text-emerald-400">{formatARS(row.commission)}</p>
                            <p className="text-[10px] text-muted-foreground">{row.goal!.commission_percent}% comisión</p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">—</p>
                        )}
                      </div>

                      {/* Edit button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => openEdit(row)}
                      >
                        {hasGoal ? "Editar" : "Asignar"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Progress detail cards for mobile */}
          <div className="sm:hidden space-y-3">
            {sellerRows.filter(r => r.goal).map(row => (
              <div key={row.user_id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">{row.name}</p>
                  <span className="text-sm font-bold">{row.pct}%</span>
                </div>
                <ProgressBar pct={row.pct} />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Real: {formatARS(row.actualSales)}</span>
                  <span>Meta: {formatARS(row.goal!.target_ars)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Goal Dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              {editGoal ? "Editar Meta" : "Nueva Meta de Ventas"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Seller picker */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Vendedor</label>
              <Select value={formUserId} onValueChange={setFormUserId} disabled={!!editGoal}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {members.map(m => {
                    const n = (m.profile as any)?.full_name || (m.profile as any)?.email || m.user_id.slice(0, 8);
                    return <SelectItem key={m.user_id} value={m.user_id}>{n}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Month display */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Mes</label>
              <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/30 text-sm">
                {monthLabel}
              </div>
            </div>

            {/* Target */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Meta de ventas (ARS)</label>
              <Input
                type="number"
                placeholder="Ej: 500000"
                value={formTarget}
                onChange={e => setFormTarget(e.target.value)}
              />
            </div>

            {/* Commission % */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Comisión por lograr meta (%)</label>
              <Input
                type="number"
                step="0.5"
                min="0"
                max="100"
                placeholder="Ej: 10"
                value={formCommission}
                onChange={e => setFormCommission(e.target.value)}
              />
              {formTarget && formCommission && (
                <p className="text-xs text-muted-foreground mt-1">
                  = {formatARS(Number(formTarget) * Number(formCommission) / 100)} al cumplir la meta
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialog(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 gradient-gold text-primary-foreground"
                onClick={handleSave}
                disabled={saving || !formUserId || !formTarget}
              >
                {saving ? "Guardando…" : editGoal ? "Actualizar" : "Crear Meta"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
