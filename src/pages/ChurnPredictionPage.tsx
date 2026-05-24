import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import {
  AlertTriangle, RefreshCw, Users, TrendingDown, ShieldCheck,
  Mail, Phone, ChevronDown, ChevronUp, Clock, DollarSign,
  BarChart3, Zap, ArrowRight, Info, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";

// ── Types ────────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  purchase_count: number;
  total_spent: number;
  last_purchase_at: string | null;
  created_at: string;
}

interface ChurnedCustomer extends Customer {
  churnScore: number;           // 0-100, higher = more likely to churn
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  daysSinceLastPurchase: number;
  avgPurchaseIntervalDays: number | null;
  overdueByDays: number;        // how many days past expected next purchase
  ltv: number;                  // lifetime value
  action: string;
  factors: ChurnFactor[];
}

interface ChurnFactor {
  label: string;
  weight: number;    // contribution to score (0-1)
  description: string;
  bad: boolean;
}

// ── Scoring logic ────────────────────────────────────────────────────────────
function computeChurnScore(c: Customer, orgAvgInterval: number): {
  score: number;
  factors: ChurnFactor[];
  action: string;
} {
  const factors: ChurnFactor[] = [];
  const now = Date.now();

  // Days since last purchase
  const daysSince = c.last_purchase_at
    ? differenceInDays(now, new Date(c.last_purchase_at))
    : differenceInDays(now, new Date(c.created_at));

  // Factor 1: Recency (0–40 pts)
  let recencyScore = 0;
  if (daysSince > 365) recencyScore = 40;
  else if (daysSince > 180) recencyScore = 30;
  else if (daysSince > 90) recencyScore = 20;
  else if (daysSince > 60) recencyScore = 10;
  else if (daysSince > 30) recencyScore = 4;
  else recencyScore = 0;

  factors.push({
    label: "Tiempo sin comprar",
    weight: recencyScore / 40,
    description: c.last_purchase_at
      ? `${daysSince} días sin actividad`
      : "Nunca compró (solo registro)",
    bad: recencyScore >= 20,
  });

  // Factor 2: Frequency drop (0–30 pts)
  let freqScore = 0;
  if (c.purchase_count === 0) freqScore = 30;
  else if (c.purchase_count === 1) freqScore = 20;
  else if (c.purchase_count === 2) freqScore = 10;
  else freqScore = 0;

  // Also compare to org average interval
  const expectedInterval = orgAvgInterval > 0 ? orgAvgInterval : 90;
  const overdueFactor = daysSince > expectedInterval * 1.5 ? 10 : 0;
  freqScore = Math.min(30, freqScore + overdueFactor);

  factors.push({
    label: "Frecuencia de compra",
    weight: freqScore / 30,
    description: c.purchase_count === 0
      ? "Sin compras registradas"
      : `${c.purchase_count} compras totales`,
    bad: freqScore >= 15,
  });

  // Factor 3: Monetary value (0–20 pts — low LTV customers churn more)
  // Customers with very low spend are easier to lose
  let monoScore = 0;
  if (c.total_spent === 0) monoScore = 20;
  else if (c.total_spent < 5000) monoScore = 12;
  else if (c.total_spent < 20000) monoScore = 6;
  else monoScore = 0;

  factors.push({
    label: "Valor monetario (LTV)",
    weight: monoScore / 20,
    description: c.total_spent === 0
      ? "Sin ingresos registrados"
      : `$${c.total_spent.toLocaleString("es-AR")} total histórico`,
    bad: monoScore >= 10,
  });

  // Factor 4: Account age vs activity (0–10 pts)
  const accountAgeDays = differenceInDays(now, new Date(c.created_at));
  let ageScore = 0;
  if (accountAgeDays > 180 && c.purchase_count <= 1) ageScore = 10;
  else if (accountAgeDays > 90 && c.purchase_count === 0) ageScore = 10;
  else if (accountAgeDays > 60 && c.purchase_count === 0) ageScore = 5;

  factors.push({
    label: "Antigüedad vs actividad",
    weight: ageScore / 10,
    description: `Cliente hace ${accountAgeDays} días, ${c.purchase_count} compras`,
    bad: ageScore >= 5,
  });

  const rawScore = recencyScore + freqScore + monoScore + ageScore;
  const score = Math.min(100, rawScore);

  // Recommended action
  let action = "";
  if (score >= 80) {
    action = "🚨 Acción inmediata: llamada personal + oferta de retención del 20%";
  } else if (score >= 60) {
    action = "📧 Campaña win-back: email con descuento exclusivo por su ausencia";
  } else if (score >= 40) {
    action = "💬 Nurturing: secuencia de email recordándole productos que vio";
  } else {
    action = "👀 Monitorear: incluir en siguiente campaña masiva";
  }

  return { score, factors, action };
}

function riskLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

const RISK_CONFIG = {
  critical: { label: 'Crítico',  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/25',    bar: '[&>div]:bg-red-400' },
  high:     { label: 'Alto',     color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/25', bar: '[&>div]:bg-orange-400' },
  medium:   { label: 'Medio',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/25', bar: '[&>div]:bg-amber-400' },
  low:      { label: 'Bajo',     color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', bar: '[&>div]:bg-emerald-400' },
};

// ── Component ────────────────────────────────────────────────────────────────
export default function ChurnPredictionPage() {
  const { activeOrg } = useOrg();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterRisk, setFilterRisk] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'ltv' | 'recency'>('score');
  const [minScore, setMinScore] = useState(20); // only show customers with score >= N

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone, purchase_count, total_spent, last_purchase_at, created_at")
        .eq("org_id", activeOrg.id)
        .order("last_purchase_at", { ascending: true, nullsFirst: true });
      if (error) throw error;
      setCustomers(data ?? []);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  // Compute org average purchase interval
  const orgAvgInterval = useMemo(() => {
    const withPurchases = customers.filter(c => c.purchase_count >= 2 && c.last_purchase_at);
    if (!withPurchases.length) return 90;
    const intervals = withPurchases.map(c => {
      const ageDays = differenceInDays(Date.now(), new Date(c.created_at));
      return ageDays / c.purchase_count;
    });
    return Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
  }, [customers]);

  const scored = useMemo<ChurnedCustomer[]>(() => {
    return customers
      .map(c => {
        const { score, factors, action } = computeChurnScore(c, orgAvgInterval);
        const risk = riskLevel(score);
        const daysSince = c.last_purchase_at
          ? differenceInDays(Date.now(), new Date(c.last_purchase_at))
          : differenceInDays(Date.now(), new Date(c.created_at));
        return {
          ...c,
          churnScore: score,
          riskLevel: risk,
          daysSinceLastPurchase: daysSince,
          avgPurchaseIntervalDays: c.purchase_count >= 2
            ? Math.round(differenceInDays(Date.now(), new Date(c.created_at)) / c.purchase_count)
            : null,
          overdueByDays: Math.max(0, daysSince - orgAvgInterval),
          ltv: c.total_spent,
          action,
          factors,
        };
      })
      .filter(c => c.churnScore >= minScore);
  }, [customers, orgAvgInterval, minScore]);

  const filtered = useMemo(() => {
    let list = filterRisk === 'all' ? scored : scored.filter(c => c.riskLevel === filterRisk);
    return [...list].sort((a, b) => {
      if (sortBy === 'score') return b.churnScore - a.churnScore;
      if (sortBy === 'ltv') return b.ltv - a.ltv;
      return b.daysSinceLastPurchase - a.daysSinceLastPurchase;
    });
  }, [scored, filterRisk, sortBy]);

  // KPIs
  const kpis = useMemo(() => {
    const critical = scored.filter(c => c.riskLevel === 'critical').length;
    const high = scored.filter(c => c.riskLevel === 'high').length;
    const medium = scored.filter(c => c.riskLevel === 'medium').length;
    const low = scored.filter(c => c.riskLevel === 'low').length;
    const atRiskLTV = scored.filter(c => c.churnScore >= 50).reduce((s, c) => s + c.ltv, 0);
    const avgScore = scored.length
      ? Math.round(scored.reduce((s, c) => s + c.churnScore, 0) / scored.length)
      : 0;
    return { critical, high, medium, low, atRiskLTV, avgScore, total: scored.length };
  }, [scored]);

  // Export CSV
  const exportCsv = () => {
    const header = "Nombre,Email,Teléfono,Score Churn,Nivel de Riesgo,Días sin comprar,LTV,Acción";
    const rows = filtered.map(c =>
      `"${c.name}","${c.email ?? ''}","${c.phone ?? ''}",${c.churnScore},"${RISK_CONFIG[c.riskLevel].label}",${c.daysSinceLastPurchase},$${c.ltv},"${c.action}"`
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'churn-prediction.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
              <TrendingDown className="w-4.5 h-4.5 text-red-400" />
            </div>
            Predicción de Churn
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Clientes en riesgo de abandono · algoritmo RFM + comportamiento
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Recalcular
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card border border-red-500/20 rounded-xl p-4">
          <p className="text-xs text-muted-foreground">🚨 Crítico</p>
          <p className="text-2xl font-bold mt-1 text-red-400">{kpis.critical}</p>
          <p className="text-[10px] text-muted-foreground">score ≥ 75</p>
        </div>
        <div className="bg-card border border-orange-500/15 rounded-xl p-4">
          <p className="text-xs text-muted-foreground">⚠️ Alto</p>
          <p className="text-2xl font-bold mt-1 text-orange-400">{kpis.high}</p>
          <p className="text-[10px] text-muted-foreground">score 50–74</p>
        </div>
        <div className="bg-card border border-amber-500/15 rounded-xl p-4">
          <p className="text-xs text-muted-foreground">📊 Medio</p>
          <p className="text-2xl font-bold mt-1 text-amber-400">{kpis.medium}</p>
          <p className="text-[10px] text-muted-foreground">score 25–49</p>
        </div>
        <div className="bg-card border border-emerald-500/15 rounded-xl p-4">
          <p className="text-xs text-muted-foreground">✅ Bajo</p>
          <p className="text-2xl font-bold mt-1 text-emerald-400">{kpis.low}</p>
          <p className="text-[10px] text-muted-foreground">score 20–24</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">LTV en riesgo</p>
          <p className="text-lg font-bold mt-1 text-red-400">
            ${(kpis.atRiskLTV / 1000).toFixed(0)}K
          </p>
          <p className="text-[10px] text-muted-foreground">score ≥ 50</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Intervalo medio org</p>
          <p className="text-lg font-bold mt-1">{orgAvgInterval}d</p>
          <p className="text-[10px] text-muted-foreground">entre compras</p>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15 text-sm">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          Score de churn basado en <strong className="text-foreground">RFM</strong>: Recency (40 pts),
          Frequency (30 pts), Monetary (20 pts) y antigüedad vs actividad (10 pts).
          Intervalo promedio entre compras de la organización: <strong className="text-foreground">{orgAvgInterval} días</strong>.
          Clientes con score ≥ 50 tienen alta probabilidad de no volver.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map(r => {
            const cfg = r === 'all' ? null : RISK_CONFIG[r];
            return (
              <button
                key={r}
                onClick={() => setFilterRisk(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  filterRisk === r
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {r === 'all' ? 'Todos' : cfg!.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Score mín:</span>
          <select
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="text-xs bg-muted border border-border rounded-md px-2 py-1"
          >
            {[0, 10, 20, 30, 40, 50].map(v => (
              <option key={v} value={v}>≥{v}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground mx-2">Ordenar:</span>
          {(['score', 'ltv', 'recency'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
                sortBy === s ? 'bg-muted border-border text-foreground' : 'border-transparent hover:bg-muted/40 text-muted-foreground'
              }`}
            >
              {s === 'score' ? 'Riesgo' : s === 'ltv' ? 'LTV' : 'Inactividad'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingDown className="w-8 h-8 mx-auto mb-3 animate-pulse text-red-400" />
          <p className="text-sm">Analizando comportamiento de clientes...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-emerald-400/40" />
          <p>¡Buenas noticias! No hay clientes en riesgo con el filtro actual.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c, idx) => {
            const rc = RISK_CONFIG[c.riskLevel];
            const isExpanded = expandedId === c.id;
            return (
              <div key={c.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full text-left p-4 flex items-center gap-4"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  <span className="text-xs font-mono text-muted-foreground/50 w-5 shrink-0">
                    #{idx + 1}
                  </span>

                  {/* Score circle */}
                  <div className="relative w-11 h-11 shrink-0">
                    <svg className="w-11 h-11 -rotate-90" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                      <circle
                        cx="20" cy="20" r="16" fill="none"
                        stroke={c.churnScore >= 75 ? '#f87171' : c.churnScore >= 50 ? '#fb923c' : c.churnScore >= 25 ? '#fbbf24' : '#34d399'}
                        strokeWidth="3"
                        strokeDasharray={`${(c.churnScore / 100) * 100.5} 100.5`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${rc.color}`}>
                      {c.churnScore}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-sm truncate">{c.name}</p>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${rc.bg} ${rc.color}`}>
                        {rc.label}
                      </span>
                      {c.overdueByDays > 0 && (
                        <span className="shrink-0 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                          +{c.overdueByDays}d vencido
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {c.daysSinceLastPurchase}d sin comprar
                      </span>
                      <span>{c.purchase_count} compras</span>
                      {c.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {c.email}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* LTV */}
                  <div className="text-right shrink-0">
                    <p className="font-bold text-sm">${c.ltv.toLocaleString("es-AR")}</p>
                    <p className="text-[10px] text-muted-foreground">LTV</p>
                  </div>

                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                             : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                </button>

                {/* Expanded */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-4">
                    {/* Recommended action */}
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-card border border-border">
                      <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold mb-0.5">Acción recomendada</p>
                        <p className="text-sm text-muted-foreground">{c.action}</p>
                      </div>
                    </div>

                    {/* Score breakdown */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Factores de riesgo
                      </p>
                      <div className="space-y-2.5">
                        {c.factors.map((f, fi) => (
                          <div key={fi} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium flex items-center gap-1.5">
                                {f.bad
                                  ? <AlertTriangle className="w-3 h-3 text-red-400" />
                                  : <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                }
                                {f.label}
                              </span>
                              <span className={f.bad ? 'text-red-400' : 'text-emerald-400'}>
                                {Math.round(f.weight * 100)}%
                              </span>
                            </div>
                            <Progress
                              value={f.weight * 100}
                              className={`h-1.5 ${f.bad ? '[&>div]:bg-red-400' : '[&>div]:bg-emerald-400'}`}
                            />
                            <p className="text-[10px] text-muted-foreground">{f.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Quick contact actions */}
                    <div className="flex gap-2">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}?subject=Te extrañamos ${c.name.split(' ')[0]}&body=Hola ${c.name.split(' ')[0]}, ha pasado un tiempo...`}
                          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted/50 transition-all"
                        >
                          <Mail className="w-3.5 h-3.5" /> Enviar email
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={`https://wa.me/${c.phone.replace(/\D/g, '')}?text=Hola ${c.name.split(' ')[0]}! Te contactamos desde ${activeOrg?.name ?? 'la tienda'}.`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted/50 transition-all"
                        >
                          <Phone className="w-3.5 h-3.5" /> WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
