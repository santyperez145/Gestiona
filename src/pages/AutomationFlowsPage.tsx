import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Zap, Plus, Trash2, Play, Pause, Edit2, MessageCircle, Bell, Mail, Check } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TriggerType = "customer_inactive" | "debt_overdue" | "low_stock" | "birthday";
type ActionType = "whatsapp_message" | "notification" | "email";

type FlowRule = {
  id: string;
  org_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  action_type: ActionType;
  action_config: Record<string, any>;
  active: boolean;
  last_run_at: string | null;
  created_at: string;
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  customer_inactive: "Cliente sin comprar",
  debt_overdue: "Deuda vencida",
  low_stock: "Stock bajo",
  birthday: "Cumpleaños del cliente",
};

const ACTION_LABELS: Record<ActionType, string> = {
  whatsapp_message: "Mensaje WhatsApp",
  notification: "Notificación interna",
  email: "Email",
};

const TRIGGER_ICONS: Record<TriggerType, string> = {
  customer_inactive: "💤",
  debt_overdue: "⚠️",
  low_stock: "📦",
  birthday: "🎂",
};

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  whatsapp_message: <MessageCircle className="w-4 h-4 text-green-400" />,
  notification: <Bell className="w-4 h-4 text-primary" />,
  email: <Mail className="w-4 h-4 text-blue-400" />,
};

const EMPTY_FORM = {
  name: "",
  trigger_type: "customer_inactive" as TriggerType,
  trigger_days: "30",
  trigger_threshold: "3",
  action_type: "notification" as ActionType,
  action_message: "",
};

