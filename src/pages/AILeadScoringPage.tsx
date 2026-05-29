import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import {
  Brain, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp,
  Zap, AlertTriangle, CheckCircle, Clock, DollarSign, User, Calendar,
  BarChart3, Target, Sparkles, ArrowRight, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Types ────────────────────────────────────────────────────────────────────
interface Deal {
  id: string;
  title: string;
  stage: string;
  amount: number;
  customer_name: string | null;
  customer_id: string | null;
  assigned_name: string | null;
  win_loss_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface Customer {
  id: string;
  name: string;
  total_spent: number;
  purchase_count: number;
  last_purchase_at: string | null;
}

interface ScoredDeal extends Deal {
  score: number;
  scoreTrend: 'up' | 'down' | 'stable';
  factors: ScoreFactor[];
  recommendation: string;
  urgency: 'hot' | 'warm' | 'cold';
  customerData: Customer | null;
}

interface ScoreFactor {
  label: string;
  points: number;
  max: number;
  description: string;
  positive: boolean;
}

// ── Scoring constants ────────────────────────────────────────────────────────
const STAGE_ORDER: Record<string, number> = {
  prospecto: 0, contactado: 1, calificado: 2,
  propuesta: 3, negociacion: 4, cerrado: 5, perdido: -1,
};

const STAGE_BASE_SCORE: Record<string, number> = {
  prospecto: 10, contactado: 20, calificado: 30,
  propuesta: 45, negociacion: 60,
};

// Compute lead score 0–100
function computeScore(
  deal: Deal,
  avgAmount: number,
  allDeals: Deal[],
  customerMap: Map<string, Customer>
): { score: number; factors: ScoreFactor[]; recommendation: string } {
  const factors: ScoreFactor[] = [];
  let totalScore = 0;

  const now = Date.now();
  const createdMs = new Date(deal.created_at).getTime();
  const updatedMs = new Date(deal.updated_at).getTime();
  const daysSinceCreated = (now - createdMs) / (1000 * 60 * 60 * 24);
  const daysSinceUpdated = (now - updatedMs) / (1000 * 60 * 60 * 24);

  // Factor 1: Stage (0–30 pts)
  const stageScore = STAGE_BASE_SCORE[deal.stage] ?? 10;
  const stageMax = 30;
  // Normalize: negociacion=30, prospecto=5
  const stageNorm = Math.min(30, Math.round((stageScore / 60) * 30));
  factors.push({
    label: "Etapa del pipeline",
    points: stageNorm,
    max: stageMax,
    description: `En etapa "${deal.stage}" (+${stageNorm} pts)`,
    positive: stageNorm >= 15,
  });
  totalScore += stageNorm;

  // Factor 2: Deal value vs average (0–20 pts)
  const valueRatio = avgAmount > 0 ? deal.amount / avgAmount : 0.5;
  const valueScore = Math.min(20, Math.round(valueRatio * 10 + (deal.amount > 0 ? 5 : 0)));
  factors.push({
    label: "Valor del deal",
    points: valueScore,
    max: 20,
    description: `$${deal.amount.toLocaleString("es-AR")} (${valueRatio >= 1 ? "≥" : "<"} promedio)`,
    positive: valueRatio >= 1,
  });
  totalScore += valueScore;

  // Factor 3: Recency / inactivity (0–20 pts)
  let recencyScore: number;
  if (daysSinceUpdated <= 3) recencyScore = 20;
  else if (daysSinceUpdated <= 7) recencyScore = 15;
  else if (daysSinceUpdated <= 14) recencyScore = 8;
  else if (daysSinceUpdated <= 30) recencyScore = 3;
  else recencyScore = 0;
  factors.push({
    label: "Actividad reciente",
    points: recencyScore,
    max: 20,
    description: daysSinceUpdated < 1
      ? "Actualizado hoy"
      : `Última actividad hace ${Math.round(daysSinceUpdated)} días`,
    positive: recencyScore >= 10,
  });
  totalScore += recencyScore;

  // Factor 4: Pipeline age penalty (0–15 pts, decays)
  let ageScore: number;
  if (daysSinceCreated <= 7) ageScore = 15;
  else if (daysSinceCreated <= 30) ageScore = 10;
  else if (daysSinceCreated <= 60) ageScore = 5;
  else if (daysSinceCreated <= 90) ageScore = 2;
  else ageScore = 0;
  factors.push({
    label: "Antigüedad en pipeline",
    points: ageScore,
    max: 15,
    description: `Creado hace ${Math.round(daysSinceCreated)} días`,
    positive: ageScore >= 8,
  });
  totalScore += ageScore;

  // Factor 5: Customer history (0–15 pts)
  const customer = deal.customer_id ? customerMap.get(deal.customer_id) : null;
  let custScore = 0;
  if (customer) {
    if (customer.purchase_count >= 5) custScore = 15;
    else if (customer.purchase_count >= 2) custScore = 10;
    else if (customer.purchase_count >= 1) custScore = 6;
    else custScore = 2;
    if (customer.last_purchase_at) {
      const daysSincePurchase = (now - new Date(customer.last_purchase_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSincePurchase <= 30) custScore = Math.min(15, custScore + 3);
    }
  } else {
    custScore = 3; // unknown customer
  }
  factors.push({
    label: "Historial del cliente",
    points: custScore,
    max: 15,
    description: customer
      ? `${customer.purchase_count} compras previas ($${customer.total_spent.toLocaleString("es-AR")} total)`
      : "Cliente sin historial",
    positive: custScore >= 6,
  });
  totalScore += custScore;

  // Clamp to 100
  const score = Math.min(100, Math.max(0, totalScore));

  // Recommendation
  let recommendation = "";
  if (score >= 75) recommendation = "🔥 Deal caliente — contactar hoy y cerrar.";
  else if (score >= 55) recommendation = "⚡ Buen potencial — enviar propuesta o follow-up esta semana.";
  else if (score >= 35) {
    if (daysSinceUpdated > 14) recommendation = "⏰ Sin actividad — re-engagear o escalar a perdido.";
    else recommendation = "📋 Nutrir — calificar mejor y avanzar en etapa.";
  } else {
    if (daysSinceCreated > 90) recommendation = "🗑️ Deal muerto — mover a perdido para limpiar el pipeline.";
    else recommendation = "❄️ Lead frío — campaña de nurturing antes de invertir tiempo.";
  }

  return { score, factors, recommendation };
}

function urgencyFromScore(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 65) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

// ── Tab type ─────────────────────────────────────────────────────────────────
type TabId = 'todos' | 'calientes' | 'por-vendedor';

// ── Component ────────────────────────────────────────────────────────────────
export default function AILeadScoringPage() {
  const { activeOrg } = useOrg();
  usePageTitle("AI Lead Scoring");

  const [deals, setDeals] = useState<Deal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'amount' | 'updated'>('score');
  const [filterUrgency, setFilterUrgency] = useState<'all' | 'hot' | 'warm' | 'cold'>('all');
  const [activeTab, setActiveTab] = useState<TabId>('todos');

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const [dealsRes, custRes] = await Promise.all([
        supabase
          .from("deals")
          .select("id, title, stage, amount, customer_name, customer_id, assigned_name, win_loss_reason, created_at, updated_at")
          .eq("org_id", activeOrg.id)
          .not("stage", "in", "(cerrado,perdido)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("customers")
          .select("id, name, total_spent, purchase_count, last_purchase_at")
          .eq("org_id", activeOrg.id),
      ]);
      if (dealsRes.error) throw dealsRes.error;
      if (custRes.error) throw custRes.error;
      setDeals(dealsRes.data ?? []);
      setCustomers(custRes.data ?? []);
    } catch (e: any) {
      toast.error("Error cargando deals: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach(c => m.set(c.id, c));
    return m;
  }, [customers]);

  const avgAmount = useMemo(() => {
    if (!deals.length) return 0;
    return deals.reduce((s, d) => s + (d.amount || 0), 0) / deals.length;
  }, [deals]);

  const scoredDeals = useMemo<ScoredDeal[]>(() => {
    return deals.map((deal, idx) => {
      const { score, factors, recommendation } = computeScore(deal, avgAmount, deals, customerMap);
      // Simple trend: compare score to median (pseudo-previous)
      const trend: 'up' | 'down' | 'stable' =
        score >= 65 ? 'up' : score <= 30 ? 'down' : 'stable';
      return {
        ...deal,
        score,
        scoreTrend: trend,
        factors,
        recommendation,
        urgency: urgencyFromScore(score),
        customerData: deal.customer_id ? customerMap.get(deal.customer_id) ?? null : null,
      };
    });
  }, [deals, avgAmount, customerMap]);

  // ── KPI computations ─────────────────────────────────────────────────────
  const hotCount = useMemo(() => scoredDeals.filter(d => d.urgency === 'hot').length, [scoredDeals]);

  const avgScore = useMemo(() => {
    if (!scoredDeals.length) return 0;
    return scoredDeals.reduce((s, d) => s + d.score, 0) / scoredDeals.length;
  }, [scoredDeals]);

  const highValuePipeline = useMemo(
    () => scoredDeals.filter(d => d.score >= 70).reduce((s, d) => s + d.amount, 0),
    [scoredDeals]
  );

  const needsAttentionCount = useMemo(
    () => scoredDeals.filter(d => {
      const earlyStages = ['prospecto', 'contactado', 'calificado'];
      return earlyStages.includes(d.stage) && d.score < 40;
    }).length,
    [scoredDeals]
  );

  const filtered = useMemo(() => {
    let list = filterUrgency === 'all' ? scoredDeals : scoredDeals.filter(d => d.urgency === filterUrgency);
    return [...list].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'amount') return b.amount - a.amount;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [scoredDeals, sortBy, filterUrgency]);

  // Hot deals for "Calientes" tab (sorted by score desc)
  const hotDeals = useMemo(
    () => [...scoredDeals.filter(d => d.urgency === 'hot')].sort((a, b) => b.score - a.score),
    [scoredDeals]
  );

  // Per-seller grouping for "Por Vendedor" tab
  const sellerGroups = useMemo(() => {
    const map = new Map<string, ScoredDeal[]>();
    scoredDeals.forEach(d => {
      const key = d.assigned_name ?? "Sin asignar";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    });
    return Array.from(map.entries())
      .map(([seller, sellerDeals]) => ({
        seller,
        count: sellerDeals.length,
        avgScore: sellerDeals.length
          ? Math.round(sellerDeals.reduce((s, d) => s + d.score, 0) / sellerDeals.length)
          : 0,
        deals: [...sellerDeals].sort((a, b) => b.score - a.score),
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [scoredDeals]);

  // KPIs (kept for backward-compat internal use)
  const kpis = useMemo(() => {
    const hot = hotCount;
    const warm = scoredDeals.filter(d => d.urgency === 'warm').length;
    const cold = scoredDeals.filter(d => d.urgency === 'cold').length;
    const totalValue = scoredDeals.reduce((s, d) => s + d.amount, 0);
    const hotValue = scoredDeals.filter(d => d.urgency === 'hot').reduce((s, d) => s + d.amount, 0);
    return { hot, warm, cold, avgScore: Math.round(avgScore), totalValue, hotValue };
  }, [scoredDeals, hotCount, avgScore]);

  const urgencyConfig = {
    hot:  { label: 'Caliente', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',    dot: 'bg-red-400' },
    warm: { label: 'Tibio',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400' },
    cold: { label: 'Frío',     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',   dot: 'bg-blue-400' },
  };

  const scoreColor = (s: number) =>
    s >= 65 ? 'text-emerald-400' : s >= 35 ? 'text-amber-400' : 'text-red-400';
  const scoreBar = (s: number) =>
    s >= 65 ? '[&>div]:bg-emerald-400' : s >= 35 ? '[&>div]:bg-amber-400' : '[&>div]:bg-red-400';

  // Reusable deal card renderer
  const renderDealCard = (deal: ScoredDeal, idx: number) => {
    const uc = urgencyConfig[deal.urgency];
    const isExpanded = expandedId === deal.id;
    return (
      <div
        key={deal.id}
        className="bg-card border border-border rounded-xl overflow-hidden transition-all duration-200 hover:border-border/80"
      >
        {/* Main row */}
        <button
          className="w-full text-left p-4 flex items-center gap-4"
          onClick={() => setExpandedId(isExpanded ? null : deal.id)}
        >
          {/* Rank */}
          <span className="text-xs font-mono text-muted-foreground/50 w-5 shrink-0">
            #{idx + 1}
          </span>

          {/* Score ring */}
          <div className="relative w-12 h-12 shrink-0">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
              <circle
                cx="20" cy="20" r="16" fill="none"
                stroke={deal.score >= 65 ? '#34d399' : deal.score >= 35 ? '#fbbf24' : '#f87171'}
                strokeWidth="3"
                strokeDasharray={`${(deal.score / 100) * 100.5} 100.5`}
                strokeLinecap="round"
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${scoreColor(deal.score)}`}>
              {deal.score}
            </span>
          </div>

          {/* Deal info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-semibold text-sm truncate">{deal.title}</p>
              <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${uc.bg} ${uc.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${uc.dot}`} />
                {uc.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {deal.customer_name && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" /> {deal.customer_name}
                </span>
              )}
              <span className="capitalize">{deal.stage}</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(deal.updated_at), { locale: es, addSuffix: true })}
              </span>
            </div>
          </div>

          {/* Amount */}
          <div className="text-right shrink-0">
            <p className="font-bold text-sm">${deal.amount.toLocaleString("es-AR")}</p>
            {deal.assigned_name && (
              <p className="text-[10px] text-muted-foreground">{deal.assigned_name}</p>
            )}
          </div>

          {/* Expand */}
          <div className="shrink-0 text-muted-foreground/40">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {/* Expanded detail */}
        {isExpanded && (
          <div className="border-t border-border bg-muted/20 p-4 space-y-4">
            {/* Recommendation */}
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-card border border-border">
              <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground mb-0.5">Recomendación IA</p>
                <p className="text-sm text-muted-foreground">{deal.recommendation}</p>
              </div>
            </div>

            {/* Score breakdown */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Desglose del score
              </p>
              <div className="space-y-2.5">
                {deal.factors.map((f, fi) => (
                  <div key={fi} className="space-y-1 pb-12">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        {f.positive
                          ? <TrendingUp className="w-3 h-3 text-emerald-400" />
                          : <TrendingDown className="w-3 h-3 text-red-400" />
                        }
                        <span className="font-medium">{f.label}</span>
                      </span>
                      <span className={`font-bold ${f.positive ? 'text-emerald-400' : 'text-red-400'}`}>
                        +{f.points}/{f.max}
                      </span>
                    </div>
                    <Progress
                      value={(f.points / f.max) * 100}
                      className={`h-1.5 ${scoreBar(Math.round((f.points / f.max) * 100))}`}
                    />
                    <p className="text-[10px] text-muted-foreground">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer data */}
            {deal.customerData && (
              <div className="p-3 rounded-lg bg-card border border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Cliente</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-foreground">{deal.customerData.purchase_count}</p>
                    <p className="text-[10px] text-muted-foreground">Compras previas</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">
                      ${(deal.customerData.total_spent / 1000).toFixed(1)}K
                    </p>
                    <p className="text-[10px] text-muted-foreground">Total histórico</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {deal.customerData.last_purchase_at
                        ? formatDistanceToNow(new Date(deal.customerData.last_purchase_at), { locale: es, addSuffix: true })
                        : 'Sin compras'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Última compra</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'todos', label: 'Todos los Deals' },
    { id: 'calientes', label: 'Calientes 🔥' },
    { id: 'por-vendedor', label: 'Por Vendedor' },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* PageHeader */}
      <PageHeader
        icon={Brain}
        title="AI Lead Scoring"
        description="Priorización inteligente de oportunidades de venta"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Recalcular
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Leads calientes"
          value={hotCount}
          sub="score ≥ 65"
          icon={Zap}
          color="destructive"
        />
        <KPICard
          label="Score promedio"
          value={avgScore.toFixed(0)}
          sub="de 100 pts"
          icon={Brain}
          color="primary"
        />
        <KPICard
          label="Pipeline prioritario"
          value={`$${(highValuePipeline / 1000).toFixed(0)}K`}
          sub="deals con score ≥ 70"
          icon={DollarSign}
          color="success"
        />
        <KPICard
          label="Necesitan atención"
          value={needsAttentionCount}
          sub="etapa temprana + score bajo"
          icon={AlertTriangle}
          color="warning"
        />
      </div>

      {/* Scoring info box */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-violet-500/5 border border-violet-500/15 text-sm">
        <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          El score se calcula con <strong className="text-foreground">5 factores</strong>: etapa del pipeline (30 pts),
          valor del deal vs. promedio (20 pts), actividad reciente (20 pts), antigüedad (15 pts) y
          historial del cliente (15 pts). Deals cerrados/perdidos se excluyen.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Todos los Deals */}
      {activeTab === 'todos' && (
        <>
          {/* Filters + Sort */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5">
              {(['all', 'hot', 'warm', 'cold'] as const).map(u => (
                <button
                  key={u}
                  onClick={() => setFilterUrgency(u)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    filterUrgency === u
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {u === 'all' ? 'Todos' : u === 'hot' ? '🔥 Calientes' : u === 'warm' ? '⚡ Tibios' : '❄️ Fríos'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
              <span>Ordenar:</span>
              {(['score', 'amount', 'updated'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-2.5 py-1 rounded-md border transition-all ${
                    sortBy === s ? 'bg-muted border-border text-foreground' : 'border-transparent hover:bg-muted/40'
                  }`}
                >
                  {s === 'score' ? 'Score' : s === 'amount' ? 'Valor' : 'Actividad'}
                </button>
              ))}
            </div>
          </div>

          {/* Deal list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Brain className="w-8 h-8 text-violet-400 mx-auto mb-3 animate-pulse" />
                <p className="text-sm text-muted-foreground">Analizando deals con IA...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No hay deals activos en el pipeline.</p>
              <p className="text-sm mt-1">Creá deals en la página de Pipeline para ver scores.</p>
            </div>
          ) : (
            <div className="space-y-2 pb-12">
              {filtered.map((deal, idx) => renderDealCard(deal, idx))}
            </div>
          )}
        </>
      )}

      {/* Tab: Calientes */}
      {activeTab === 'calientes' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Brain className="w-8 h-8 text-violet-400 mx-auto mb-3 animate-pulse" />
            </div>
          ) : hotDeals.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No hay leads calientes en este momento.</p>
              <p className="text-sm mt-1">Los deals con score ≥ 65 aparecen aquí.</p>
            </div>
          ) : (
            <div className="space-y-2 pb-12">
              {hotDeals.map((deal, idx) => renderDealCard(deal, idx))}
            </div>
          )}
        </>
      )}

      {/* Tab: Por Vendedor */}
      {activeTab === 'por-vendedor' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Brain className="w-8 h-8 text-violet-400 mx-auto mb-3 animate-pulse" />
            </div>
          ) : sellerGroups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No hay deals con vendedor asignado.</p>
            </div>
          ) : (
            <div className="space-y-4 pb-12">
              {sellerGroups.map(({ seller, count, avgScore: sellerAvg, deals: sellerDeals }) => (
                <div key={seller} className="bg-card border border-border rounded-xl overflow-hidden">
                  {/* Seller header */}
                  <div className="flex items-center justify-between p-4 border-b border-border bg-muted/10">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-primary/60" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{seller}</p>
                        <p className="text-xs text-muted-foreground">{count} deal{count !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${scoreColor(sellerAvg)}`}>{sellerAvg}</p>
                      <p className="text-[10px] text-muted-foreground">score promedio</p>
                    </div>
                  </div>
                  {/* Seller deals */}
                  <div className="divide-y divide-border/50">
                    {sellerDeals.map((deal, idx) => renderDealCard(deal, idx))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
