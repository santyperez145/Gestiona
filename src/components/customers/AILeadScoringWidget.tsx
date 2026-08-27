import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Brain, Flame, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ── Types ────────────────────────────────────────────────────────────────────
interface Deal {
  id: string;
  title: string;
  stage: string;
  amount: number;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

const STAGE_BASE_SCORE: Record<string, number> = {
  prospecto: 10, contactado: 20, calificado: 30,
  propuesta: 45, negociacion: 60,
};

// Lightweight version of the scoring model from the former AILeadScoringPage —
// stage + value + recency + age only (no historical win/loss adjustments).
function computeQuickScore(deal: Deal, avgAmount: number): number {
  const stageScore = STAGE_BASE_SCORE[deal.stage] ?? 10;
  const stageNorm = Math.min(30, Math.round((stageScore / 60) * 30));

  const valueRatio = avgAmount > 0 ? deal.amount / avgAmount : 0.5;
  const valueScore = Math.min(20, Math.round(valueRatio * 10 + (deal.amount > 0 ? 5 : 0)));

  const now = Date.now();
  const daysSinceUpdated = (now - new Date(deal.updated_at).getTime()) / 86400000;
  let recencyScore: number;
  if (daysSinceUpdated <= 3) recencyScore = 20;
  else if (daysSinceUpdated <= 7) recencyScore = 15;
  else if (daysSinceUpdated <= 14) recencyScore = 8;
  else if (daysSinceUpdated <= 30) recencyScore = 3;
  else recencyScore = 0;

  const daysSinceCreated = (now - new Date(deal.created_at).getTime()) / 86400000;
  let ageScore: number;
  if (daysSinceCreated <= 7) ageScore = 15;
  else if (daysSinceCreated <= 30) ageScore = 10;
  else if (daysSinceCreated <= 60) ageScore = 5;
  else if (daysSinceCreated <= 90) ageScore = 2;
  else ageScore = 0;

  return Math.min(100, Math.max(0, stageNorm + valueScore + recencyScore + ageScore));
}

function fmtARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function AILeadScoringWidget() {
  const { activeOrg } = useOrg();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg?.id) return;
    setLoading(true);
    supabase
      .from("deals")
      .select("id, title, stage, value_ars, customer_name, created_at, updated_at")
      .eq("org_id", activeOrg.id)
      .not("stage", "in", "(cerrado,perdido)")
      .order("updated_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        // La columna real del monto en `deals` es `value_ars`.
        setDeals((data ?? []).map((d: any) => ({ ...d, amount: Number(d.value_ars) || 0 })) as Deal[]);
        setLoading(false);
      });
  }, [activeOrg?.id]);

  const topLeads = useMemo(() => {
    if (!deals.length) return [];
    const avgAmount = deals.reduce((s, d) => s + (d.amount || 0), 0) / deals.length;
    return deals
      .map(d => ({ ...d, score: computeQuickScore(d, avgAmount) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [deals]);

  if (!activeOrg || loading) return null;
  if (deals.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" /> AI Lead Scoring — Top oportunidades
        </h3>
        <Link to="/clientes?vista=pipeline" className="text-xs text-primary hover:underline flex items-center gap-1">
          Ver CRM <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {topLeads.map((d, i) => (
          <div key={d.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/20 transition-colors">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{d.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {d.customer_name || "Sin cliente"} · {fmtARS(d.amount || 0)}
              </p>
            </div>
            <Badge className={`text-[10px] shrink-0 ${d.score >= 65 ? "bg-red-500/15 text-red-400" : d.score >= 35 ? "bg-amber-500/15 text-amber-400" : "bg-muted/40 text-muted-foreground"}`}>
              {d.score >= 65 && <Flame className="w-2.5 h-2.5 mr-1" />}
              {d.score}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
