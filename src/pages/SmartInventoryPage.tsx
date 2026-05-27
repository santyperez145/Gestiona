import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain, Package, TrendingUp, TrendingDown, AlertTriangle, RefreshCcw,
  Zap, BarChart3, Activity, Target, CheckCircle2, AlertCircle, Minus
} from "lucide-react";
import { toast } from "sonner";

/* ─────────────────────────── types ─────────────────────────── */
interface ABCRow {
  id: string;
  product_id: string;
  analysis_date: string;
  period_days: number;
  total_revenue: number;
  total_units: number;
  total_orders: number;
  revenue_pct: number;
  cumulative_pct: number;
  abc_class: "A" | "B" | "C";
  velocity: string;
  reorder_point: number;
  safety_stock: number;
  eoq: number;
  days_on_hand: number;
  stockout_risk: string;
  products: { name: string; stock: number | null } | null;
}

interface DemandSignal {
  id: string;
  product_id: string;
  signal_type: string;
  detected_at: string;
  value: number | null;
  description: string | null;
  confidence: number;
  is_resolved: boolean;
  products: { name: string } | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const ABC_CONFIG = {
  A: { label: "Clase A", desc: "70-80% del revenue", color: "bg-green-100 text-green-800", dot: "bg-green-500", border: "border-l-green-500" },
  B: { label: "Clase B", desc: "15-25% del revenue", color: "bg-blue-100 text-blue-700",  dot: "bg-blue-500",  border: "border-l-blue-500" },
  C: { label: "Clase C", desc: "Resto del revenue",  color: "bg-gray-100 text-gray-600",  dot: "bg-gray-400",  border: "border-l-gray-400" },
};

const VELOCITY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  fast:   { label: "Rápido",   icon: <Zap className="w-3.5 h-3.5" />,          color: "text-green-600" },
  medium: { label: "Medio",    icon: <Activity className="w-3.5 h-3.5" />,     color: "text-blue-600" },
  slow:   { label: "Lento",    icon: <Minus className="w-3.5 h-3.5" />,        color: "text-yellow-600" },
  dead:   { label: "Sin movim.",icon: <TrendingDown className="w-3.5 h-3.5" />, color: "text-red-500" },
};

const RISK_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  critical: { label: "Crítico", color: "bg-red-100 text-red-800",    icon: <AlertTriangle className="w-3 h-3" /> },
  high:     { label: "Alto",    color: "bg-orange-100 text-orange-700", icon: <AlertCircle className="w-3 h-3" /> },
  medium:   { label: "Medio",   color: "bg-yellow-100 text-yellow-700", icon: <AlertCircle className="w-3 h-3" /> },
  low:      { label: "Bajo",    color: "bg-green-100 text-green-700",  icon: <CheckCircle2 className="w-3 h-3" /> },
};

