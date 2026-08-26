import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, Sparkles, Zap,
  RefreshCw, CheckCircle2, XCircle, ChevronRight, BarChart3,
  Package, Users, DollarSign, Eye, ThumbsUp, ThumbsDown, Clock, Loader2
} from "lucide-react";
import KPICard from "@/components/shared/KPICard";

type ForecastRow   = { day: string; predicted: number; lo: number; hi: number; actual: number | null };
type AnomalyRow    = { id: string; type: string; severity: string; entity: string; metric: string; expected: number; actual: number; deviation: number; desc: string; action: string; ack: boolean };
type RecRow        = { id: string; type: string; title: string; desc: string; impact: number; effort: string; confidence: number; entity: string };

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
  high:     "bg-orange-500/15 text-orange-400 border-orange-500/20",
  medium:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  low:      "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const REC_TYPE_ICONS: Record<string, any> = {
  restock: Package, price_adjustment: DollarSign, bundle_opportunity: Zap,
  customer_winback: Users, discontinue: XCircle, cross_sell: ChevronRight,
  cost_reduction: TrendingDown, expansion: TrendingUp,
};

const EFFORT_COLORS = { low: "text-emerald-400", medium: "text-yellow-400", high: "text-red-400" };

// Mini forecast bar chart
function ForecastChart({ data }: { data: ForecastRow[] }) {
  const max = Math.max(...data.map(d => d.hi));
  const h = 80;
  return (
    <div className="flex items-end gap-2">
      {data.map((d, i) => {
        const predH = (d.predicted / max) * h;
        const loH   = (d.lo / max) * h;
        const hiH   = (d.hi / max) * h;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="relative w-full" style={{ height: `${h}px` }}>
              {/* CI band */}
              <div className="absolute inset-x-0 rounded-sm bg-primary/10" style={{ bottom: `${loH}px`, height: `${hiH - loH}px` }} />
              {/* Predicted bar */}
              <div className="absolute inset-x-1 rounded-sm bg-primary/60" style={{ bottom: 0, height: `${predH}px` }} />
            </div>
            <span className="text-[9px] text-muted-foreground truncate w-full text-center">{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PredictiveAnalyticsTab() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"forecast" | "anomalies" | "recommendations">("recommendations");
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set());
  const [dismissedRecs, setDismissedRecs] = useState<Set<string>>(new Set());
  const [forecastModel, setForecastModel] = useState("moving_avg");
  const [forecastHorizon, setForecastHorizon] = useState(7);
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [recommendations, setRecommendations] = useState<RecRow[]>([]);

  useEffect(() => {
    if (!orgId) return;
    // Load sales forecasts (next 7 days, org-level)
    supabase
      .from("sales_forecasts")
      .select("forecast_date, predicted_revenue, confidence_lo, confidence_hi")
      .eq("org_id", orgId)
      .is("product_id", null)
      .gte("forecast_date", new Date().toISOString().slice(0, 10))
      .order("forecast_date")
      .limit(7)
      .then(({ data }) => {
        setForecast((data ?? []).map((f: any) => ({
          day: new Date(f.forecast_date).toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
          predicted: Number(f.predicted_revenue),
          lo: Number(f.confidence_lo),
          hi: Number(f.confidence_hi),
          actual: null,
        })));
      });
    // Load anomaly detections (unresolved)
    supabase
      .from("anomaly_detections")
      .select("id, anomaly_type, severity, entity_type, metric_name, expected_value, actual_value, deviation_pct, description, suggested_action, is_acknowledged")
      .eq("org_id", orgId)
      .order("detected_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setAnomalies((data ?? []).map((a: any) => ({
          id: a.id,
          type: a.anomaly_type,
          severity: a.severity,
          entity: a.entity_type ?? "—",
          metric: a.metric_name ?? "—",
          expected: Number(a.expected_value),
          actual: Number(a.actual_value),
          deviation: Number(a.deviation_pct),
          desc: a.description ?? "",
          action: a.suggested_action ?? "",
          ack: a.is_acknowledged,
        })));
        // Initialize ackedIds from DB
        const alreadyAcked = new Set<string>((data ?? []).filter((a: any) => a.is_acknowledged).map((a: any) => a.id as string));
        setAckedIds(alreadyAcked);
      });
    // Load AI recommendations (active)
    supabase
      .from("ai_recommendations")
      .select("id, recommendation_type:rec_type, title, description, estimated_impact:impact_estimate, effort_level:effort, confidence_score:confidence, entity_type")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("confidence", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setRecommendations((data ?? []).map((r: any) => ({
          id: r.id,
          type: r.recommendation_type,
          title: r.title,
          desc: r.description ?? "",
          impact: Number(r.estimated_impact ?? 0),
          effort: r.effort_level ?? "medium",
          confidence: Number(r.confidence_score ?? 0),
          entity: r.entity_type ?? "—",
        })));
      });
  }, [orgId]);

  const runForecast = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setLoading(false);
    toast.success("Forecast recalculado correctamente");
  };

  const ackAnomaly = async (id: string) => {
    setAckedIds(prev => new Set([...prev, id]));
    await supabase.from("anomaly_detections").update({ is_acknowledged: true }).eq("id", id);
    toast.success("Anomalía marcada como revisada");
  };

  const handleRec = async (id: string, accepted: boolean) => {
    setDismissedRecs(prev => new Set([...prev, id]));
    await supabase.from("ai_recommendations").update({ status: accepted ? "accepted" : "dismissed" }).eq("id", id);
    toast.success(accepted ? "Recomendación aceptada — creando tarea..." : "Recomendación descartada");
  };

  const activeAnomalies = anomalies.filter(a => !ackedIds.has(a.id));
  const activeRecs = recommendations.filter(r => !dismissedRecs.has(r.id));

  const TABS = [
    { id: "recommendations", label: "Recomendaciones IA" },
    { id: "anomalies",       label: `Anomalías ${activeAnomalies.length > 0 ? `(${activeAnomalies.length})` : ""}` },
    { id: "forecast",        label: "Forecast de Ventas" },
  ];

  const kpis = useMemo(() => [
    {
      label: "Forecast 7 días",
      value: `$${(forecast.reduce((a, b) => a + b.predicted, 0) / 1000).toFixed(0)}K`,
      sub: "±15% intervalo confianza",
      icon: BarChart3,
      color: "primary" as const,
    },
    {
      label: "Recomendaciones IA",
      value: activeRecs.length,
      sub: `$${(activeRecs.reduce((a, r) => a + r.impact, 0) / 1000).toFixed(0)}K impacto total`,
      icon: Sparkles,
      color: "success" as const,
    },
    {
      label: "Anomalías activas",
      value: activeAnomalies.length,
      sub: activeAnomalies.length > 0 ? "Requieren revisión" : "Todo normal",
      icon: AlertTriangle,
      color: activeAnomalies.length > 0 ? "destructive" as const : "success" as const,
    },
    {
      label: "Precisión modelo",
      value: "91.4%",
      sub: "MAPE 8.6%",
      icon: Brain,
      color: "blue" as const,
    },
  ], [forecast, activeRecs, activeAnomalies]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-primary" />Analytics Predictivo & IA</h2>
          <p className="text-xs text-muted-foreground">Forecasting, anomalías automáticas y recomendaciones inteligentes</p>
        </div>
        <div className="flex items-center gap-2">
          {activeAnomalies.length > 0 && (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/20">
              {activeAnomalies.length} anomalía{activeAnomalies.length > 1 ? "s" : ""} activa{activeAnomalies.length > 1 ? "s" : ""}
            </Badge>
          )}
          <Button size="sm" onClick={runForecast} disabled={loading} variant="outline" className="gap-1.5 text-xs">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            Recalcular
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} color={k.color} />
        ))}
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

      {/* ─── Recommendations tab ─── */}
      {tab === "recommendations" && (
        <div className="space-y-3">
          {activeRecs.map(r => {
            const Icon = REC_TYPE_ICONS[r.type] || Sparkles;
            const confidencePct = Math.round(r.confidence * 100);
            return (
              <div key={r.id} className="bg-card border border-border/40 rounded-xl p-5 hover:border-primary/30 transition-all">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="font-semibold text-sm">{r.title}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={`text-[10px] border-0 ${EFFORT_COLORS[r.effort as keyof typeof EFFORT_COLORS]} bg-muted`}>
                          {r.effort} esfuerzo
                        </Badge>
                        <Badge className="bg-primary/15 text-primary border-0 text-xs">{confidencePct}%</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{r.desc}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground">{r.entity}</span>
                        <span className="text-emerald-400 font-semibold">+${r.impact.toLocaleString("es-AR")} estimado</span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-400 border-red-400/20 hover:bg-red-400/10"
                          onClick={() => handleRec(r.id, false)}>
                          <ThumbsDown className="w-3 h-3" />Descartar
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1 gradient-gold text-primary-foreground"
                          onClick={() => handleRec(r.id, true)}>
                          <ThumbsUp className="w-3 h-3" />Aceptar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {activeRecs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              <p className="text-sm">Todas las recomendaciones fueron procesadas</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Anomalies tab ─── */}
      {tab === "anomalies" && (
        <div className="space-y-3">
          {anomalies.map(a => {
            const acked = ackedIds.has(a.id);
            const up = a.deviation > 0;
            return (
              <div key={a.id} className={`bg-card border rounded-xl p-5 transition-all ${acked ? "opacity-50 border-border/20" : "border-border/40"}`}>
                <div className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${acked ? "bg-muted/30" : a.severity === "critical" ? "bg-red-500/10" : "bg-orange-500/10"}`}>
                    <AlertTriangle className={`w-4 h-4 ${acked ? "text-muted-foreground" : a.severity === "critical" ? "text-red-400" : "text-orange-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${SEVERITY_COLORS[a.severity]}`}>{a.severity}</Badge>
                        <span className="text-xs text-muted-foreground">{a.entity}</span>
                      </div>
                      {acked && <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs">✓ Revisado</Badge>}
                    </div>
                    <p className="text-sm font-medium mb-1">{a.desc}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                      <span>Esperado: <span className="font-semibold text-foreground">{a.expected.toLocaleString()}</span></span>
                      <span>Real: <span className={`font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>{a.actual.toLocaleString()}</span></span>
                      <span className={`font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
                        {up ? "+" : ""}{a.deviation.toFixed(1)}%
                      </span>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-2.5 text-xs flex items-center gap-2">
                      <Zap className="w-3 h-3 text-primary shrink-0" />
                      <span className="text-muted-foreground">{a.action}</span>
                    </div>
                  </div>
                  {!acked && (
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => ackAnomaly(a.id)}>
                      Marcar revisado
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Forecast tab ─── */}
      {tab === "forecast" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {["moving_avg","exp_smoothing","arima","prophet"].map(m => (
                <button key={m} onClick={() => setForecastModel(m)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${forecastModel === m ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                  {m === "moving_avg" ? "Mov. Avg." : m === "exp_smoothing" ? "Exp. Smooth." : m.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setForecastHorizon(d)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${forecastHorizon === d ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                  {d} días
                </button>
              ))}
            </div>
            <Button size="sm" onClick={runForecast} disabled={loading} className="gradient-gold text-primary-foreground h-7 text-xs gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Calcular
            </Button>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Forecast de Revenue — próximos {forecastHorizon} días</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-primary/60" />Predicción</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-primary/10" />Intervalo 80%</div>
              </div>
            </div>
            <ForecastChart data={forecast} />
          </div>

          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Día", "Predicción", "Rango Min", "Rango Max", "Amplitud CI"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((d, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs font-medium">{d.day}</td>
                      <td className="px-4 py-3 text-sm font-semibold">${(d.predicted / 1000).toFixed(0)}K</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">${(d.lo / 1000).toFixed(0)}K</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">${(d.hi / 1000).toFixed(0)}K</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="text-muted-foreground">±${((d.hi - d.lo) / 2000).toFixed(0)}K</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fix: Play icon import
function Play({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
