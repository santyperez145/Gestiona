import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Download, Users, TrendingUp, AlertTriangle, Crown, Flame, Zap, Leaf, Moon, Skull, RefreshCw, Search, Filter, DollarSign, BarChart3 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Types ────────────────────────────────────────────────────────────────────
interface Sale {
  customer_name: string;
  customer_email: string | null;
  total_ars: number;
  created_at: string;
}

interface CustomerRFM {
  name: string;
  email: string;
  lastPurchase: Date;
  recencyDays: number;
  frequency: number;
  monetary: number;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmScore: number;
  segment: Segment;
}

type Segment =
  | "champion"
  | "loyal"
  | "potential"
  | "new"
  | "promising"
  | "attention"
  | "at_risk"
  | "cant_lose"
  | "lost"
  | "hibernating";

interface SegmentDef {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
  description: string;
  minR?: number; maxR?: number;
  minF?: number; maxF?: number;
}

const SEGMENTS: Record<Segment, SegmentDef> = {
  champion:    { label: "Campeones",       color: "#f59e0b", bg: "bg-amber-500/10",  border: "border-amber-500/30",  icon: <Crown className="w-3.5 h-3.5" />,     description: "Compraron recientemente, con frecuencia, y alto gasto" },
  loyal:       { label: "Leales",          color: "#8b5cf6", bg: "bg-purple-500/10", border: "border-purple-500/30", icon: <Flame className="w-3.5 h-3.5" />,     description: "Alta frecuencia y gasto, compran regularmente" },
  potential:   { label: "Potenciales",     color: "#3b82f6", bg: "bg-blue-500/10",   border: "border-blue-500/30",   icon: <Zap className="w-3.5 h-3.5" />,       description: "Clientes recientes con potencial de fidelización" },
  new:         { label: "Nuevos",          color: "#10b981", bg: "bg-emerald-500/10",border: "border-emerald-500/30",icon: <Leaf className="w-3.5 h-3.5" />,      description: "Primera compra reciente — aún no hay historial" },
  promising:   { label: "Prometedores",    color: "#06b6d4", bg: "bg-cyan-500/10",   border: "border-cyan-500/30",   icon: <TrendingUp className="w-3.5 h-3.5" />, description: "Actividad reciente, aumentando frecuencia" },
  attention:   { label: "Necesitan Atención", color: "#f97316", bg: "bg-orange-500/10", border: "border-orange-500/30", icon: <AlertTriangle className="w-3.5 h-3.5" />, description: "Han comprado bien pero hace tiempo que no vuelven" },
  at_risk:     { label: "En Riesgo",       color: "#ef4444", bg: "bg-red-500/10",    border: "border-red-500/30",    icon: <AlertTriangle className="w-3.5 h-3.5" />, description: "Buenos clientes que parecen estar yéndose" },
  cant_lose:   { label: "No Perder",       color: "#dc2626", bg: "bg-red-600/10",    border: "border-red-600/30",    icon: <Skull className="w-3.5 h-3.5" />,     description: "Compraban mucho pero desaparecieron — acción inmediata" },
  lost:        { label: "Perdidos",        color: "#6b7280", bg: "bg-gray-500/10",   border: "border-gray-500/30",   icon: <Moon className="w-3.5 h-3.5" />,      description: "Sin actividad reciente y bajo historial" },
  hibernating: { label: "Hibernando",      color: "#64748b", bg: "bg-slate-500/10",  border: "border-slate-500/30",  icon: <Moon className="w-3.5 h-3.5" />,      description: "Inactivos hace mucho — alguna actividad pasada" },
};

// ── Scoring helpers ───────────────────────────────────────────────────────────
function percentileScore(value: number, sorted: number[], ascending: boolean): number {
  // 1=worst, 5=best
  const idx = sorted.findIndex(v => v >= value);
  const pct = idx < 0 ? 1 : 1 - idx / sorted.length;
  if (ascending) {
    // higher value → better (F, M)
    const score = Math.ceil(pct * 5);
    return Math.min(5, Math.max(1, score));
  } else {
    // lower value → better (R: fewer days = more recent)
    const score = Math.ceil((1 - pct) * 5);
    return Math.min(5, Math.max(1, score));
  }
}