const SIGNAL_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  spike:        { label: "Pico de demanda",    color: "bg-green-100 text-green-700",  icon: <TrendingUp className="w-3.5 h-3.5" /> },
  trend_up:     { label: "Tendencia ↑",        color: "bg-blue-100 text-blue-700",    icon: <TrendingUp className="w-3.5 h-3.5" /> },
  trend_down:   { label: "Tendencia ↓",        color: "bg-red-100 text-red-700",      icon: <TrendingDown className="w-3.5 h-3.5" /> },
  seasonal:     { label: "Estacional",         color: "bg-purple-100 text-purple-700", icon: <Activity className="w-3.5 h-3.5" /> },
  promotion:    { label: "Promoción activa",   color: "bg-yellow-100 text-yellow-700", icon: <Zap className="w-3.5 h-3.5" /> },
  stockout_risk:{ label: "Riesgo de quiebre",  color: "bg-orange-100 text-orange-700", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

const TABS = ["Análisis ABC", "Señales de demanda", "Insights"] as const;
type Tab = typeof TABS[number];

/* ─────────────────────────── mini bar ─────────────────────────── */
function RevenueBar({ pct, abc }: { pct: number; abc: "A" | "B" | "C" }) {
  const colors = { A: "bg-green-400", B: "bg-blue-400", C: "bg-gray-300" };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${colors[abc]} rounded-full`} style={{ width: `${Math.min(100, pct * 2)}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function SmartInventoryPage() {
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<Tab>("Análisis ABC");
  const [abcData, setAbcData] = useState<ABCRow[]>([]);
  const [signals, setSignals] = useState<DemandSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filterABC, setFilterABC] = useState("all");
  const [filterVelocity, setFilterVelocity] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [period, setPeriod] = useState("90");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [ar, sr] = await Promise.allSettled([
      supabase.from("inventory_abc").select("*, products(name,stock)").eq("org_id", orgId).order("cumulative_pct"),
      supabase.from("demand_signals").select("*, products(name)").eq("org_id", orgId).eq("is_resolved", false).order("detected_at", { ascending: false }),
    ]);
    if (ar.status === "fulfilled" && ar.value.data) setAbcData(ar.value.data as ABCRow[]);
    if (sr.status === "fulfilled" && sr.value.data) setSignals(sr.value.data as DemandSignal[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function runAnalysis() {
    if (!orgId) return;
    setRunning(true);
    const { data, error } = await supabase.rpc("run_abc_analysis", { p_org_id: orgId, p_period_days: parseInt(period) });
    if (error) { toast.error(error.message); setRunning(false); return; }
    toast.success(`Análisis completado — ${data} productos clasificados`);
    setRunning(false);
    load();
  }

  async function resolveSignal(id: string) {
    await supabase.from("demand_signals").update({ is_resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    toast.success("Señal marcada como resuelta");
    load();
  }

  const filtered = abcData.filter(r => {
    if (filterABC !== "all" && r.abc_class !== filterABC) return false;
    if (filterVelocity !== "all" && r.velocity !== filterVelocity) return false;
    if (filterRisk !== "all" && r.stockout_risk !== filterRisk) return false;
    return true;
  });

  const classACounts = { A: abcData.filter(r => r.abc_class === "A").length, B: abcData.filter(r => r.abc_class === "B").length, C: abcData.filter(r => r.abc_class === "C").length };
  const totalRevenue = abcData.reduce((s, r) => s + r.total_revenue, 0);
  const criticalCount = abcData.filter(r => r.stockout_risk === "critical" || r.stockout_risk === "high").length;
  const deadStock = abcData.filter(r => r.velocity === "dead").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Brain className="w-6 h-6 text-indigo-600" /> Inventario Inteligente</h1>
          <p className="text-sm text-gray-500 mt-0.5">Análisis ABC/XYZ, velocidad de rotación y señales de demanda con IA</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
              <SelectItem value="180">180 días</SelectItem>
              <SelectItem value="365">1 año</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={runAnalysis} disabled={running}>
            {running ? <RefreshCcw className="w-4 h-4 mr-1 animate-spin" /> : <Brain className="w-4 h-4 mr-1" />}
            {running ? "Analizando…" : "Ejecutar análisis"}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Clase A (alto valor)",  value: classACounts.A, icon: <Target className="w-5 h-5 text-green-600" />, bg: "bg-green-50" },
          { label: "Clase C (bajo valor)",  value: classACounts.C, icon: <Package className="w-5 h-5 text-gray-500" />, bg: "bg-gray-50" },
          { label: "Riesgo crítico/alto",   value: criticalCount,  icon: <AlertTriangle className="w-5 h-5 text-orange-600" />, bg: "bg-orange-50" },
          { label: "Stock muerto (sin mov)",value: deadStock,       icon: <TrendingDown className="w-5 h-5 text-red-600" />, bg: "bg-red-50" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-4 flex items-center gap-3">
            <div className={`${k.bg} p-2.5 rounded-lg`}>{k.icon}</div>
            <div><p className="text-xs text-gray-500">{k.label}</p><p className="text-2xl font-bold text-gray-900">{k.value}</p></div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{t}</button>)}
      </div>

      {loading ? <div className="text-center py-16 text-gray-400">Cargando…</div> : (
        <>
          {/* ── ABC Analysis ── */}
          {activeTab === "Análisis ABC" && (
            <div className="space-y-4">
              {/* ABC visual summary */}
              <div className="grid grid-cols-3 gap-4">
                {(["A","B","C"] as const).map(cls => {
                  const rows = abcData.filter(r => r.abc_class === cls);
                  const rev = rows.reduce((s,r) => s + r.total_revenue, 0);
                  const pct = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
                  const cfg = ABC_CONFIG[cls];
                  return (
                    <div key={cls} className={`bg-white rounded-xl border-l-4 ${cfg.border} p-4 space-y-2`}>
                      <div className="flex items-center justify-between">
                        <Badge className={`${cfg.color} font-bold text-sm`}>{cls}</Badge>
                        <span className="text-xs text-gray-400">{rows.length} productos</span>
                      </div>
                      <p className="font-bold text-xl text-gray-900">${rev.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-gray-500">{pct.toFixed(1)}% del revenue total</p>
                      <div className="h-2 bg-gray-100 rounded-full"><div className={`h-full ${cfg.dot} rounded-full`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>

              {/* Filters */}
              <div className="flex gap-3 flex-wrap">
                {(["all","A","B","C"] as const).map(v => (
                  <button key={v} onClick={() => setFilterABC(v)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filterABC === v ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 hover:border-indigo-300"}`}>
                    {v === "all" ? "Todas" : `Clase ${v}`}
                  </button>
                ))}
                <Select value={filterVelocity} onValueChange={setFilterVelocity}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Velocidad" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas velocidades</SelectItem>
                    {Object.entries(VELOCITY_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterRisk} onValueChange={setFilterRisk}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Riesgo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todo riesgo</SelectItem>
                    {Object.entries(RISK_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>{["Producto","Clase","Velocidad","Revenue","% Share","Acumulado","Stock","Días en mano","Riesgo"].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-xs">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map(r => {
                      const abcCfg = ABC_CONFIG[r.abc_class];
                      const velCfg = VELOCITY_CONFIG[r.velocity] ?? VELOCITY_CONFIG.slow;
                      const riskCfg = RISK_CONFIG[r.stockout_risk] ?? RISK_CONFIG.low;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{(r.products as ABCRow["products"])?.name ?? r.product_id.slice(0,8)}</td>
                          <td className="px-4 py-3"><Badge className={`${abcCfg.color} font-bold text-xs`}>{r.abc_class}</Badge></td>
                          <td className={`px-4 py-3 text-xs font-medium flex items-center gap-1 ${velCfg.color}`}>{velCfg.icon}{velCfg.label}</td>
                          <td className="px-4 py-3 font-medium">${r.total_revenue.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</td>
                          <td className="px-4 py-3"><RevenueBar pct={r.revenue_pct} abc={r.abc_class} /></td>
                          <td className="px-4 py-3 text-gray-500">{r.cumulative_pct.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-gray-600">{(r.products as ABCRow["products"])?.stock ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-500">{r.days_on_hand > 0 ? `${r.days_on_hand.toFixed(0)} días` : "—"}</td>
                          <td className="px-4 py-3"><Badge className={`${riskCfg.color} flex items-center gap-1 text-xs`}>{riskCfg.icon}{riskCfg.label}</Badge></td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-gray-400">{abcData.length === 0 ? "Ejecutá el análisis ABC para ver resultados" : "Sin resultados con los filtros aplicados"}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Demand Signals ── */}
          {activeTab === "Señales de demanda" && (
            <div className="space-y-3">
              {signals.length === 0 && (
                <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Sin señales de demanda activas</p>
                  <p className="text-sm mt-1">Las señales se generan automáticamente al ejecutar el análisis</p>
                </div>
              )}
              {signals.map(s => {
                const cfg = SIGNAL_CONFIG[s.signal_type] ?? { label: s.signal_type, color: "bg-gray-100 text-gray-600", icon: <Activity className="w-3.5 h-3.5" /> };
                return (
                  <div key={s.id} className="bg-white rounded-xl border p-4 flex items-start gap-4">
                    <div className={`${cfg.color} p-2 rounded-lg shrink-0`}>{cfg.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{(s.products as DemandSignal["products"])?.name ?? "—"}</p>
                        <Badge className={`${cfg.color} text-xs`}>{cfg.label}</Badge>
                        <span className="text-xs text-gray-400 ml-auto">{new Date(s.detected_at).toLocaleDateString("es-AR")}</span>
                      </div>
                      {s.description && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        {s.value !== null && <span>Valor: <strong>{s.value}</strong></span>}
                        <span>Confianza: <strong>{(s.confidence * 100).toFixed(0)}%</strong></span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => resolveSignal(s.id)}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolver
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Insights ── */}
          {activeTab === "Insights" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Quick wins */}
              <div className="bg-white rounded-xl border p-5 space-y-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" /> Quick Wins detectados</h3>
                {abcData.filter(r => r.abc_class === "A" && r.velocity === "fast" && (r.stockout_risk === "critical" || r.stockout_risk === "high")).slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{(r.products as ABCRow["products"])?.name}</p>
                      <p className="text-xs text-orange-600">Clase A + movimiento rápido + riesgo de quiebre</p>
                    </div>
                  </div>
                ))}
                {abcData.filter(r => r.abc_class === "A" && r.velocity === "fast").length === 0 && <p className="text-sm text-gray-400">Ejecutá el análisis para ver insights</p>}
              </div>

              {/* Dead stock */}
              <div className="bg-white rounded-xl border p-5 space-y-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" /> Stock muerto a liquidar</h3>
                {abcData.filter(r => r.velocity === "dead" && r.abc_class === "C").slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                    <Package className="w-4 h-4 text-red-400 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{(r.products as ABCRow["products"])?.name}</p>
                      <p className="text-xs text-red-500">Sin movimiento · stock: {(r.products as ABCRow["products"])?.stock ?? 0} unidades</p>
                    </div>
                  </div>
                ))}
                {abcData.filter(r => r.velocity === "dead").length === 0 && <p className="text-sm text-gray-400">Sin stock muerto detectado</p>}
              </div>

              {/* Revenue concentration */}
              <div className="bg-white rounded-xl border p-5 space-y-3 lg:col-span-2">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-indigo-500" /> Concentración de revenue por clase ABC</h3>
                <div className="h-8 bg-gray-100 rounded-full overflow-hidden flex">
                  {(["A","B","C"] as const).map(cls => {
                    const rev = abcData.filter(r => r.abc_class === cls).reduce((s,r) => s + r.total_revenue, 0);
                    const pct = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
                    const colors = { A: "bg-green-400", B: "bg-blue-400", C: "bg-gray-300" };
                    return <div key={cls} className={`${colors[cls]} flex items-center justify-center text-xs font-bold text-white transition-all`} style={{ width: `${pct}%` }}>{pct > 8 ? `${cls} ${pct.toFixed(0)}%` : ""}</div>;
                  })}
                </div>
                <div className="flex gap-6 text-sm">
                  {(["A","B","C"] as const).map(cls => {
                    const rows = abcData.filter(r => r.abc_class === cls);
                    const rev = rows.reduce((s,r) => s + r.total_revenue, 0);
                    const cfg = ABC_CONFIG[cls];
                    return (
                      <div key={cls} className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
                        <span className="text-gray-600">{cfg.label}: <strong>{rows.length} productos</strong> · ${rev.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
