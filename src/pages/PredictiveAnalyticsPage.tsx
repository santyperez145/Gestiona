import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, Sparkles, Zap,
  RefreshCw, CheckCircle2, XCircle, ChevronRight, BarChart3,
  Package, Users, DollarSign, Eye, ThumbsUp, ThumbsDown, Clock
} from "lucide-react";

// Mock forecast data
const MOCK_FORECAST = [
  { day: "28 May", predicted: 95000,  lo: 72000,  hi: 118000, actual: null },
  { day: "29 May", predicted: 110000, lo: 84000,  hi: 136000, actual: null },
  { day: "30 May", predicted: 88000,  lo: 67000,  hi: 109000, actual: null },
  { day: "31 May", predicted: 125000, lo: 96000,  hi: 154000, actual: null },
  { day: "01 Jun", predicted: 142000, lo: 108000, hi: 176000, actual: null },
  { day: "02 Jun", predicted: 98000,  lo: 75000,  hi: 121000, actual: null },
  { day: "03 Jun", predicted: 103000, lo: 79000,  hi: 127000, actual: null },
];

// Mock anomalies
const MOCK_ANOMALIES = [
  { id: "a1", type: "revenue_spike",    severity: "high",     entity: "Electrónica",    metric: "revenue_day",  expected: 85000, actual: 145000, deviation: 70.6, desc: "Revenue 71% sobre lo esperado — posible viral en redes sociales o evento externo", action: "Verificar stock y preparar reposición urgente", ack: false },
  { id: "a2", type: "margin_erosion",   severity: "critical",  entity: "Textil",         metric: "gross_margin", expected: 38.5,  actual: 22.1,   deviation: -42.6, desc: "Margen cayó 42% — posible aumento de costos del proveedor no trasladado al precio", action: "Revisar lista de precios con motor de precios", ack: false },
  { id: "a3", type: "churn_spike",      severity: "medium",   entity: "Clientes VIP",   metric: "churn_rate",   expected: 2.1,   actual: 6.8,    deviation: 223.8, desc: "Tasa de abandono 3x lo normal entre clientes de alto valor", action: "Activar campaña de retención inmediata", ack: false },
  { id: "a4", type: "supplier_delay",   severity: "low",      entity: "Norte SA",       metric: "avg_lead_days", expected: 3.2,  actual: 8.5,    deviation: 165.6, desc: "Lead time del proveedor aumentó 165% esta semana", action: "Contactar al proveedor y evaluar alternativas", ack: true },
];

// Mock AI recommendations
const MOCK_RECOMMENDATIONS = [
  { id: "r1", type: "restock",           title: "Reposición urgente: Alpha XL", desc: "Stock para 4 días con demanda actual. Proyección: ruptura en 2026-05-31", impact: 180000, effort: "low", confidence: 0.95, entity: "Producto Premium Alpha" },
  { id: "r2", type: "price_adjustment",  title: "Oportunidad: subir precio +8%", desc: "Elasticidad baja detectada — subir precio no impacta conversión pero mejora margen $42K/mes", impact: 42000, effort: "low", confidence: 0.88, entity: "Kit Estándar XL" },
  { id: "r3", type: "bundle_opportunity", title: "Bundle sugerido: A + B", desc: "58% de clientes que compran A también compran B. Bundle con 10% dto. estima +$28K revenue", impact: 28000, effort: "medium", confidence: 0.82, entity: "Combo detectado" },
  { id: "r4", type: "customer_winback",  title: "Recuperar 23 clientes inactivos", desc: "23 clientes con LTV promedio $85K sin comprar hace 45+ días. Email con 15% dto. esperado: 6 recuperados", impact: 75000, effort: "low", confidence: 0.74, entity: "Clientes inactivos" },
  { id: "r5", type: "discontinue",       title: "Descontinuar: Producto Z", desc: "0 ventas en 90 días, $12K en stock inmovilizado. Liquidar a -40% recupera capital", impact: 7200, effort: "medium", confidence: 0.91, entity: "Producto Z" },
];

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
function ForecastChart({ data }: { data: typeof MOCK_FORECAST }) {
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

export default function PredictiveAnalyticsPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"forecast" | "anomalies" | "recommendations">("recommendations");
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set(["a4"]));
  const [dismissedRecs, setDismissedRecs] = useState<Set<string>>(new Set());
  const [forecastModel, setForecastModel] = useState("moving_avg");
  const [forecastHorizon, setForecastHorizon] = useState(7);
  const [loading, setLoading] = useState(false);

  const runForecast = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setLoading(false);
    toast.success("Forecast recalculado correctamente");
  };

  const ackAnomaly = (id: string) => {
    setAckedIds(prev => new Set([...prev, id]));
    toast.success("Anomalía marcada como revisada");
  };

  const handleRec = (id: string, accepted: boolean) => {
    setDismissedRecs(prev => new Set([...prev, id]));
    toast.success(accepted ? "Recomendación aceptada — creando tarea..." : "Recomendación descartada");
  };

  const activeAnomalies = MOCK_ANOMALIES.filter(a => !ackedIds.has(a.id));
  const activeRecs = MOCK_RECOMMENDATIONS.filter(r => !dismissedRecs.has(r.id));

  const TABS = [
    { id: "recommendations", label: "Recomendaciones IA" },
    { id: "anomalies",       label: `Anomalías ${activeAnomalies.length > 0 ? `(${activeAnomalies.length})` : ""}` },
    { id: "forecast",        label: "Forecast de Ventas" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Brain className="w-4 h-4 text-violet-400" />
            </div>
            <h1 className="text-2xl font-display font-bold">Analytics Predictivo & IA</h1>
          </div>
          <p className="text-sm text-muted-foreground">Forecasting, anomalías automáticas y recomendaciones inteligentes</p>
        </div>
        <div className="flex items-center gap-2">
          {activeAnomalies.length > 0 && (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/20">
              {activeAnomalies.length} anomalía{activeAnomalies.length > 1 ? "s" : ""} activa{activeAnomalies.length > 1 ? "s" : ""}
            </Badge>
          )}
          <Button size="sm" onClick={runForecast} disabled={loading} variant="outline" className="gap-1.5 text-xs">
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            Recalcular
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Forecast 7 días</p>
          <p className="text-2xl font-bold text-primary">${(MOCK_FORECAST.reduce((a, b) => a + b.predicted, 0) / 1000).toFixed(0)}K</p>
          <p className="text-xs text-muted-foreground">±15% intervalo confianza</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Recomendaciones</p>
          <p className="text-2xl font-bold">{activeRecs.length}</p>
          <p className="text-xs text-emerald-400">${(activeRecs.reduce((a, r) => a + r.impact, 0) / 1000).toFixed(0)}K impacto total</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Anomalías activas</p>
          <p className={`text-2xl font-bold ${activeAnomalies.length > 0 ? "text-red-400" : "text-emerald-400"}`}>{activeAnomalies.length}</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Precisión modelo</p>
          <p className="text-2xl font-bold text-blue-400">91.4%</p>
          <p className="text-xs text-muted-foreground">MAPE 8.6%</p>
        </div>
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
          {MOCK_ANOMALIES.map(a => {
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
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
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
            <ForecastChart data={MOCK_FORECAST} />
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
                  {MOCK_FORECAST.map((d, i) => (
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
