/**
 * PipelineKanbanTab — ported from the former SalesPipelinePage (/pipeline).
 * Vista «Pipeline» del workspace de Clientes (/clientes?vista=pipeline) desde la
 * consolidación 2026-08-27; antes era la tab default de AdvancedCRMPage, que dejó
 * de existir como página.
 *
 * Full drag-and-drop pipeline board on the `deals` table: KPIs, funnel/win-loss
 * analytics, revenue forecast by month, per-deal activity timeline with an AI coach,
 * and win/loss reason capture on close. This is the richer of the two former
 * kanban implementations (AdvancedCRMPage's old static `crm_deals` board was dropped
 * in favor of this one).
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { llamarIA } from "@/lib/ia";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, X, Edit2, Trash2, DollarSign, User, Calendar,
  TrendingUp, Loader2, GripVertical, FileSpreadsheet, MessageCircle,
  Phone, Mail, Users, StickyNote, ChevronRight, Clock, Activity,
  ArrowRight, Send, Zap, BarChart3, Sparkles, Brain, AlertTriangle, Target,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatARS } from "@/lib/supabaseStore";
import KPICard from "@/components/shared/KPICard";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "lead" | "contactado" | "propuesta" | "negociacion" | "cerrado" | "perdido";

type ActivityType = "note" | "call" | "email" | "meeting" | "stage_change" | "whatsapp";

interface DealActivity {
  id: string;
  deal_id: string;
  type: ActivityType;
  content: string;
  meta?: { from_stage?: string; to_stage?: string } | null;
  created_at: string;
}

interface Deal {
  id: string;
  org_id: string;
  title: string;
  customer_name: string;
  value_ars: number;
  stage: Stage;
  notes: string;
  expected_close: string | null;
  created_at: string;
  updated_at: string;
  win_loss_reason?: string | null;
}

const WIN_REASONS = ["Precio competitivo", "Relación previa", "Mejor propuesta", "Velocidad de respuesta", "Referencia", "Otro"];
const LOSS_REASONS = ["Precio alto", "Eligieron competencia", "Sin presupuesto", "Timing", "Falta de seguimiento", "Proyecto cancelado", "Otro"];

const STAGES: { value: Stage; label: string; color: string; bg: string; probability: number }[] = [
  { value: "lead",        label: "Lead",         color: "text-muted-foreground", bg: "bg-muted/40",         probability: 10 },
  { value: "contactado",  label: "Contactado",   color: "text-blue-400",         bg: "bg-blue-500/10",      probability: 25 },
  { value: "propuesta",   label: "Propuesta",    color: "text-purple-400",       bg: "bg-purple-500/10",    probability: 50 },
  { value: "negociacion", label: "Negociación",  color: "text-yellow-400",       bg: "bg-yellow-500/10",    probability: 75 },
  { value: "cerrado",     label: "Cerrado ✓",    color: "text-emerald-400",      bg: "bg-emerald-500/10",   probability: 100 },
  { value: "perdido",     label: "Perdido ✗",    color: "text-red-400",          bg: "bg-red-500/10",       probability: 0 },
];

const EMPTY_FORM = {
  title: "",
  customer_name: "",
  value_ars: "",
  stage: "lead" as Stage,
  notes: "",
  expected_close: "",
};

// ─── Deal scoring ─────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 deal quality score based on:
 *  - Stage probability (0–40 pts)
 *  - Value tier (0–30 pts)
 *  - Freshness — days since update (0–20 pts)
 *  - Has expected close date (0–10 pts)
 */
function dealScore(deal: Deal): number {
  const stagePts = (STAGES.find(s => s.value === deal.stage)?.probability ?? 0) * 0.4;
  const valuePts = deal.value_ars >= 500000 ? 30 : deal.value_ars >= 200000 ? 22 : deal.value_ars >= 50000 ? 15 : deal.value_ars > 0 ? 8 : 0;
  const daysSince = Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / 86400000);
  const freshPts = daysSince <= 1 ? 20 : daysSince <= 3 ? 16 : daysSince <= 7 ? 12 : daysSince <= 14 ? 6 : daysSince <= 30 ? 2 : 0;
  const closePts = deal.expected_close ? 10 : 0;
  return Math.round(Math.min(100, stagePts + valuePts + freshPts + closePts));
}