// ─────────────────────────────────────────────────────────────
// FlowForm
// ─────────────────────────────────────────────────────────────
function FlowForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<typeof EMPTY_FORM & { id: string }>;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Ingresá un nombre"); return; }
    setSaving(true);
    try {
      const trigger_config: Record<string, any> = {};
      if (form.trigger_type === "customer_inactive") trigger_config.days = Number(form.trigger_days);
      if (form.trigger_type === "debt_overdue") trigger_config.days_overdue = Number(form.trigger_days);
      if (form.trigger_type === "low_stock") trigger_config.threshold = Number(form.trigger_threshold);

      const action_config: Record<string, any> = { message: form.action_message };

      await onSave({ name: form.name.trim(), trigger_type: form.trigger_type, trigger_config, action_type: form.action_type, action_config });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const showDays = form.trigger_type === "customer_inactive" || form.trigger_type === "debt_overdue";
  const showThreshold = form.trigger_type === "low_stock";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Nombre del flujo</label>
        <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Ej: Reactivar clientes dormidos" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Disparador (CUANDO…)</label>
        <Select value={form.trigger_type} onValueChange={v => set("trigger_type", v as TriggerType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{TRIGGER_ICONS[v as TriggerType]} {l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showDays && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {form.trigger_type === "customer_inactive" ? "Días sin comprar" : "Días de atraso"}
          </label>
          <Input type="number" min="1" value={form.trigger_days} onChange={e => set("trigger_days", e.target.value)} />
        </div>
      )}

      {showThreshold && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Umbral de stock (unidades)</label>
          <Input type="number" min="0" value={form.trigger_threshold} onChange={e => set("trigger_threshold", e.target.value)} />
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Acción (ENTONCES…)</label>
        <Select value={form.action_type} onValueChange={v => set("action_type", v as ActionType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          {form.action_type === "whatsapp_message" ? "Mensaje (podés usar {nombre})" : "Mensaje / descripción"}
        </label>
        <Input
          value={form.action_message}
          onChange={e => set("action_message", e.target.value)}
          placeholder={form.action_type === "whatsapp_message"
            ? "Hola {nombre}! Te extrañamos en el negocio…"
            : "Ej: Hay clientes sin comprar hace 30 días"}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
          {saving ? "Guardando…" : "Guardar flujo"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
export default function AutomationFlowsPage() {
  const { activeOrg } = useOrg();
  const [flows, setFlows] = useState<FlowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlow, setEditingFlow] = useState<FlowRule | null>(null);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("automation_flows" as any)
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setFlows((data || []) as FlowRule[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const handleSave = async (data: any) => {
    if (!activeOrg) return;
    if (editingFlow) {
      const { error } = await supabase.from("automation_flows" as any).update(data).eq("id", editingFlow.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Flujo actualizado");
    } else {
      const { error } = await supabase.from("automation_flows" as any).insert({ ...data, org_id: activeOrg.id, active: true });
      if (error) { toast.error(error.message); return; }
      toast.success("Flujo creado");
    }
    setEditingFlow(null);
    await load();
  };

  const toggleActive = async (flow: FlowRule) => {
    await supabase.from("automation_flows" as any).update({ active: !flow.active }).eq("id", flow.id);
    await load();
    toast.success(flow.active ? "Flujo pausado" : "Flujo activado");
  };

  const deleteFlow = async (id: string) => {
    if (!confirm("¿Eliminar este flujo?")) return;
    await supabase.from("automation_flows" as any).delete().eq("id", id);
    await load();
    toast.success("Flujo eliminado");
  };

  const triggerDescription = (flow: FlowRule): string => {
    const base = TRIGGER_LABELS[flow.trigger_type];
    if (flow.trigger_type === "customer_inactive") return `${base}: ${flow.trigger_config?.days ?? 30} días`;
    if (flow.trigger_type === "debt_overdue") return `${base}: ${flow.trigger_config?.days_overdue ?? 0} días`;
    if (flow.trigger_type === "low_stock") return `${base}: ≤ ${flow.trigger_config?.threshold ?? 3} u.`;
    return base;
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Zap className="w-7 h-7 text-primary" />Automatizaciones
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Reglas que se ejecutan automáticamente según eventos del negocio</p>
        </div>
        <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => { setEditingFlow(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />Nuevo flujo
        </Button>
      </div>

      {/* Info banner */}
      <div className="mb-6 p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
        <Zap className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium">Cómo funcionan las automatizaciones</p>
          <p className="text-muted-foreground text-xs mt-0.5">Cada flujo activo se evalúa automáticamente cada día. Cuando se cumple el disparador, se ejecuta la acción configurada. Las notificaciones internas aparecen en el ícono de campana.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando flujos…</div>
      ) : flows.length === 0 ? (
        <div className="text-center py-20">
          <Zap className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-lg text-muted-foreground font-medium">Sin flujos configurados</p>
          <p className="text-sm text-muted-foreground mt-1">Creá tu primera automatización para que el sistema trabaje solo</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {flows.map((flow) => (
            <div key={flow.id} className={`bg-card border rounded-xl p-5 shadow-card transition-all ${flow.active ? "border-border" : "border-border/40 opacity-60"}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{TRIGGER_ICONS[flow.trigger_type]}</span>
                  <div>
                    <h3 className="font-semibold text-sm">{flow.name}</h3>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${flow.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                      {flow.active ? <><Check className="w-2.5 h-2.5" />Activo</> : <><Pause className="w-2.5 h-2.5" />Pausado</>}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditingFlow(flow); setShowForm(true); }}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(flow)}>
                    {flow.active ? <Pause className="w-3.5 h-3.5 text-warning" /> : <Play className="w-3.5 h-3.5 text-success" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteFlow(flow.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">CUANDO</span>
                  <span className="bg-muted/50 rounded-lg px-2 py-1 text-xs">{triggerDescription(flow)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">HACER</span>
                  <span className="bg-muted/50 rounded-lg px-2 py-1 text-xs flex items-center gap-1.5">
                    {ACTION_ICONS[flow.action_type]}
                    {ACTION_LABELS[flow.action_type]}
                  </span>
                </div>
                {flow.action_config?.message && (
                  <div className="flex items-start gap-2 mt-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0 pt-0.5">MSG</span>
                    <span className="text-xs text-muted-foreground italic truncate">{flow.action_config.message}</span>
                  </div>
                )}
              </div>

              {flow.last_run_at && (
                <p className="text-[10px] text-muted-foreground/60 mt-3 pt-3 border-t border-border/50">
                  Última ejecución: {new Date(flow.last_run_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingFlow(null); }}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editingFlow ? "Editar flujo" : "Nuevo flujo de automatización"}</DialogTitle>
          </DialogHeader>
          <FlowForm
            initial={editingFlow ? {
              id: editingFlow.id,
              name: editingFlow.name,
              trigger_type: editingFlow.trigger_type,
              trigger_days: String(editingFlow.trigger_config?.days ?? editingFlow.trigger_config?.days_overdue ?? "30"),
              trigger_threshold: String(editingFlow.trigger_config?.threshold ?? "3"),
              action_type: editingFlow.action_type,
              action_message: editingFlow.action_config?.message ?? "",
            } : undefined}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingFlow(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
