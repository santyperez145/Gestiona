/**
 * NPSSurveysPage — Net Promoter Score & Customer Satisfaction Surveys
 *
 * Salesforce Surveys equivalent for pymes.
 * - Create NPS or CSAT surveys
 * - Send via email or WhatsApp link
 * - Collect responses (0-10 for NPS, 1-5 for CSAT)
 * - Compute NPS score: % promoters - % detractors
 * - View response breakdown and customer feedback
 * - Segment responses by score category
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useClipboard } from "@/hooks/useClipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Star, Plus, X, Loader2, Trash2, Edit2, Copy, Send, BarChart3,
  TrendingUp, TrendingDown, MessageSquare, ChevronDown, ChevronUp,
  ThumbsUp, ThumbsDown, Minus, Users, Link2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type SurveyType = "nps" | "csat";

interface Survey {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  type: SurveyType;
  question: string;
  follow_up_question: string | null;
  active: boolean;
  response_count: number;
  created_at: string;
}

interface SurveyResponse {
  id: string;
  survey_id: string;
  respondent_name: string | null;
  respondent_email: string | null;
  score: number;
  feedback: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function computeNPS(responses: SurveyResponse[]): number | null {
  if (responses.length === 0) return null;
  const promoters = responses.filter(r => r.score >= 9).length;
  const detractors = responses.filter(r => r.score <= 6).length;
  return Math.round(((promoters - detractors) / responses.length) * 100);
}

function npsCategory(score: number): { label: string; color: string } {
  if (score >= 50) return { label: "Excelente", color: "text-emerald-400" };
  if (score >= 0) return { label: "Bueno", color: "text-green-400" };
  if (score >= -10) return { label: "Mejorable", color: "text-yellow-400" };
  return { label: "Crítico", color: "text-red-400" };
}

function npsLabel(score: number): { label: string; color: string } {
  if (score >= 9) return { label: "Promotor", color: "text-emerald-400" };
  if (score >= 7) return { label: "Pasivo", color: "text-yellow-400" };
  return { label: "Detractor", color: "text-red-400" };
}

function csatLabel(score: number): { label: string; color: string } {
  if (score >= 5) return { label: "Muy satisfecho", color: "text-emerald-400" };
  if (score >= 4) return { label: "Satisfecho", color: "text-green-400" };
  if (score >= 3) return { label: "Neutro", color: "text-yellow-400" };
  if (score >= 2) return { label: "Insatisfecho", color: "text-orange-400" };
  return { label: "Muy insatisfecho", color: "text-red-400" };
}

const EMPTY_FORM = {
  title: "",
  type: "nps" as SurveyType,
  description: "",
  question: "¿Qué tan probable es que recomiendes {negocio} a un amigo o colega?",
  follow_up_question: "¿Qué podemos mejorar?",
};

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function NPSSurveysPage() {
  usePageTitle("Encuestas NPS");

  const { activeOrg, activeRole } = useOrg();
  const { copy } = useClipboard();

  const [surveys, setSurveys]       = useState<Survey[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [responses, setResponses]   = useState<Record<string, SurveyResponse[]>>({});
  const [loadingRes, setLoadingRes] = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });

  const canManage = activeRole === "owner" || activeRole === "admin";

  const loadSurveys = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("nps_surveys")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setSurveys((data || []) as Survey[]);
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { loadSurveys(); }, [loadSurveys]);

  useEffect(() => {
    if (!expanded || responses[expanded]) return;
    setLoadingRes(true);
    supabase.from("nps_responses").select("*").eq("survey_id", expanded)
      .order("created_at", { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!error) setResponses(prev => ({ ...prev, [expanded]: (data || []) as SurveyResponse[] }));
        setLoadingRes(false);
      });
  }, [expanded]);

  const handleSave = async () => {
    if (!form.title.trim() || !activeOrg?.id) return;
    setSaving(true);
    try {
      await supabase.from("nps_surveys").insert({
        org_id: activeOrg.id,
        title: form.title.trim(),
        type: form.type,
        description: form.description.trim() || null,
        question: form.question.trim(),
        follow_up_question: form.follow_up_question?.trim() || null,
        active: true,
        response_count: 0,
      });
      toast.success("Encuesta creada");
      setShowForm(false); setForm({ ...EMPTY_FORM }); loadSurveys();
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const deleteSurvey = async (id: string) => {
    if (!confirm("¿Eliminar esta encuesta y todas sus respuestas?")) return;
    try {
      await supabase.from("nps_surveys").delete().eq("id", id);
      setSurveys(prev => prev.filter(s => s.id !== id));
      toast.success("Encuesta eliminada");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  const toggleActive = async (survey: Survey) => {
    await supabase.from("nps_surveys").update({ active: !survey.active }).eq("id", survey.id);
    setSurveys(prev => prev.map(s => s.id === survey.id ? { ...s, active: !s.active } : s));
  };

  const getSurveyLink = (id: string): string => {
    const base = window.location.origin;
    return `${base}/encuesta/${id}`;
  };

  // Global stats
  const allResponses = Object.values(responses).flat();
  const globalNPS = computeNPS(allResponses.filter(r => {
    const s = surveys.find(sv => sv.id === r.survey_id);
    return s?.type === "nps";
  }));

  const stats = {
    surveys: surveys.length,
    active: surveys.filter(s => s.active).length,
    responses: allResponses.length,
    nps: globalNPS,
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Star}
        title="Encuestas NPS & CSAT"
        description="Medí la satisfacción y lealtad de tus clientes"
        badge={globalNPS !== null ? {
          label: `NPS global: ${globalNPS > 0 ? "+" : ""}${globalNPS}`,
          variant: globalNPS >= 50 ? "success" : globalNPS >= 0 ? "secondary" : "destructive"
        } : undefined}
        actions={
          canManage ? (
            <Button onClick={() => setShowForm(!showForm)} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nueva encuesta
            </Button>
          ) : undefined
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Encuestas" value={stats.surveys} icon={Star} />
        <KPICard label="Activas" value={stats.active} icon={TrendingUp} color="success" />
        <KPICard label="Respuestas" value={stats.responses} icon={MessageSquare} color="blue" />
        <KPICard label="NPS Global" value={stats.nps !== null ? `${stats.nps > 0 ? "+" : ""}${stats.nps}` : "—"} icon={BarChart3} color={stats.nps !== null && stats.nps >= 0 ? "warning" : "destructive"} />
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Star className="w-4 h-4 text-primary" />Nueva encuesta
            </h3>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowForm(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nombre *</Label>
              <Input placeholder="Ej: NPS Post-compra Mayo" value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Tipo</Label>
              <Select value={form.type} onValueChange={v => {
                const q = v === "nps"
                  ? "¿Qué tan probable es que recomiendes {negocio} a un amigo o colega?"
                  : "¿Qué tan satisfecho/a estás con tu experiencia?";
                setForm(p => ({ ...p, type: v as SurveyType, question: q }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nps">NPS (0–10) — Recomendación</SelectItem>
                  <SelectItem value="csat">CSAT (1–5) — Satisfacción</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Pregunta principal</Label>
              <Input value={form.question} onChange={e => setForm(p => ({ ...p, question: e.target.value }))} />
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Usá {"{negocio}"} para insertar el nombre del negocio</p>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Pregunta de seguimiento (opcional)</Label>
              <Input placeholder="¿Qué podemos mejorar?" value={form.follow_up_question || ""}
                onChange={e => setForm(p => ({ ...p, follow_up_question: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Crear encuesta
            </Button>
          </div>
        </div>
      )}

      {/* Survey list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : surveys.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Star className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sin encuestas. Creá tu primera encuesta NPS o CSAT.</p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {surveys.map(survey => {
            const isOpen = expanded === survey.id;
            const surveyResponses = responses[survey.id] || [];
            const nps = survey.type === "nps" ? computeNPS(surveyResponses) : null;
            const avgCsat = survey.type === "csat" && surveyResponses.length > 0
              ? Math.round(surveyResponses.reduce((s, r) => s + r.score, 0) / surveyResponses.length * 10) / 10
              : null;
            const promoters = surveyResponses.filter(r => r.score >= 9).length;
            const passives = surveyResponses.filter(r => r.score >= 7 && r.score <= 8).length;
            const detractors = surveyResponses.filter(r => r.score <= 6).length;
            const surveyLink = getSurveyLink(survey.id);

            return (
              <div key={survey.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-start gap-3 p-4">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${survey.active ? "bg-green-400 animate-pulse" : "bg-muted-foreground/40"}`} />
                  <button className="flex-1 text-left min-w-0" onClick={() => setExpanded(isOpen ? null : survey.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{survey.title}</span>
                      <span className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {survey.type === "nps" ? "NPS 0–10" : "CSAT 1–5"}
                      </span>
                      {nps !== null && (
                        <span className={`text-[10px] font-bold ${npsCategory(nps).color}`}>
                          NPS {nps > 0 ? "+" : ""}{nps}
                        </span>
                      )}
                      {avgCsat !== null && (
                        <span className="text-[10px] font-bold text-yellow-400">
                          ★ {avgCsat}/5
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {survey.response_count} respuesta{survey.response_count !== 1 ? "s" : ""}
                      {surveyResponses.length > 0 && ` · ${surveyResponses.length} cargadas`}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => copy(surveyLink, `Link encuesta "${survey.title}"`)}>
                      <Link2 className="w-3 h-3 mr-1" />Link
                    </Button>
                    {canManage && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                          onClick={() => deleteSurvey(survey.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => setExpanded(isOpen ? null : survey.id)}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
                    <div className="flex flex-wrap gap-3 items-start">
                      <div className="flex-1 min-w-[180px] p-3 rounded-lg bg-muted/30 border border-border">
                        <p className="text-[10px] text-muted-foreground mb-1">Pregunta</p>
                        <p className="text-sm">{survey.question}</p>
                        {survey.follow_up_question && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{survey.follow_up_question}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <p className="text-[10px] text-muted-foreground mb-1">Link de encuesta</p>
                        <div className="flex items-center gap-1.5">
                          <code className="text-[10px] font-mono text-primary truncate max-w-[200px]">{surveyLink}</code>
                          <button className="text-muted-foreground hover:text-foreground" onClick={() => copy(surveyLink, "Link de encuesta")}>
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-[9px] text-muted-foreground/60 mt-1">Compartí este link con tus clientes</p>
                      </div>
                    </div>

                    {/* NPS breakdown */}
                    {loadingRes ? (
                      <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                    ) : surveyResponses.length === 0 ? (
                      <p className="text-xs text-muted-foreground/60 italic">Sin respuestas aún. Compartí el link para empezar a recibir feedback.</p>
                    ) : (
                      <div className="space-y-3 pb-12">
                        {survey.type === "nps" && nps !== null && (
                          <div className="grid grid-cols-4 gap-2">
                            <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-center">
                              <p className="text-lg font-bold font-display text-emerald-400">{nps > 0 ? "+" : ""}{nps}</p>
                              <p className="text-[10px] text-muted-foreground">NPS Score</p>
                              <p className={`text-[10px] font-medium ${npsCategory(nps).color}`}>{npsCategory(nps).label}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-center">
                              <p className="text-lg font-bold text-emerald-400">{promoters}</p>
                              <p className="text-[10px] text-muted-foreground">Promotores</p>
                              <p className="text-[10px] text-muted-foreground/60">9–10 ★</p>
                            </div>
                            <div className="p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-center">
                              <p className="text-lg font-bold text-yellow-400">{passives}</p>
                              <p className="text-[10px] text-muted-foreground">Pasivos</p>
                              <p className="text-[10px] text-muted-foreground/60">7–8 ★</p>
                            </div>
                            <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-center">
                              <p className="text-lg font-bold text-red-400">{detractors}</p>
                              <p className="text-[10px] text-muted-foreground">Detractores</p>
                              <p className="text-[10px] text-muted-foreground/60">0–6 ★</p>
                            </div>
                          </div>
                        )}

                        {/* Score distribution bar */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Distribución de puntajes</p>
                          <div className="flex gap-0.5 h-8 rounded-lg overflow-hidden">
                            {(survey.type === "nps" ? [...Array(11)].map((_, i) => i) : [1,2,3,4,5]).map(score => {
                              const count = surveyResponses.filter(r => r.score === score).length;
                              const pct = surveyResponses.length > 0 ? (count / surveyResponses.length) * 100 : 0;
                              const color = survey.type === "nps"
                                ? score >= 9 ? "bg-emerald-400" : score >= 7 ? "bg-yellow-400" : "bg-red-400"
                                : score >= 4 ? "bg-emerald-400" : score === 3 ? "bg-yellow-400" : "bg-red-400";
                              return (
                                <div key={score} className="relative flex-1 bg-muted/30 flex flex-col justify-end" title={`${score}: ${count} resp.`}>
                                  {pct > 0 && <div className={`${color} opacity-70 transition-all`} style={{ height: `${Math.max(pct, 5)}%` }} />}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[9px] text-muted-foreground/60 mt-0.5">
                            <span>{survey.type === "nps" ? "0" : "1"}</span>
                            <span>{survey.type === "nps" ? "10" : "5"}</span>
                          </div>
                        </div>

                        {/* Recent responses */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Respuestas recientes ({surveyResponses.length})</p>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {surveyResponses.slice(0, 20).map(r => {
                              const lbl = survey.type === "nps" ? npsLabel(r.score) : csatLabel(r.score);
                              return (
                                <div key={r.id} className="flex items-start gap-2 text-xs">
                                  <span className={`font-bold text-sm shrink-0 w-5 text-center ${lbl.color}`}>{r.score}</span>
                                  <div className="flex-1 min-w-0">
                                    {r.respondent_name && <span className="font-medium">{r.respondent_name} </span>}
                                    {r.feedback && <span className="text-muted-foreground italic">"{r.feedback}"</span>}
                                    {!r.feedback && <span className="text-muted-foreground/40 italic">Sin comentario</span>}
                                  </div>
                                  <span className={`text-[10px] shrink-0 ${lbl.color}`}>{lbl.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
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