function DealScoreBadge({ score }: { score: number }) {
  const color = score >= 75 ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"
    : score >= 50 ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/30"
    : score >= 25 ? "text-orange-400 bg-orange-400/10 border-orange-400/30"
    : "text-red-400 bg-red-400/10 border-red-400/30";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${color}`} title={`Score del deal: ${score}/100 (etapa + valor + frescura + cierre)`}>
      {score}
    </span>
  );
}

// ─── Activity helpers ─────────────────────────────────────────────────────────

const ACTIVITY_META: Record<ActivityType, { icon: React.FC<any>; label: string; color: string }> = {
  note:         { icon: StickyNote,    label: "Nota",        color: "text-yellow-400" },
  call:         { icon: Phone,         label: "Llamada",     color: "text-blue-400" },
  email:        { icon: Mail,          label: "Email",       color: "text-purple-400" },
  meeting:      { icon: Users,         label: "Reunión",     color: "text-green-400" },
  stage_change: { icon: ArrowRight,    label: "Etapa",       color: "text-primary" },
  whatsapp:     { icon: MessageCircle, label: "WhatsApp",    color: "text-emerald-400" },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

// ─── Activity Panel (Sidebar) ─────────────────────────────────────────────────

interface CoachResult {
  win_probability: number;
  urgency: "hot" | "warm" | "cold";
  next_action: { action: string; why: string; when: string; owner_role: string };
  talking_points: string[];
  risk_factors: string[];
  similar_wins: { count: number; avg_days: number; dominant_reason: string } | null;
  coach_note: string;
  _parse_error?: boolean;
}

function ActivityPanel({
  deal,
  orgId,
  userId,
  onClose,
  onStageChange,
}: {
  deal: Deal;
  orgId: string;
  userId: string;
  onClose: () => void;
  onStageChange: (deal: Deal, stage: Stage) => Promise<void>;
}) {
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [actType, setActType] = useState<ActivityType>("note");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  // ── AI Coach state ──────────────────────────────────────────────────────
  const [coach, setCoach] = useState<CoachResult | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);

  const runCoach = useCallback(async () => {
    setCoachLoading(true);
    setCoachError(null);
    setCoachOpen(true);
    try {
      const data = await llamarIA("ai-deal-coach", {
        body: { deal_id: deal.id },
      });
      setCoach(data as CoachResult);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error invocando al coach";
      setCoachError(msg);
    } finally {
      setCoachLoading(false);
    }
  }, [deal.id]);

  const loadActivities = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("deal_activities")
      .select("*")
      .eq("deal_id", deal.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setActivities((data || []) as DealActivity[]);
    setLoading(false);
  }, [deal.id]);

  useEffect(() => { loadActivities(); }, [loadActivities]);

  const logActivity = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await supabase.from("deal_activities").insert({
        org_id: orgId,
        deal_id: deal.id,
        user_id: userId,
        type: actType,
        content: content.trim(),
      });
      setContent("");
      await loadActivities();
      // Touch the deal's updated_at
      await supabase.from("deals").update({ updated_at: new Date().toISOString() }).eq("id", deal.id);
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const stageInfo = STAGES.find(s => s.value === deal.stage)!;
  const isOverdue = deal.expected_close && new Date(deal.expected_close) < new Date()
    && deal.stage !== "cerrado" && deal.stage !== "perdido";

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-card border-l border-border z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 border-b border-border shrink-0">
        <button onClick={onClose} className="mt-0.5 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0">
          <X className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm leading-tight truncate">{deal.title}</h2>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {deal.customer_name && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" />{deal.customer_name}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stageInfo.bg} ${stageInfo.color}`}>
              {stageInfo.label}
            </span>
            {deal.value_ars > 0 && (
              <span className="text-xs font-mono font-semibold text-primary">{formatARS(deal.value_ars)}</span>
            )}
          </div>
          {deal.expected_close && (
            <div className={`text-[10px] flex items-center gap-1 mt-0.5 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
              <Calendar className="w-3 h-3" />
              Cierre: {new Date(deal.expected_close + "T12:00:00").toLocaleDateString("es-AR")}
              {isOverdue && " (vencido)"}
            </div>
          )}
        </div>
      </div>

      {/* AI Coach trigger + collapsed panel */}
      <div className="px-4 py-2.5 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-violet-400" /> AI Coach
          </p>
          <button
            onClick={() => (coachOpen && coach ? setCoachOpen(false) : runCoach())}
            disabled={coachLoading}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/15 disabled:opacity-50 transition-all"
          >
            {coachLoading
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Analizando…</>
              : coachOpen && coach
                ? <><X className="w-3 h-3" /> Cerrar coach</>
                : <><Brain className="w-3 h-3" /> {coach ? "Re-analizar" : "Pedir consejo"}</>}
          </button>
        </div>

        {coachOpen && coach && !coachLoading && (
          <div className="mt-2.5 space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
            {/* Win probability + urgency strip */}
            <div className="flex items-center gap-2.5 p-2 rounded-md bg-violet-500/5 border border-violet-500/20">
              <div className="relative w-9 h-9 shrink-0">
                <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none"
                    stroke={coach.win_probability >= 65 ? "#10b981" : coach.win_probability >= 35 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="3" strokeDasharray={`${coach.win_probability * 0.88} 88`} strokeLinecap="round" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                  {coach.win_probability}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Probabilidad de cierre</p>
                <p className="text-xs text-foreground leading-tight mt-0.5">{coach.coach_note}</p>
              </div>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${
                coach.urgency === "hot"  ? "bg-red-500/15 text-red-400" :
                coach.urgency === "warm" ? "bg-amber-500/15 text-amber-400" :
                                           "bg-blue-500/15 text-blue-400"
              }`}>{coach.urgency}</span>
            </div>

            {/* Next action */}
            <div className="p-2.5 rounded-md bg-primary/5 border border-primary/20 space-y-1">
              <div className="flex items-center gap-1.5">
                <Target className="w-3 h-3 text-primary" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Próxima acción</p>
                <span className="ml-auto text-[9px] text-muted-foreground">{coach.next_action.when}</span>
              </div>
              <p className="text-xs font-medium text-foreground leading-tight">{coach.next_action.action}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{coach.next_action.why}</p>
            </div>

            {/* Talking points */}
            {coach.talking_points.length > 0 && (
              <div className="p-2.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" /> Para mencionar
                </p>
                <ul className="space-y-1">
                  {coach.talking_points.map((p, i) => (
                    <li key={i} className="text-[11px] text-foreground/90 leading-snug flex gap-1.5">
                      <span className="text-emerald-400 shrink-0">·</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks */}
            {coach.risk_factors.length > 0 && (
              <div className="p-2.5 rounded-md bg-red-500/5 border border-red-500/20 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Riesgos a mitigar
                </p>
                <ul className="space-y-1">
                  {coach.risk_factors.map((r, i) => (
                    <li key={i} className="text-[11px] text-foreground/90 leading-snug flex gap-1.5">
                      <span className="text-red-400 shrink-0">·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Similar wins */}
            {coach.similar_wins && coach.similar_wins.count > 0 && (
              <div className="p-2 rounded-md bg-muted/40 border border-border/40 text-[10px] text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" />
                {coach.similar_wins.count} deals similares ganados ·
                cierre promedio {coach.similar_wins.avg_days}d ·
                razón dominante: <span className="text-emerald-400">{coach.similar_wins.dominant_reason}</span>
              </div>
            )}
          </div>
        )}

        {coachOpen && coachError && !coachLoading && (
          <div className="mt-2.5 p-2 rounded-md bg-red-500/5 border border-red-500/20 text-[11px] text-red-400">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            {coachError}
          </div>
        )}
      </div>

      {/* Quick stage move */}
      <div className="px-4 py-2.5 border-b border-border/50 shrink-0">
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Mover a etapa</p>
        <div className="flex gap-1.5 flex-wrap">
          {STAGES.filter(s => s.value !== deal.stage).map(s => (
            <button
              key={s.value}
              onClick={async () => {
                await onStageChange(deal, s.value);
                // Log stage change activity
                await supabase.from("deal_activities").insert({
                  org_id: orgId,
                  deal_id: deal.id,
                  user_id: userId,
                  type: "stage_change",
                  content: `Etapa cambiada: ${stageInfo.label} → ${s.label}`,
                  meta: { from_stage: deal.stage, to_stage: s.value },
                });
                await loadActivities();
              }}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-all hover:opacity-80 ${s.bg} ${s.color} border-current/20`}
            >
              → {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* New activity form */}
      <div className="px-4 py-3 border-b border-border/50 shrink-0">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {(Object.keys(ACTIVITY_META) as ActivityType[]).filter(t => t !== "stage_change").map(t => {
            const meta = ACTIVITY_META[t];
            const Icon = meta.icon;
            return (
              <button
                key={t}
                onClick={() => setActType(t)}
                className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                  actType === t
                    ? `bg-primary/15 border-primary/40 text-primary`
                    : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3 h-3" />{meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={`Registrar ${ACTIVITY_META[actType].label.toLowerCase()}...`}
            className="bg-muted resize-none text-xs"
            rows={2}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) logActivity(); }}
          />
          <Button
            size="sm"
            onClick={logActivity}
            disabled={saving || !content.trim()}
            className="gradient-gold text-primary-foreground shrink-0 h-auto px-3"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground/60 mt-1">Ctrl+Enter para guardar</p>
      </div>

      {/* Activity timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />Cargando...
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50 gap-2">
            <Activity className="w-8 h-8" />
            <p className="text-xs">Sin actividad registrada</p>
            <p className="text-[10px]">Agrega una nota, llamada o email arriba</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border/50" />
            <div className="space-y-4 pb-12">
              {activities.map(act => {
                const meta = ACTIVITY_META[act.type] || ACTIVITY_META.note;
                const Icon = meta.icon;
                return (
                  <div key={act.id} className="flex gap-3 relative pl-1">
                    {/* Icon bubble */}
                    <div className={`w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 z-10 ${meta.color}`}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />{timeAgo(act.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{act.content}</p>
                      {act.meta?.from_stage && act.meta?.to_stage && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {STAGES.find(s => s.value === act.meta!.from_stage)?.label ?? act.meta.from_stage}
                          </span>
                          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                          <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {STAGES.find(s => s.value === act.meta!.to_stage)?.label ?? act.meta.to_stage}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* WhatsApp quick action */}
      {deal.customer_name && (
        <div className="px-4 py-3 border-t border-border/50 shrink-0">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Hola ${deal.customer_name}, te escribo sobre "${deal.title}". `)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors text-xs font-medium"
          >
            <MessageCircle className="w-4 h-4" />
            Enviar WhatsApp a {deal.customer_name}
            <Zap className="w-3 h-3 ml-auto opacity-60" />
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Deal Form Dialog ─────────────────────────────────────────────────────────

function DealDialog({
  initial,
  open,
  onClose,
  onSave,
}: {
  initial?: Partial<Deal>;
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        title: initial?.title ?? "",
        customer_name: initial?.customer_name ?? "",
        value_ars: initial?.value_ars !== undefined ? String(initial.value_ars) : "",
        stage: initial?.stage ?? "lead",
        notes: initial?.notes ?? "",
        expected_close: initial?.expected_close?.slice(0, 10) ?? "",
      });
    }
  }, [open, initial]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("El título es obligatorio"); return; }
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        customer_name: form.customer_name.trim() || null,
        value_ars: form.value_ars ? Number(form.value_ars) : 0,
        stage: form.stage,
        notes: form.notes.trim() || null,
        expected_close: form.expected_close || null,
      });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar oportunidad" : "Nueva oportunidad"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Ej: Pedido perfumes Lattafa x20" className="bg-muted" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Input value={form.customer_name} onChange={e => set("customer_name", e.target.value)} placeholder="Nombre del cliente" className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label>Valor estimado ($)</Label>
              <Input type="number" value={form.value_ars} onChange={e => set("value_ars", e.target.value)} placeholder="0" className="bg-muted" min={0} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Etapa</Label>
              <Select value={form.stage} onValueChange={v => set("stage", v)}>
                <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cierre estimado</Label>
              <Input type="date" value={form.expected_close} onChange={e => set("expected_close", e.target.value)} className="bg-muted" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Detalles, seguimiento, requisitos..." className="bg-muted resize-none" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            {initial?.id ? "Guardar cambios" : "Crear oportunidad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onEdit,
  onDelete,
  onMove,
  stages,
  onDragStart,
  onViewActivity,
}: {
  deal: Deal;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (stage: Stage) => void;
  stages: typeof STAGES;
  onDragStart: (id: string) => void;
  onViewActivity: () => void;
}) {
  const isOverdue = deal.expected_close && new Date(deal.expected_close) < new Date() && deal.stage !== "cerrado" && deal.stage !== "perdido";
  const stageInfo = stages.find(s => s.value === deal.stage)!;
  const daysSinceUpdate = Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / 86400000);
  const isStale = daysSinceUpdate >= 7 && deal.stage !== "cerrado" && deal.stage !== "perdido";
  const score = dealScore(deal);

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart(deal.id); }}
      className={`bg-card border rounded-xl p-3 shadow-sm hover:border-primary/30 transition-all group cursor-grab active:cursor-grabbing active:opacity-60 active:scale-95 ${
        isOverdue ? "border-red-500/40" : isStale ? "border-orange-500/30" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-1.5 flex-1 min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
          <p className="text-sm font-semibold leading-tight">{deal.title}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <DealScoreBadge score={score} />
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onViewActivity} title="Ver actividad" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary">
              <Activity className="w-3 h-3" />
            </button>
            <button onClick={onEdit} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <Edit2 className="w-3 h-3" />
            </button>
            <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {deal.customer_name && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate">{deal.customer_name}</span>
        </div>
      )}

      {deal.value_ars > 0 && (
        <div className="flex items-center gap-1 text-xs font-mono font-semibold text-primary mb-1.5">
          <DollarSign className="w-3 h-3 shrink-0" />
          {formatARS(deal.value_ars)}
        </div>
      )}

      {deal.expected_close && (
        <div className={`flex items-center gap-1 text-xs mb-2 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
          <Calendar className="w-3 h-3 shrink-0" />
          {new Date(deal.expected_close + "T12:00:00").toLocaleDateString("es-AR")}
          {isOverdue && <span className="text-[10px] font-medium">(vencido)</span>}
        </div>
      )}

      {isStale && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex items-center gap-1 text-[10px] text-orange-400 bg-orange-500/10 rounded px-2 py-0.5 w-fit">
            <Calendar className="w-3 h-3" />Sin actividad: {daysSinceUpdate}d
          </div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Hola${deal.customer_name ? ` ${deal.customer_name}` : ''}, te escribo para hacer un seguimiento sobre "${deal.title}". ¿Cómo estamos con esto?`)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Enviar seguimiento por WhatsApp"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 rounded px-2 py-0.5 hover:bg-green-500/20 transition-colors"
          >
            <MessageCircle className="w-3 h-3" />Seguimiento
          </a>
        </div>
      )}

      {deal.notes && (
        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2 bg-muted/40 rounded px-2 py-1">
          {deal.notes}
        </p>
      )}

      {/* Quick move to next stage */}
      <div className="flex gap-1 flex-wrap">
        {stages
          .filter(s => s.value !== deal.stage)
          .slice(0, 3)
          .map(s => (
            <button
              key={s.value}
              onClick={() => onMove(s.value)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all hover:opacity-80 ${s.bg} ${s.color} border-current/20`}
            >
              → {s.label}
            </button>
          ))}
      </div>
    </div>
  );
}

