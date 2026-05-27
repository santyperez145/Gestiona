/**
 * DripSequencesPage — Email drip sequence campaigns
 *
 * Salesforce Marketing Cloud equivalent for pymes.
 * Build automated email sequences triggered by customer events:
 * - welcome (new customer)
 * - quote_sent (after sending a budget)
 * - deal_lost (after losing a deal — re-engagement)
 * - inactive_90d (customers inactive for 90 days)
 * - post_purchase (X days after a sale)
 *
 * Each sequence has N steps, each with a delay in days and an email template.
 * Enrollment is manual (bulk select from customers/deals) or automatic via triggers.
 */
import { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Mail, Plus, X, Loader2, Play, Pause, Trash2, ChevronDown, ChevronUp,
  Clock, Users, Send, Zap, BarChart3, CheckCircle2, Circle, ArrowRight,
  Edit2, Eye, RefreshCw,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TriggerEvent = "welcome" | "quote_sent" | "deal_lost" | "inactive_90d" | "post_purchase" | "manual";

interface SequenceStep {
  id?: string;
  day_offset: number;    // days after trigger
  subject: string;
  body_html: string;
  step_order: number;
}

interface DripSequence {
  id: string;
  org_id: string;
  name: string;
  trigger_event: TriggerEvent;
  active: boolean;
  steps: SequenceStep[];
  enrollment_count: number;
  completed_count: number;
  created_at: string;
}

interface Enrollment {
  id: string;
  sequence_id: string;
  customer_name: string;
  customer_email: string;
  current_step: number;
  total_steps: number;
  status: "active" | "completed" | "unsubscribed" | "paused";
  next_send_at: string | null;
  enrolled_at: string;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const TRIGGER_CONFIG: Record<TriggerEvent, { label: string; desc: string; color: string }> = {
  welcome:       { label: "Bienvenida",          desc: "Al agregar un nuevo cliente", color: "text-blue-400" },
  quote_sent:    { label: "Presupuesto enviado",  desc: "Días después de enviar un presupuesto", color: "text-purple-400" },
  deal_lost:     { label: "Deal perdido",         desc: "Re-engagement tras perder un deal", color: "text-red-400" },
  inactive_90d:  { label: "Clientes inactivos",   desc: "Sin compras en 90+ días", color: "text-orange-400" },
  post_purchase: { label: "Post-compra",          desc: "Días después de una venta", color: "text-green-400" },
  manual:        { label: "Manual",               desc: "Enrolamiento manual de contactos", color: "text-muted-foreground" },
};

const STEP_TEMPLATES: Record<TriggerEvent, { subject: string; body_html: string }[]> = {
  welcome: [
    { subject: "¡Bienvenido/a a {negocio}!", body_html: "<p>Hola {nombre},</p><p>Gracias por ser parte de <strong>{negocio}</strong>. Estamos acá para ayudarte con lo que necesites.</p><p>¡Saludos!</p>" },
    { subject: "¿Cómo podemos ayudarte?", body_html: "<p>Hola {nombre},</p><p>¿Ya conociste todo lo que tenemos para ofrecerte? Te invitamos a explorar nuestro catálogo.</p>" },
  ],
  quote_sent: [
    { subject: "¿Tuviste la chance de revisar tu presupuesto?", body_html: "<p>Hola {nombre},</p><p>Te enviamos un presupuesto hace unos días. ¿Pudiste revisarlo? Estamos disponibles ante cualquier consulta.</p>" },
    { subject: "Última chance — presupuesto vigente", body_html: "<p>Hola {nombre},</p><p>Tu presupuesto sigue vigente. Si necesitás ajustes o aclaraciones, escribinos sin compromiso.</p>" },
  ],
  deal_lost: [
    { subject: "¿Podemos mejorar la propuesta?", body_html: "<p>Hola {nombre},</p><p>Entendemos que no llegamos a un acuerdo. Si querés, podemos explorar alternativas que se ajusten mejor a tu presupuesto o necesidades.</p>" },
  ],
  inactive_90d: [
    { subject: "Te extrañamos en {negocio}", body_html: "<p>Hola {nombre},</p><p>Hace un tiempo que no te vemos. Tenemos novedades y ofertas que pueden interesarte.</p>" },
    { subject: "Oferta especial para vos", body_html: "<p>Hola {nombre},</p><p>Por ser cliente frecuente, tenemos algo especial reservado. ¡Contactanos para conocerlo!</p>" },
  ],
  post_purchase: [
    { subject: "¿Qué te pareció tu compra?", body_html: "<p>Hola {nombre},</p><p>¿Ya recibiste tu pedido? Nos encantaría saber tu opinión. Tu feedback nos ayuda a mejorar.</p>" },
    { subject: "Productos complementarios para vos", body_html: "<p>Hola {nombre},</p><p>Basándonos en tu última compra, creemos que estos productos también pueden interesarte.</p>" },
  ],
  manual: [
    { subject: "Mensaje de {negocio}", body_html: "<p>Hola {nombre},</p><p>Escribimos para informarte novedades de {negocio}.</p>" },
  ],
};

const EMPTY_STEP = (): SequenceStep => ({ day_offset: 3, subject: "", body_html: "", step_order: 1 });

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function DripSequencesPage() {
  usePageTitle("Secuencias de Email");

  const { activeOrg, activeRole } = useOrg();
  const { user } = useAuth();

  const [sequences, setSequences]   = useState<DripSequence[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [showForm, setShowForm]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [enrollments, setEnrollments] = useState<Record<string, Enrollment[]>>({});
  const [loadingEnroll, setLoadingEnroll] = useState(false);
  const [enrollForm, setEnrollForm] = useState<{ sequenceId: string; email: string; name: string } | null>(null);
  const [enrollSaving, setEnrollSaving] = useState(false);

  const [form, setForm] = useState<{
    name: string;
    trigger_event: TriggerEvent;
    steps: SequenceStep[];
  }>({ name: "", trigger_event: "welcome", steps: [] });

  const canManage = activeRole === "owner" || activeRole === "admin";

  // ── Load sequences ────────────────────────────────────────
  const loadSequences = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("drip_sequences")
        .select("*, drip_sequence_steps(*)")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const shaped = (data || []).map((s: any) => ({
        ...s,
        steps: (s.drip_sequence_steps || []).sort((a: any, b: any) => a.step_order - b.step_order),
        enrollment_count: 0,
        completed_count: 0,
      }));
      setSequences(shaped as DripSequence[]);
    } catch (e: any) {
      toast.error("Error cargando secuencias: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  // ── Load enrollments for expanded sequence ────────────────
  useEffect(() => {
    if (!expanded || enrollments[expanded]) return;
    setLoadingEnroll(true);
    supabase
      .from("drip_enrollments")
      .select("*")
      .eq("sequence_id", expanded)
      .order("enrolled_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!error) setEnrollments(prev => ({ ...prev, [expanded]: (data || []) as Enrollment[] }));
        setLoadingEnroll(false);
      });
  }, [expanded]);

  // ── Initialize form with template steps ──────────────────
  const initFormWithTrigger = (trigger: TriggerEvent) => {
    const templates = STEP_TEMPLATES[trigger] || [];
    setForm(prev => ({
      ...prev,
      trigger_event: trigger,
      steps: templates.map((t, i) => ({
        day_offset: (i + 1) * 3,
        subject: t.subject,
        body_html: t.body_html,
        step_order: i + 1,
      })),
    }));
  };

  // ── Save sequence ─────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim() || form.steps.length === 0 || !activeOrg?.id) return;
    setSaving(true);
    try {
      const { data: seq, error: seqErr } = await supabase
        .from("drip_sequences")
        .insert({
          org_id: activeOrg.id,
          name: form.name.trim(),
          trigger_event: form.trigger_event,
          active: false,
        })
        .select()
        .single();
      if (seqErr || !seq) throw seqErr || new Error("Sin retorno");

      // Insert steps
      const steps = form.steps.map((s, i) => ({
        sequence_id: seq.id,
        org_id: activeOrg.id,
        step_order: i + 1,
        day_offset: Number(s.day_offset),
        subject: s.subject.trim(),
        body_html: s.body_html.trim(),
      }));
      const { error: stepsErr } = await supabase.from("drip_sequence_steps").insert(steps);
      if (stepsErr) throw stepsErr;

      toast.success(`Secuencia "${form.name}" creada`);
      setShowForm(false);
      setForm({ name: "", trigger_event: "welcome", steps: [] });
      loadSequences();
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle active ─────────────────────────────────────────
  const toggleActive = async (seq: DripSequence) => {
    try {
      await supabase.from("drip_sequences").update({ active: !seq.active }).eq("id", seq.id);
      setSequences(prev => prev.map(s => s.id === seq.id ? { ...s, active: !s.active } : s));
      toast.success(seq.active ? "Secuencia pausada" : "Secuencia activada");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  // ── Delete sequence ───────────────────────────────────────
  const deleteSeq = async (id: string) => {
    if (!confirm("¿Eliminar esta secuencia y todos sus datos?")) return;
    try {
      await supabase.from("drip_sequences").delete().eq("id", id);
      setSequences(prev => prev.filter(s => s.id !== id));
      toast.success("Secuencia eliminada");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  // ── Enroll contact ────────────────────────────────────────
  const handleEnroll = async () => {
    if (!enrollForm?.email.trim() || !activeOrg?.id) return;
    setEnrollSaving(true);
    try {
      const seq = sequences.find(s => s.id === enrollForm.sequenceId);
      if (!seq || seq.steps.length === 0) throw new Error("Secuencia sin pasos");
      const firstStep = seq.steps[0];
      const nextSend = new Date(Date.now() + (firstStep.day_offset || 1) * 86400000).toISOString();
      await supabase.from("drip_enrollments").insert({
        sequence_id: enrollForm.sequenceId,
        org_id: activeOrg.id,
        customer_email: enrollForm.email.trim().toLowerCase(),
        customer_name: enrollForm.name.trim() || enrollForm.email.trim().split("@")[0],
        current_step: 0,
        total_steps: seq.steps.length,
        status: "active",
        next_send_at: nextSend,
      });
      toast.success(`${enrollForm.email} enrolado/a`);
      setEnrollments(prev => ({ ...prev, [enrollForm.sequenceId]: [] })); // force reload
      setEnrollForm(null);
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setEnrollSaving(false);
    }
  };

  // ── Stats ─────────────────────────────────────────────────
  const stats = {
    total: sequences.length,
    active: sequences.filter(s => s.active).length,
    totalEnrolled: Object.values(enrollments).flat().filter(e => e.status === "active").length,
    totalCompleted: Object.values(enrollments).flat().filter(e => e.status === "completed").length,
  };

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Mail}
        title="Secuencias de Email"
        description="Automatizá el nurturing de clientes con drip campaigns"
        badge={stats.active > 0 ? { label: `${stats.active} activa${stats.active > 1 ? "s" : ""}`, variant: "success" } : undefined}
        actions={
          canManage ? (
            <Button onClick={() => { setShowForm(!showForm); initFormWithTrigger("welcome"); }} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nueva secuencia
            </Button>
          ) : undefined
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Secuencias" value={stats.total} icon={Mail} />
        <KPICard label="Activas" value={stats.active} icon={Play} color="success" />
        <KPICard label="En curso" value={stats.totalEnrolled} icon={Users} color="blue" />
        <KPICard label="Completadas" value={stats.totalCompleted} icon={CheckCircle2} color="warning" />
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />Nueva secuencia de email
            </h3>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowForm(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nombre *</Label>
              <Input placeholder="Ej: Bienvenida nuevos clientes" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Trigger</Label>
              <Select value={form.trigger_event} onValueChange={v => initFormWithTrigger(v as TriggerEvent)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_CONFIG) as TriggerEvent[]).map(k => (
                    <SelectItem key={k} value={k}>
                      <span className={TRIGGER_CONFIG[k].color}>{TRIGGER_CONFIG[k].label}</span>
                      <span className="text-muted-foreground text-xs ml-1">— {TRIGGER_CONFIG[k].desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">Pasos ({form.steps.length})</p>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setForm(p => ({ ...p, steps: [...p.steps, { ...EMPTY_STEP(), step_order: p.steps.length + 1, day_offset: (p.steps.length + 1) * 3 }] }))}>
                <Plus className="w-3 h-3 mr-1" />Agregar paso
              </Button>
            </div>
            {form.steps.map((step, idx) => (
              <div key={idx} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{idx + 1}</span>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />Día
                  </div>
                  <Input
                    type="number" min={0} max={365}
                    className="w-16 h-6 text-xs px-2"
                    value={step.day_offset}
                    onChange={e => setForm(p => {
                      const steps = [...p.steps];
                      steps[idx] = { ...steps[idx], day_offset: Number(e.target.value) };
                      return { ...p, steps };
                    })}
                  />
                  <span className="text-xs text-muted-foreground flex-1">después del trigger</span>
                  <button className="text-muted-foreground hover:text-red-400" onClick={() => setForm(p => ({ ...p, steps: p.steps.filter((_, i) => i !== idx) }))}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <Input
                  placeholder="Asunto del email"
                  className="h-7 text-xs"
                  value={step.subject}
                  onChange={e => setForm(p => {
                    const steps = [...p.steps];
                    steps[idx] = { ...steps[idx], subject: e.target.value };
                    return { ...p, steps };
                  })}
                />
                <textarea
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Cuerpo del email (HTML o texto plano). Variables: {nombre} {negocio}"
                  value={step.body_html}
                  onChange={e => setForm(p => {
                    const steps = [...p.steps];
                    steps[idx] = { ...steps[idx], body_html: e.target.value };
                    return { ...p, steps };
                  })}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || form.steps.length === 0}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Crear secuencia
            </Button>
          </div>
        </div>
      )}

      {/* Sequence list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay secuencias. Creá tu primera drip campaign.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(seq => {
            const tc = TRIGGER_CONFIG[seq.trigger_event];
            const seqEnrolls = enrollments[seq.id] || [];
            const isOpen = expanded === seq.id;

            return (
              <div key={seq.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${seq.active ? "bg-green-400 animate-pulse" : "bg-muted-foreground"}`} />
                  <button className="flex-1 text-left min-w-0" onClick={() => setExpanded(isOpen ? null : seq.id)}>
                    <p className="font-medium text-sm">{seq.name}</p>
                    <p className={`text-xs ${tc.color} mt-0.5`}>
                      {tc.label} · {seq.steps?.length || 0} paso{(seq.steps?.length || 0) !== 1 ? "s" : ""}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" className={`h-7 text-xs ${seq.active ? "border-yellow-500/30 text-yellow-400" : "border-green-500/30 text-green-400"}`}
                          onClick={() => toggleActive(seq)}>
                          {seq.active ? <><Pause className="w-3 h-3 mr-1" />Pausar</> : <><Play className="w-3 h-3 mr-1" />Activar</>}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10" onClick={() => deleteSeq(seq.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded(isOpen ? null : seq.id)}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
                    {/* Step timeline */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pasos de la secuencia</p>
                      <div className="space-y-2">
                        {(seq.steps || []).map((step, idx) => (
                          <div key={idx} className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                                {idx + 1}
                              </div>
                              {idx < (seq.steps.length - 1) && <div className="w-0.5 h-4 bg-border mt-1" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{step.subject}</span>
                                <span className="text-[10px] text-muted-foreground">· Día {step.day_offset}</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate" dangerouslySetInnerHTML={{
                                __html: step.body_html.replace(/<[^>]+>/g, " ").slice(0, 80) + "..."
                              }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Enroll form */}
                    {canManage && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Enrolados ({seqEnrolls.length})
                          </p>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => setEnrollForm({ sequenceId: seq.id, email: "", name: "" })}>
                            <Plus className="w-3 h-3 mr-1" />Enrolar contacto
                          </Button>
                        </div>
                        {enrollForm?.sequenceId === seq.id && (
                          <div className="flex gap-2 mb-3">
                            <Input className="h-7 text-xs" placeholder="Nombre" value={enrollForm.name}
                              onChange={e => setEnrollForm(p => p ? { ...p, name: e.target.value } : p)} />
                            <Input className="h-7 text-xs" type="email" placeholder="email@ejemplo.com" value={enrollForm.email}
                              onChange={e => setEnrollForm(p => p ? { ...p, email: e.target.value } : p)} />
                            <Button size="sm" className="h-7 text-xs shrink-0" onClick={handleEnroll} disabled={enrollSaving || !enrollForm.email}>
                              {enrollSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEnrollForm(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        {loadingEnroll ? (
                          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                        ) : seqEnrolls.length > 0 ? (
                          <div className="space-y-1.5">
                            {seqEnrolls.slice(0, 10).map(e => (
                              <div key={e.id} className="flex items-center gap-2 text-xs">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  e.status === "completed" ? "bg-green-400" :
                                  e.status === "active" ? "bg-blue-400" : "bg-muted-foreground"
                                }`} />
                                <span className="font-medium truncate flex-1">{e.customer_name}</span>
                                <span className="text-muted-foreground truncate">{e.customer_email}</span>
                                <span className="text-muted-foreground shrink-0">
                                  Paso {e.current_step}/{e.total_steps}
                                </span>
                                {e.status === "completed" && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground/60 italic">Sin enrolados aún.</p>
                        )}
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