function classifySegment(r: number, f: number, m: number): Segment {
  const rfm = r * 100 + f * 10 + m;
  if (r >= 4 && f >= 4) return "champion";
  if (f >= 4 || (r >= 3 && f >= 3)) return "loyal";
  if (r >= 4 && f === 1) return "new";
  if (r >= 3 && f <= 2) return "potential";
  if (r === 3 && f >= 2) return "promising";
  if (r <= 2 && f >= 4) return "cant_lose";
  if (r <= 2 && f >= 2) return "at_risk";
  if (r <= 2 && f === 1 && m >= 3) return "attention";
  if (r === 1 && f === 1) return "lost";
  return "hibernating";
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("es-AR").format(n);

// ── Component ─────────────────────────────────────────────────────────────────
export default function CustomerRFMPage() {
  usePageTitle("Segmentación RFM");
  const { activeOrg } = useOrg();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "clientes">("overview");
  const [search, setSearch] = useState("");
  const [segFilter, setSegFilter] = useState<Segment | "all">("all");
  const [sort, setSort] = useState<"monetary" | "frequency" | "recency" | "rfm">("rfm");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    supabase
      .from("sales")
      .select("customer_name, customer_email, total_ars, created_at")
      .eq("org_id", activeOrg.id)
      .gte("created_at", since.toISOString())
      .then(({ data }) => {
        setSales((data as Sale[]) || []);
        setLoading(false);
      });
  }, [activeOrg]);

  // ── Build RFM table ────────────────────────────────────────────────────────
  const rfmData = useMemo<CustomerRFM[]>(() => {
    if (!sales.length) return [];
    const today = new Date();

    // Group by customer
    const map = new Map<string, { name: string; email: string; dates: Date[]; total: number }>();
    sales.forEach(s => {
      const key = s.customer_email || s.customer_name || "Anónimo";
      const existing = map.get(key);
      const d = new Date(s.created_at);
      if (existing) {
        existing.dates.push(d);
        existing.total += s.total_ars || 0;
      } else {
        map.set(key, { name: s.customer_name || "Anónimo", email: s.customer_email || "", dates: [d], total: s.total_ars || 0 });
      }
    });

    // Compute raw R, F, M
    const raw = Array.from(map.values()).map(c => {
      const lastPurchase = new Date(Math.max(...c.dates.map(d => d.getTime())));
      const recencyDays = Math.floor((today.getTime() - lastPurchase.getTime()) / 86400000);
      return { name: c.name, email: c.email, lastPurchase, recencyDays, frequency: c.dates.length, monetary: c.total };
    });

    if (!raw.length) return [];

    // Build sorted arrays for scoring
    const sortedR = [...raw.map(r => r.recencyDays)].sort((a, b) => a - b); // ascending (fewer days = more recent = better)
    const sortedF = [...raw.map(r => r.frequency)].sort((a, b) => a - b);
    const sortedM = [...raw.map(r => r.monetary)].sort((a, b) => a - b);

    return raw.map(c => {
      const rScore = percentileScore(c.recencyDays, sortedR, false); // lower R = higher score
      const fScore = percentileScore(c.frequency, sortedF, true);
      const mScore = percentileScore(c.monetary, sortedM, true);
      const rfmScore = rScore * 100 + fScore * 10 + mScore;
      const segment = classifySegment(rScore, fScore, mScore);
      return { ...c, rScore, fScore, mScore, rfmScore, segment };
    });
  }, [sales]);

  // ── Filtered + sorted ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = rfmData;
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    }
    if (segFilter !== "all") data = data.filter(c => c.segment === segFilter);
    data = [...data].sort((a, b) => {
      let va: number, vb: number;
      if (sort === "monetary") { va = a.monetary; vb = b.monetary; }
      else if (sort === "frequency") { va = a.frequency; vb = b.frequency; }
      else if (sort === "recency") { va = a.recencyDays; vb = b.recencyDays; }
      else { va = a.rfmScore; vb = b.rfmScore; }
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return data;
  }, [rfmData, search, segFilter, sort, sortDir]);

  // ── Segment distribution for pie ───────────────────────────────────────────
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    rfmData.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    return Object.entries(counts).map(([seg, count]) => ({
      name: SEGMENTS[seg as Segment].label,
      value: count,
      color: SEGMENTS[seg as Segment].color,
    }));
  }, [rfmData]);

  // ── Bar chart: avg monetary by segment ────────────────────────────────────
  const barData = useMemo(() => {
    const totals: Record<string, { sum: number; count: number }> = {};
    rfmData.forEach(c => {
      if (!totals[c.segment]) totals[c.segment] = { sum: 0, count: 0 };
      totals[c.segment].sum += c.monetary;
      totals[c.segment].count += 1;
    });
    return Object.entries(totals)
      .map(([seg, { sum, count }]) => ({
        name: SEGMENTS[seg as Segment].label,
        avg: Math.round(sum / count),
        fill: SEGMENTS[seg as Segment].color,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [rfmData]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!rfmData.length) return null;
    const champions = rfmData.filter(c => c.segment === "champion").length;
    const atRisk = rfmData.filter(c => c.segment === "at_risk" || c.segment === "cant_lose").length;
    const totalRevenue = rfmData.reduce((s, c) => s + c.monetary, 0);
    const avgFreq = rfmData.reduce((s, c) => s + c.frequency, 0) / rfmData.length;
    return { champions, atRisk, totalRevenue, avgFreq, total: rfmData.length };
  }, [rfmData]);

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ["Nombre", "Email", "Segmento", "R (días)", "Frecuencia", "Gasto total ARS", "Score R", "Score F", "Score M"];
    const rows = filtered.map(c => [
      c.name, c.email, SEGMENTS[c.segment].label,
      c.recencyDays, c.frequency, c.monetary, c.rScore, c.fScore, c.mScore,
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "rfm_clientes.csv";
    a.click();
  };

  const toggleSort = (col: typeof sort) => {
    if (sort === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSort(col); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: typeof sort }) =>
    sort === col ? <span className="ml-1 text-primary">{sortDir === "desc" ? "↓" : "↑"}</span> : <span className="ml-1 opacity-30">↕</span>;

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── RFM KPI derivations ────────────────────────────────────────────────────
  const championsCount = rfmData.filter(c => c.segment === "champion").length;
  const atRiskCount = rfmData.filter(c => c.segment === "at_risk" || c.segment === "cant_lose").length;
  const totalRevenue = rfmData.reduce((a, c) => a + c.monetary, 0);
  const avgRFMScore = rfmData.length > 0
    ? (rfmData.reduce((a, c) => a + c.rfmScore, 0) / rfmData.length).toFixed(1)
    : "—";

  return (
    <div className="space-y-6 pb-12">
      {/* PageHeader */}
      <PageHeader
        icon={Users}
        title="Segmentación RFM"
        description="Recencia, Frecuencia y Valor monetario por cliente"
        actions={
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 text-sm hover:bg-muted/50 transition-colors"
          >
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Campeones"         value={championsCount} sub="máximo valor y frecuencia"    icon={Crown}         color="warning"     />
        <KPICard label="En riesgo"         value={atRiskCount}    sub="acción urgente requerida"      icon={AlertTriangle} color="destructive" />
        <KPICard label="Revenue total"     value={fmt(totalRevenue)} sub="todos los clientes"         icon={DollarSign}    color="success"     />
        <KPICard label="Score RFM promedio" value={avgRFMScore}   sub={`${rfmData.length} clientes`}  icon={BarChart3}     color="blue"        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {[{ id: "overview", label: "Resumen & Segmentos" }, { id: "clientes", label: `Clientes (${rfmData.length})` }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Overview tab ─── */}
      {tab === "overview" && (
      <div className="space-y-4 pb-12">
      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Pie */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Distribución de segmentos</h3>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v} clientes`, ""]} contentStyle={{ background: 'hsl(228 32% 6%)', border: '1px solid hsl(228 20% 18%)', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {pieData.sort((a, b) => b.value - a.value).slice(0, 6).map(d => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-xs text-muted-foreground truncate">{d.name}</span>
                    </div>
                    <span className="text-xs font-semibold">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
          )}
        </div>

        {/* Bar: avg revenue by segment */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Gasto promedio por segmento</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} layout="vertical" margin={{ left: 60, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(228 20% 14%)" />
                <Tooltip formatter={(v: number) => [fmt(v), "Promedio"]} contentStyle={{ background: 'hsl(228 32% 6%)', border: '1px solid hsl(228 20% 18%)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                  {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
          )}
        </div>
      </div>

      {/* Segment legend */}
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Leyenda de segmentos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(SEGMENTS).map(([key, def]) => {
            const segCount = rfmData.filter(c => c.segment === key).length;
            const segPct = rfmData.length > 0 ? Math.round(segCount / rfmData.length * 100) : 0;
            return (
              <button
                key={key}
                onClick={() => setSegFilter(segFilter === key ? "all" : key as Segment)}
                className={`flex flex-col gap-1 p-2.5 rounded-lg border text-left transition-all ${
                  segFilter === key ? `${def.bg} ${def.border}` : "border-border/40 hover:border-border/70"
                }`}
              >
                <div className="flex items-center gap-1.5" style={{ color: def.color }}>
                  {def.icon}
                  <span className="text-xs font-semibold">{def.label}</span>
                  <span className="ml-auto text-xs font-bold opacity-80">
                    {segCount}
                    <span className="text-[9px] font-normal opacity-60 ml-0.5">({segPct}%)</span>
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">{def.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      </div>
      )}

      {/* ─── Clientes tab ─── */}
      {tab === "clientes" && (
      <div className="space-y-4 pb-12">
      {/* Segment filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSegFilter("all")}
          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
            segFilter === "all"
              ? "bg-primary/15 border-primary/40 text-primary"
              : "border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground"
          }`}
        >
          Todos ({rfmData.length})
        </button>
        {Object.entries(SEGMENTS).map(([key, def]) => {
          const cnt = rfmData.filter(c => c.segment === key).length;
          if (cnt === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setSegFilter(segFilter === key ? "all" : key as Segment)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                segFilter === key
                  ? `${def.bg} ${def.border}`
                  : "border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground"
              }`}
              style={segFilter === key ? { color: def.color } : {}}
            >
              {def.icon}
              {def.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-border/40 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-muted/40 border border-border/40 text-sm outline-none focus:border-primary/50"
            />
          </div>
          {segFilter !== "all" && (
            <button
              onClick={() => setSegFilter("all")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-xs text-primary"
            >
              <Filter className="w-3.5 h-3.5" /> {SEGMENTS[segFilter].label} <span>×</span>
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} resultados</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Cliente</th>
                <th className="px-4 py-3 text-left font-medium">Segmento</th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("recency")}>
                  Última compra <SortIcon col="recency" />
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("frequency")}>
                  Compras <SortIcon col="frequency" />
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("monetary")}>
                  Gasto total <SortIcon col="monetary" />
                </th>
                <th className="px-4 py-3 text-center font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("rfm")}>
                  Score RFM <SortIcon col="rfm" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filtered.slice(0, 100).map((c, i) => {
                const seg = SEGMENTS[c.segment];
                return (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[160px]">{c.name}</p>
                      {c.email && <p className="text-xs text-muted-foreground truncate max-w-[160px]">{c.email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${seg.bg} ${seg.border}`}
                        style={{ color: seg.color }}>
                        {seg.icon}{seg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-xs font-mono">{c.recencyDays}d atrás</p>
                      <p className="text-[10px] text-muted-foreground">{c.lastPurchase.toLocaleDateString("es-AR")}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold">{c.frequency}</span>
                      <span className="text-muted-foreground text-xs ml-1">veces</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(c.monetary)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        {[
                          { label: "R", score: c.rScore, color: "#3b82f6" },
                          { label: "F", score: c.fScore, color: "#8b5cf6" },
                          { label: "M", score: c.mScore, color: "#10b981" },
                        ].map(({ label, score, color }) => (
                          <div key={label} className="flex flex-col items-center">
                            <span className="text-[8px] text-muted-foreground">{label}</span>
                            <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
                              style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
                              {score}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No hay clientes que coincidan con los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <p className="text-xs text-muted-foreground text-center py-3 border-t border-border/30">
              Mostrando 100 de {filtered.length} — usá el filtro o exportá CSV para ver todos
            </p>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