// ─── Tab content ──────────────────────────────────────────────────────────────

export default function PipelineKanbanTab() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStalePanel, setShowStalePanel] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; deal?: Deal; prefillStage?: Stage }>({ open: false });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [activityDeal, setActivityDeal] = useState<Deal | null>(null);
  const [winLossDialog, setWinLossDialog] = useState<{ deal: Deal; stage: "cerrado" | "perdido" } | null>(null);
  const [winLossReason, setWinLossReason] = useState("");
  const [winLossNote, setWinLossNote] = useState("");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deals")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDeals((data || []) as Deal[]);
    } catch (e: any) {
      toast.error(e.message || "Error al cargar oportunidades");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  const handleSave = async (data: any) => {
    if (!activeOrg || !user) return;
    if (dialog.deal?.id) {
      const { error } = await supabase
        .from("deals")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", dialog.deal.id);
      if (error) throw error;
      toast.success("Oportunidad actualizada");
    } else {
      const { error } = await supabase
        .from("deals")
        .insert({ ...data, org_id: activeOrg.id, user_id: user.id, stage: dialog.prefillStage ?? data.stage });
      if (error) throw error;
      toast.success("Oportunidad creada");
    }
    await load();
  };

  const handleMove = async (deal: Deal, stage: Stage) => {
    // Intercept final stages to capture Win/Loss reason
    if ((stage === "cerrado" || stage === "perdido") && deal.stage !== stage) {
      setWinLossReason("");
      setWinLossNote("");
      setWinLossDialog({ deal, stage });
      return;
    }
    await commitMove(deal, stage, null);
  };

  // Auto-create a draft quote from a won deal. Best-effort: silently no-ops on failure.
  // Returns the new quote_id (or null) so the caller can offer to navigate to it.
  const autoCreateQuoteFromDeal = async (deal: Deal): Promise<string | null> => {
    if (!activeOrg || !user) return null;
    try {
      // 1. Check if a quote was already created for this deal in the last 24h
      // (deals table doesn't link to quotes; we use the title as a soft idempotency key)
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const { count: dupCount } = await supabase
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("org_id", activeOrg.id)
        .eq("customer_name", deal.customer_name || "")
        .gte("created_at", yesterday);
      if ((dupCount ?? 0) > 0) return null;  // already exists, avoid duplicates

      // 2. Generate next quote_number via RPC
      const { data: numData } = await supabase.rpc("next_quote_number", { p_org_id: activeOrg.id });
      const quoteNumber = (numData as string | null) || `Q-${Date.now()}`;

      // 3. Look up customer for email/phone
      let customerEmail: string | null = null;
      let customerPhone: string | null = null;
      if (deal.customer_name) {
        const { data: customer } = await supabase
          .from("customers")
          .select("email, phone")
          .eq("org_id", activeOrg.id)
          .ilike("name", deal.customer_name)
          .maybeSingle();
        customerEmail = customer?.email ?? null;
        customerPhone = customer?.phone ?? null;
      }

      // 4. Build a single line-item quote from the deal title + value
      const total = deal.value_ars || 0;
      const item = {
        description: deal.title,
        qty: 1,
        unit_price: total,
        total,
      };

      // 5. Create the quote in "accepted" status (deal is already won)
      const { data: inserted, error } = await supabase
        .from("quotes")
        .insert({
          org_id: activeOrg.id,
          quote_number: quoteNumber,
          customer_name: deal.customer_name || "Sin nombre",
          customer_email: customerEmail,
          customer_phone: customerPhone,
          items: [item],
          subtotal: total,
          discount_amount: 0,
          total,
          status: "accepted",
          valid_until: null,
          notes: `Generado automáticamente al cerrar el deal "${deal.title}" como ganado.`,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      return (inserted?.id as string | null) ?? null;
    } catch (e) {
      console.error("autoCreateQuoteFromDeal failed:", e);
      return null;
    }
  };

  // Auto-enroll a deal's customer into all active drip sequences with the given trigger
  // Looks up email by customer name. Silently no-ops if customer/email/sequence missing.
  const autoEnrollInDrip = async (deal: Deal, trigger: "deal_lost" | "post_purchase" | "welcome") => {
    if (!activeOrg) return;
    try {
      // 1. Find customer email by name (best-effort match)
      const { data: customer } = await supabase
        .from("customers")
        .select("id, email, name")
        .eq("org_id", activeOrg.id)
        .ilike("name", deal.customer_name)
        .maybeSingle();
      if (!customer?.email) return; // no email → can't drip

      // 2. Find active sequences matching trigger
      const { data: sequences } = await supabase
        .from("drip_sequences")
        .select("id")
        .eq("org_id", activeOrg.id)
        .eq("trigger_event", trigger)
        .eq("active", true);
      if (!sequences || sequences.length === 0) return;

      // 3. For each sequence, count steps to set total_steps + next_send_at
      for (const seq of sequences) {
        const { count: stepCount } = await supabase
          .from("drip_sequence_steps")
          .select("id", { count: "exact", head: true })
          .eq("sequence_id", seq.id);

        const { data: firstStep } = await supabase
          .from("drip_sequence_steps")
          .select("day_offset")
          .eq("sequence_id", seq.id)
          .order("step_order", { ascending: true })
          .limit(1)
          .maybeSingle();

        const nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + (firstStep?.day_offset ?? 1));

        // Insert ignoring conflicts (unique sequence_id, customer_email)
        await supabase.from("drip_enrollments").insert({
          sequence_id:    seq.id,
          org_id:         activeOrg.id,
          customer_email: customer.email,
          customer_name:  customer.name ?? deal.customer_name,
          customer_id:    customer.id,
          current_step:   0,
          total_steps:    stepCount ?? 1,
          status:         "active",
          next_send_at:   nextSendAt.toISOString(),
        });
      }
    } catch {
      // Silent — drip enrollment is best-effort, don't block deal close
    }
  };

  const commitMove = async (deal: Deal, stage: Stage, reason: string | null) => {
    try {
      const closedAt = new Date().toISOString();
      await supabase.from("deals").update({
        stage,
        win_loss_reason: reason || null,
        updated_at: closedAt,
      }).eq("id", deal.id);
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stage, win_loss_reason: reason } : d));
      const stageLabel = STAGES.find(s => s.value === stage)?.label ?? stage;
      void fireStageAutomations(deal, stageLabel);

      // ── Persist outcome for Win/Loss analytics ─────────────────────────────
      if ((stage === "cerrado" || stage === "perdido") && activeOrg) {
        const daysInPipeline = Math.floor(
          (Date.now() - new Date(deal.created_at).getTime()) / 86_400_000,
        );
        await supabase.from("deal_outcomes").insert({
          org_id:           activeOrg.id,
          deal_id:          deal.id,
          deal_title:       deal.title,
          outcome:          stage === "cerrado" ? "won" : "lost",
          reason:           reason ?? null,
          deal_value:       deal.value_ars || 0,
          currency:         "ARS",
          customer_name:    deal.customer_name || null,
          stage_at_close:   deal.stage,
          days_in_pipeline: daysInPipeline,
          closed_at:        closedAt,
        });

        // ── Auto-enroll lost-deal customers in re-engagement drip ──────────
        if (stage === "perdido" && deal.customer_name) {
          await autoEnrollInDrip(deal, "deal_lost");
        }
        // ── Auto-enroll won-deal customers in post-purchase drip ───────────
        if (stage === "cerrado" && deal.customer_name) {
          await autoEnrollInDrip(deal, "post_purchase");
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      if (stage === "cerrado") {
        toast.success(`🏆 Deal "${deal.title}" marcado como ganado!`);
        // Auto-create quote (fire-and-forget — user gets a follow-up toast if successful)
        autoCreateQuoteFromDeal(deal).then(quoteId => {
          if (quoteId) {
            toast.success("📄 Presupuesto creado automáticamente", {
              action: { label: "Ver", onClick: () => window.location.href = "/presupuestos" },
              duration: 6000,
            });
          }
        });
      }
      if (stage === "perdido") toast.info(`Deal "${deal.title}" marcado como perdido.`);
    } catch {
      toast.error("Error al mover");
    }
  };

  const fireStageAutomations = async (deal: Deal, stageLabel: string) => {
    if (!activeOrg) return;
    try {
      const { data: flows } = await supabase
        .from("automation_flows")
        .select("id, action_type, action_config, trigger_config")
        .eq("org_id", activeOrg.id)
        .eq("active", true)
        .eq("trigger_type", "deal_stage_change");
      if (!flows || flows.length === 0) return;

      // Filter client-side by stage label match
      const matching = flows.filter(f => {
        const cfg = (f.trigger_config ?? {}) as Record<string, unknown>;
        return String(cfg.stage ?? "") === stageLabel;
      });
      if (matching.length === 0) return;

      let fired = 0;
      for (const flow of matching) {
        const actionCfg = (flow.action_config ?? {}) as Record<string, string>;
        if (flow.action_type === "create_task") {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + Number(actionCfg.task_due_days ?? 1));
          await supabase.from("tasks").insert({
            org_id: activeOrg.id,
            title: actionCfg.message
              ? `${actionCfg.message} — ${deal.title}`
              : `Seguimiento: deal "${deal.title}" en ${stageLabel}`,
            priority: actionCfg.task_priority ?? "medium",
            due_date: dueDate.toISOString().slice(0, 10),
            status: "pending",
          });
          fired++;
        } else if (flow.action_type === "notification") {
          // Show a toast as in-app notification (no notifications table required)
          toast.info(actionCfg.message || `🎯 Deal "${deal.title}" movido a ${stageLabel}`);
          fired++;
        }
      }
      if (fired > 0) {
        toast.success(`⚡ ${fired} automatización${fired > 1 ? "es" : ""} ejecutada${fired > 1 ? "s" : ""}`);
      }
    } catch {
      // Silent fail — don't disrupt the stage move UX
    }
  };

  const handleDelete = async (deal: Deal) => {
    if (!(await ask({
      title: `¿Eliminar "${deal.title}"?`,
      confirmText: "Eliminar",
    }))) return;
    try {
      await supabase.from("deals").delete().eq("id", deal.id);
      setDeals(prev => prev.filter(d => d.id !== deal.id));
    } catch {
      toast.error("Error al eliminar");
    }
  };

  // Pipeline stats
  const stats = useMemo(() => {
    const pipeline = deals.filter(d => d.stage !== "perdido");
    const won = deals.filter(d => d.stage === "cerrado");
    const total = deals.filter(d => d.stage !== "perdido" && d.stage !== "cerrado");
    const winRate = deals.length > 0 ? (won.length / deals.length) * 100 : 0;
    const weightedValue = pipeline.reduce((s, d) => {
      const prob = STAGES.find(st => st.value === d.stage)?.probability ?? 0;
      return s + (d.value_ars || 0) * (prob / 100);
    }, 0);
    return {
      pipelineValue: pipeline.reduce((s, d) => s + (d.value_ars || 0), 0),
      wonValue: won.reduce((s, d) => s + (d.value_ars || 0), 0),
      openCount: total.length,
      winRate,
      weightedValue,
    };
  }, [deals]);

  const dealsByStage = useMemo(() => {
    const map = {} as Record<Stage, Deal[]>;
    STAGES.forEach(s => { map[s.value] = []; });
    deals.forEach(d => { map[d.stage]?.push(d); });
    return map;
  }, [deals]);

  const staleDeals = useMemo(() => deals.filter(d => {
    if (d.stage === "cerrado" || d.stage === "perdido") return false;
    const days = Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86400000);
    return days >= 14;
  }), [deals]);

  // Analytics: conversion funnel + velocity
  const analyticsData = useMemo(() => {
    const now = Date.now();

    // Count per stage (all deals)
    const countByStage: Record<string, number> = {};
    const valueByStage: Record<string, number> = {};
    const ageByStage: Record<string, number[]> = {};
    STAGES.forEach(s => { countByStage[s.value] = 0; valueByStage[s.value] = 0; ageByStage[s.value] = []; });
    deals.forEach(d => {
      countByStage[d.stage] = (countByStage[d.stage] || 0) + 1;
      valueByStage[d.stage] = (valueByStage[d.stage] || 0) + (d.value_ars || 0);
      const ageDays = Math.floor((now - new Date(d.created_at).getTime()) / 86400000);
      ageByStage[d.stage].push(ageDays);
    });

    const won = deals.filter(d => d.stage === "cerrado");
    const lost = deals.filter(d => d.stage === "perdido");
    const open = deals.filter(d => d.stage !== "cerrado" && d.stage !== "perdido");

    // Conversion funnel: ratio of deals that reached each stage vs total entered pipeline
    const totalEntered = deals.length;
    const funnel = STAGES.filter(s => s.value !== "perdido").map(s => {
      const count = countByStage[s.value] || 0;
      const pct = totalEntered > 0 ? Math.round((count / totalEntered) * 100) : 0;
      const avgAge = ageByStage[s.value].length > 0
        ? Math.round(ageByStage[s.value].reduce((a, b) => a + b, 0) / ageByStage[s.value].length)
        : 0;
      const avgValue = count > 0 ? Math.round(valueByStage[s.value] / count) : 0;
      return { stage: s, count, pct, avgAge, avgValue };
    });

    // Avg deal velocity: days from lead creation to cerrado
    const velocities = won
      .map(d => Math.floor((now - new Date(d.created_at).getTime()) / 86400000))
      .filter(v => v >= 0);
    const avgVelocity = velocities.length > 0
      ? Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length)
      : null;

    // Win/Loss reason breakdown
    const lossReasonMap: Record<string, number> = {};
    lost.forEach(d => {
      const r = d.win_loss_reason || "Sin registrar";
      lossReasonMap[r] = (lossReasonMap[r] || 0) + 1;
    });
    const winRate = (won.length + lost.length) > 0
      ? Math.round((won.length / (won.length + lost.length)) * 100)
      : 0;

    return {
      funnel,
      won: won.length,
      lost: lost.length,
      open: open.length,
      avgVelocity,
      totalValue: deals.reduce((s, d) => s + (d.value_ars || 0), 0),
      wonValue: won.reduce((s, d) => s + (d.value_ars || 0), 0),
      lostValue: lost.reduce((s, d) => s + (d.value_ars || 0), 0),
      lossReasonMap,
      winRate,
    };
  }, [deals]);

  // Pipeline forecast: group open deals by expected_close month, weighted by stage probability
  const [showForecast, setShowForecast] = useState(false);
  const forecastData = useMemo(() => {
    const openDeals = deals.filter(d => d.stage !== "perdido" && d.expected_close);
    const monthMap: Record<string, { raw: number; weighted: number; count: number }> = {};
    openDeals.forEach(d => {
      const m = d.expected_close!.slice(0, 7); // YYYY-MM
      const prob = (STAGES.find(s => s.value === d.stage)?.probability ?? 0) / 100;
      if (!monthMap[m]) monthMap[m] = { raw: 0, weighted: 0, count: 0 };
      monthMap[m].raw += d.value_ars || 0;
      monthMap[m].weighted += (d.value_ars || 0) * prob;
      monthMap[m].count++;
    });
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 6)
      .map(([month, vals]) => ({
        month: new Date(month + "-01T12:00:00").toLocaleDateString("es-AR", { month: "short", year: "2-digit" }),
        bruto: Math.round(vals.raw),
        ponderado: Math.round(vals.weighted),
        count: vals.count,
      }));
  }, [deals]);

  return (
    <div className={`space-y-5 transition-all duration-300 ${activityDeal ? "sm:mr-[420px]" : ""}`}>
      {/* Activity Panel overlay */}
      {activityDeal && activeOrg && user && (
        <ActivityPanel
          deal={activityDeal}
          orgId={activeOrg.id}
          userId={user.id}
          onClose={() => setActivityDeal(null)}
          onStageChange={async (deal, stage) => {
            await handleMove(deal, stage);
            // Update local activityDeal so panel reflects new stage
            setActivityDeal(prev => prev ? { ...prev, stage } : null);
          }}
        />
      )}

      {/* Dialog */}
      <DealDialog
        open={dialog.open}
        initial={dialog.deal ? { ...dialog.deal } : dialog.prefillStage ? { stage: dialog.prefillStage } : undefined}
        onClose={() => setDialog({ open: false })}
        onSave={handleSave}
      />

      {/* Actions row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {stats.openCount > 0 ? `${stats.openCount} oportunidades abiertas` : "Seguimiento de oportunidades comerciales"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            const header = "Título,Cliente,Etapa,Valor ARS,Cierre esperado,Notas,Creada\n";
            const rows = deals.map(d => [
              d.title, d.customer_name,
              STAGES.find(s => s.value === d.stage)?.label || d.stage,
              d.value_ars || 0,
              d.expected_close || '',
              d.notes || '',
              d.created_at.slice(0, 10),
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
            const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8;" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pipeline.csv"; a.click();
          }}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button onClick={() => setDialog({ open: true })} className="gradient-gold text-primary-foreground gap-1.5">
            <Plus className="w-4 h-4" />Nueva oportunidad
          </Button>
        </div>
      </div>

      {/* Stale deals alert */}
      {staleDeals.length > 0 && (
        <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-orange-400">{staleDeals.length} deal{staleDeals.length !== 1 ? "s" : ""} sin actividad +14 días</span>
          <button
            onClick={() => setShowStalePanel(v => !v)}
            className="text-xs text-orange-400 hover:text-orange-300 underline ml-auto"
          >
            {showStalePanel ? "Ocultar" : "Ver deals →"}
          </button>
        </div>
      )}
      {showStalePanel && staleDeals.length > 0 && (
        <div className="bg-card border border-orange-500/20 rounded-xl p-4 space-y-2">
          {staleDeals.map(d => {
            const days = Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86400000);
            const stageLabel = STAGES.find(s => s.value === d.stage)?.label || d.stage;
            return (
              <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-[10px] text-muted-foreground">{d.customer_name || ""} · {stageLabel}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-orange-400 font-semibold">{days}d sin cambios</span>
                  {d.value_ars && <span className="text-xs text-muted-foreground">{formatARS(d.value_ars)}</span>}
                  <button
                    onClick={() => setDialog({ open: true, deal: d })}
                    className="text-[10px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    Actualizar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Pipeline total" value={formatARS(stats.pipelineValue)} icon={DollarSign} color="primary" sub="valor bruto" />
        <KPICard label="Pipeline ponderado" value={formatARS(stats.weightedValue)} icon={TrendingUp} color="warning" sub="ajustado por probabilidad" />
        <KPICard label="Cerradas ganadas" value={formatARS(stats.wonValue)} icon={Calendar} color="success" sub={`${stats.openCount} abiertas`} />
        <KPICard label="Tasa de cierre" value={`${stats.winRate.toFixed(0)}%`} icon={User}
          color={stats.winRate >= 50 ? "success" : stats.winRate >= 25 ? "warning" : "destructive"} />
      </div>

      {/* Pipeline Analytics Panel */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Analíticas del Pipeline</h3>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">
            {deals.length} deals totales
          </span>
        </div>

        {/* Win / Loss / Open summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold font-display text-emerald-400">{analyticsData.won}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Ganados</p>
            <p className="text-xs text-emerald-400 font-semibold mt-1">{formatARS(analyticsData.wonValue)}</p>
          </div>
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold font-display text-primary">{analyticsData.open}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">En progreso</p>
            {analyticsData.avgVelocity !== null && (
              <p className="text-xs text-muted-foreground mt-1">~{analyticsData.avgVelocity}d ciclo</p>
            )}
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold font-display text-red-400">{analyticsData.lost}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Perdidos</p>
            <p className="text-xs text-red-400 font-semibold mt-1">{formatARS(analyticsData.lostValue)}</p>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Embudo de conversión</p>
          <div className="space-y-2">
            {analyticsData.funnel.map((item, idx) => {
              const maxCount = analyticsData.funnel[0]?.count || 1;
              const widthPct = maxCount > 0 ? Math.round((item.count / maxCount) * 100) : 0;
              return (
                <div key={item.stage.value} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-28 shrink-0 ${item.stage.color}`}>{item.stage.label}</span>
                  <div className="flex-1 h-7 bg-muted/30 rounded-lg overflow-hidden relative">
                    <div
                      className="h-full rounded-lg transition-all duration-500"
                      style={{
                        width: `${widthPct}%`,
                        background: item.stage.value === "cerrado"
                          ? "hsl(var(--emerald-500, 160 60% 45%))"
                          : "hsl(var(--primary))",
                        opacity: 0.6 + (idx * 0.08),
                      }}
                    />
                    <span className="absolute inset-0 flex items-center px-3 text-xs font-semibold">
                      {item.count} deal{item.count !== 1 ? "s" : ""} · {widthPct}%
                      {item.avgValue > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">
                          · avg {formatARS(item.avgValue)}
                        </span>
                      )}
                    </span>
                  </div>
                  {item.avgAge > 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
                      ~{item.avgAge}d avg
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Deal velocity insight */}
        {analyticsData.avgVelocity !== null && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center gap-3">
            <Clock className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">Velocidad promedio de cierre: <span className="text-primary">{analyticsData.avgVelocity} días</span></p>
              <p className="text-xs text-muted-foreground">
                Tiempo promedio desde la creación del deal hasta el cierre en los {analyticsData.won} deals ganados.
              </p>
            </div>
          </div>
        )}

        {/* Stage value bar chart */}
        {analyticsData.funnel.some(f => f.avgValue > 0) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Valor promedio por etapa</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={analyticsData.funnel.filter(f => f.avgValue > 0)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey={d => d.stage.label} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [formatARS(v), "Valor promedio"]}
                />
                <Bar dataKey="avgValue" radius={[4, 4, 0, 0]}>
                  {analyticsData.funnel.filter(f => f.avgValue > 0).map((entry, idx) => (
                    <Cell key={entry.stage.value} fill={idx === analyticsData.funnel.filter(f => f.avgValue > 0).length - 1
                      ? "hsl(var(--chart-2))" : "hsl(var(--primary))"} opacity={0.7 + idx * 0.05} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Win/Loss Rate & Reason Breakdown */}
        {(analyticsData.won + analyticsData.lost) > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Win Rate & Razones</p>
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 shrink-0">
                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="hsl(var(--muted))" strokeWidth="3.5" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="hsl(160 60% 45%)" strokeWidth="3.5"
                    strokeDasharray={`${analyticsData.winRate} ${100 - analyticsData.winRate}`} strokeLinecap="round" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-emerald-400">
                  {analyticsData.winRate}%
                </span>
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-xs font-semibold">Win rate: <span className="text-emerald-400">{analyticsData.winRate}%</span></p>
                <p className="text-[10px] text-muted-foreground">{analyticsData.won} ganados · {analyticsData.lost} perdidos</p>
                {Object.keys(analyticsData.lossReasonMap).length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-[10px] text-red-400 font-medium">Top razones de pérdida:</p>
                    {Object.entries(analyticsData.lossReasonMap)
                      .sort(([, a], [, b]) => b - a).slice(0, 4).map(([reason, count]) => (
                      <div key={reason} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground flex-1 truncate">{reason}</span>
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-red-400/60 rounded-full"
                            style={{ width: `${Math.round((count / analyticsData.lost) * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-4 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Revenue Forecast Chart */}
      {forecastData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Proyección de cierre por mes
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded font-normal">
                Basado en expected_close de deals abiertos
              </span>
            </h3>
            <button
              onClick={() => setShowForecast(v => !v)}
              className="text-xs text-primary hover:underline"
            >
              {showForecast ? "Ocultar" : "Ver gráfico →"}
            </button>
          </div>
          {showForecast && (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={forecastData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(val: any, name: string) => [formatARS(Number(val)), name === "bruto" ? "Valor bruto" : "Valor ponderado"]}
                  />
                  <Bar dataKey="bruto" fill="hsl(var(--primary))" opacity={0.3} radius={[3, 3, 0, 0]} name="bruto" />
                  <Bar dataKey="ponderado" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="ponderado" />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-primary/30 inline-block" />Valor bruto</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-primary inline-block" />Ponderado por probabilidad de etapa</span>
              </div>
            </>
          )}
          {!showForecast && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {forecastData.map(d => (
                <div key={d.month} className="shrink-0 text-center">
                  <p className="text-[10px] text-muted-foreground">{d.month}</p>
                  <p className="text-xs font-mono font-semibold text-primary">{formatARS(d.ponderado)}</p>
                  <p className="text-[9px] text-muted-foreground/60">{d.count} deal{d.count !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />Cargando...
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {STAGES.map(stage => {
              const stageDeals = dealsByStage[stage.value] || [];
              const stageTotal = stageDeals.reduce((s, d) => s + (d.value_ars || 0), 0);
              return (
                <div
                  key={stage.value}
                  className={`w-64 flex flex-col gap-2 transition-all rounded-xl ${dragOverStage === stage.value ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverStage(stage.value); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverStage(null);
                    if (draggedId) {
                      const deal = deals.find(d => d.id === draggedId);
                      if (deal && deal.stage !== stage.value) handleMove(deal, stage.value);
                    }
                    setDraggedId(null);
                  }}
                >
                  {/* Column header */}
                  <div className={`rounded-xl px-3 py-2.5 ${stage.bg}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-bold uppercase tracking-wide ${stage.color}`}>
                        {stage.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {stage.probability > 0 && stage.probability < 100 && (
                          <span className="text-[10px] text-muted-foreground">{stage.probability}%</span>
                        )}
                        <span className="text-xs bg-card border border-border/60 rounded-full px-1.5 py-0.5 text-muted-foreground font-medium">
                          {stageDeals.length}
                        </span>
                      </div>
                    </div>
                    {stageTotal > 0 && (
                      <div className={`text-xs font-mono font-semibold ${stage.color}`}>
                        {formatARS(stageTotal)}
                      </div>
                    )}
                  </div>

                  {/* Add button */}
                  <button
                    onClick={() => setDialog({ open: true, prefillStage: stage.value })}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors border border-dashed border-border hover:border-primary/30"
                  >
                    <Plus className="w-3 h-3" />Agregar
                  </button>

                  {/* Cards */}
                  <div className="flex flex-col gap-2">
                    {stageDeals.map(deal => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        stages={STAGES}
                        onEdit={() => setDialog({ open: true, deal })}
                        onDelete={() => handleDelete(deal)}
                        onMove={newStage => handleMove(deal, newStage)}
                        onDragStart={id => setDraggedId(id)}
                        onViewActivity={() => setActivityDeal(deal)}
                      />
                    ))}
                    {stageDeals.length === 0 && (
                      <div className="text-center py-6 text-[11px] text-muted-foreground/50">
                        Sin oportunidades
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Win/Loss reason dialog */}
      {winLossDialog && (
        <Dialog open onOpenChange={() => setWinLossDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className={winLossDialog.stage === "cerrado" ? "text-emerald-400" : "text-red-400"}>
                {winLossDialog.stage === "cerrado" ? "🏆 Deal ganado — ¿por qué?" : "💡 Deal perdido — ¿por qué?"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Registrar la razón ayuda a mejorar el proceso de ventas. Podés omitirlo.
              </p>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Razón principal</Label>
                <Select value={winLossReason} onValueChange={setWinLossReason}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar razón (opcional)" /></SelectTrigger>
                  <SelectContent>
                    {(winLossDialog.stage === "cerrado" ? WIN_REASONS : LOSS_REASONS).map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Notas adicionales (opcional)</Label>
                <Textarea
                  placeholder="Contexto adicional..."
                  value={winLossNote}
                  onChange={e => setWinLossNote(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => {
                commitMove(winLossDialog.deal, winLossDialog.stage, null);
                setWinLossDialog(null);
              }}>
                Omitir
              </Button>
              <Button
                className={winLossDialog.stage === "cerrado" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
                onClick={() => {
                  const reason = winLossReason || (winLossNote.trim() ? winLossNote.trim() : null);
                  commitMove(winLossDialog.deal, winLossDialog.stage, reason);
                  setWinLossDialog(null);
                }}
              >
                {winLossDialog.stage === "cerrado" ? "Marcar como ganado" : "Marcar como perdido"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {confirmDialog}
    </div>
  );
}
