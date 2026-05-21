import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Zap, Plus, Trash2, Play, Pause, Edit2,
  MessageCircle, Bell, Mail, Check, Package,
  ClipboardList, Globe, Users, ShoppingBag, TrendingUp, AlertTriangle,
  History, RefreshCw, CheckCircle2, XCircle, SkipForward,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TriggerType =
  | "customer_inactive"
  | "debt_overdue"
  | "low_stock"
  | "birthday"
  | "stock_out"
  | "new_customer"
  | "big_sale";

type ActionType =
  | "notification"
  | "email"
  | "whatsapp_message"
  | "create_task"
  | "create_purchase_order"
  | "webhook";

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

// ─────────────────────────────────────────────────────────────
// Labels / icons
// ─────────────────────────────────────────────────────────────
const TRIGGER_LABELS: Record<TriggerType, string> = {
  customer_inactive: "Cliente sin comprar",
  debt_overdue: "Deuda vencida",
  low_stock: "Stock bajo",
  birthday: "Cumpleaños del cliente",
  stock_out: "Producto sin stock",
  new_customer: "Nuevo cliente",
  big_sale: "Venta destacada",
};

const TRIGGER_ICONS: Record<TriggerType, React.ReactNode> = {
  customer_inactive: <Users className="w-4 h-4" />,
  debt_overdue: <AlertTriangle className="w-4 h-4" />,
  low_stock: <Package className="w-4 h-4" />,
  birthday: <span>🎂</span>,
  stock_out: <Package className="w-4 h-4 text-destructive" />,
  new_customer: <Users className="w-4 h-4 text-success" />,
  big_sale: <TrendingUp className="w-4 h-4 text-success" />,
};

const TRIGGER_EMOJI: Record<TriggerType, string> = {
  customer_inactive: "💤",
  debt_overdue: "⚠️",
  low_stock: "📦",
  birthday: "🎂",
  stock_out: "🚫",
  new_customer: "🆕",
  big_sale: "🚀",
};

const ACTION_LABELS: Record<ActionType, string> = {
  notification: "Notificación interna",
  email: "Enviar email",
  whatsapp_message: "Mensaje WhatsApp",
  create_task: "Crear tarea",
  create_purchase_order: "Crear orden de compra",
  webhook: "Llamar webhook",
};

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  notification: <Bell className="w-4 h-4 text-primary" />,
  email: <Mail className="w-4 h-4 text-blue-400" />,
  whatsapp_message: <MessageCircle className="w-4 h-4 text-green-400" />,
  create_task: <ClipboardList className="w-4 h-4 text-yellow-400" />,
  create_purchase_order: <ShoppingBag className="w-4 h-4 text-orange-400" />,
  webhook: <Globe className="w-4 h-4 text-purple-400" />,
};

const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  notification: "Aparece en el ícono de campana para todos los admins.",
  email: "Envía un email a los administradores (requiere RESEND_API_KEY configurada).",
  whatsapp_message: "Envía WhatsApp al cliente (requiere Twilio configurado en variables de entorno).",
  create_task: "Crea una tarea pendiente en el módulo de Tareas.",
  create_purchase_order: "Crea un borrador de orden de compra para reponer stock (solo para triggers de stock).",
  webhook: "Llama al webhook configurado en Integraciones con los datos del evento.",
};

// Triggers that support per-customer WhatsApp / email
const CUSTOMER_TRIGGERS: TriggerType[] = ["customer_inactive", "debt_overdue", "birthday", "new_customer"];

// Triggers that support create_purchase_order
const STOCK_TRIGGERS: TriggerType[] = ["low_stock", "stock_out"];

// ─────────────────────────────────────────────────────────────
// Pre-built templates
// ─────────────────────────────────────────────────────────────
const FLOW_TEMPLATES: {
  name: string;
  emoji: string;
  description: string;
  data: { trigger_type: TriggerType; trigger_config: Record<string, any>; action_type: ActionType; action_config: Record<string, any> };
}[] = [
  {
    name: "Clientes sin comprar (30d) → Notificación",
    emoji: "💤",
    description: "Avisa cuando un cliente lleva 30 días sin comprar",
    data: {
      trigger_type: "customer_inactive",
      trigger_config: { days: 30 },
      action_type: "notification",
      action_config: { message: "Hay clientes sin comprar hace más de 30 días" },
    },
  },
  {
    name: "Deuda vencida → Tarea de cobro",
    emoji: "⚠️",
    description: "Crea una tarea de cobro cuando una deuda lleva 7+ días vencida",
    data: {
      trigger_type: "debt_overdue",
      trigger_config: { days_overdue: 7 },
      action_type: "create_task",
      action_config: { task_priority: "high", task_due_days: 2, message: "Gestionar cobro de deuda vencida" },
    },
  },
  {
    name: "Stock bajo → Notificación de reposición",
    emoji: "📦",
    description: "Alerta cuando un producto baja de 5 unidades",
    data: {
      trigger_type: "low_stock",
      trigger_config: { threshold: 5 },
      action_type: "notification",
      action_config: { message: "Producto con stock bajo — reponer urgente" },
    },
  },
  {
    name: "Cumpleaños de cliente → WhatsApp",
    emoji: "🎂",
    description: "Envía mensaje de cumpleaños a clientes",
    data: {
      trigger_type: "birthday",
      trigger_config: {},
      action_type: "whatsapp_message",
      action_config: { message: "¡Feliz cumpleaños! 🎉 Te deseamos un excelente día. Como regalo, tenés un descuento especial esperándote." },
    },
  },
  {
    name: "Nuevo cliente → Tarea de bienvenida",
    emoji: "🆕",
    description: "Crea una tarea de seguimiento para cada nuevo cliente",
    data: {
      trigger_type: "new_customer",
      trigger_config: {},
      action_type: "create_task",
      action_config: { task_priority: "medium", task_due_days: 3, message: "Contactar nuevo cliente y dar bienvenida" },
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Default form state
// ─────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: "",
  trigger_type: "customer_inactive" as TriggerType,
  trigger_days: "30",
  trigger_threshold: "3",
  trigger_min_amount: "50000",
  action_type: "notification" as ActionType,
  action_message: "",
  action_recipient_email: "",
  action_task_priority: "medium",
  action_task_due_days: "3",
  action_reorder_qty: "10",
};

// ─────────────────────────────────────────────────────────────
// Flow Form
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

    // Validate incompatible combos
    if (form.action_type === "create_purchase_order" && !STOCK_TRIGGERS.includes(form.trigger_type)) {
      toast.error("'Crear orden de compra' solo funciona con triggers de stock bajo o sin stock.");
      return;
    }

    setSaving(true);
    try {
      // Build trigger_config
      const trigger_config: Record<string, any> = {};
      if (form.trigger_type === "customer_inactive") trigger_config.days = Number(form.trigger_days);
      if (form.trigger_type === "debt_overdue") trigger_config.days_overdue = Number(form.trigger_days);
      if (form.trigger_type === "low_stock") trigger_config.threshold = Number(form.trigger_threshold);
      if (form.trigger_type === "big_sale") trigger_config.min_amount = Number(form.trigger_min_amount);

      // Build action_config
      const action_config: Record<string, any> = {};
      if (form.action_message.trim()) action_config.message = form.action_message.trim();
      if (form.action_type === "email" && form.action_recipient_email.trim()) {
        action_config.recipient_email = form.action_recipient_email.trim();
      }
      if (form.action_type === "create_task") {
        action_config.task_priority = form.action_task_priority;
        if (form.action_task_due_days) action_config.task_due_days = Number(form.action_task_due_days);
      }
      if (form.action_type === "create_purchase_order") {
        action_config.reorder_qty = Number(form.action_reorder_qty);
      }

      await onSave({
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        trigger_config,
        action_type: form.action_type,
        action_config,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const showDays = form.trigger_type === "customer_inactive" || form.trigger_type === "debt_overdue";
  const showThreshold = form.trigger_type === "low_stock";
  const showMinAmount = form.trigger_type === "big_sale";

  // Actions that are not compatible with selected trigger
  const incompatibleAction =
    form.action_type === "create_purchase_order" && !STOCK_TRIGGERS.includes(form.trigger_type);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Nombre del flujo</label>
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ej: Reactivar clientes dormidos"
        />
      </div>

      {/* Trigger type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Disparador — CUANDO…</label>
        <Select value={form.trigger_type} onValueChange={(v) => set("trigger_type", v as TriggerType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Clientes</div>
            {(["customer_inactive", "birthday", "new_customer"] as TriggerType[]).map((v) => (
              <SelectItem key={v} value={v}>{TRIGGER_EMOJI[v]} {TRIGGER_LABELS[v]}</SelectItem>
            ))}
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Finanzas</div>
            {(["debt_overdue", "big_sale"] as TriggerType[]).map((v) => (
              <SelectItem key={v} value={v}>{TRIGGER_EMOJI[v]} {TRIGGER_LABELS[v]}</SelectItem>
            ))}
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Inventario</div>
            {(["low_stock", "stock_out"] as TriggerType[]).map((v) => (
              <SelectItem key={v} value={v}>{TRIGGER_EMOJI[v]} {TRIGGER_LABELS[v]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Trigger params */}
      {showDays && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {form.trigger_type === "customer_inactive" ? "Días sin comprar" : "Días de atraso"}
          </label>
          <Input type="number" min="1" value={form.trigger_days} onChange={(e) => set("trigger_days", e.target.value)} />
        </div>
      )}
      {showThreshold && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Umbral de stock (unidades)</label>
          <Input type="number" min="0" value={form.trigger_threshold} onChange={(e) => set("trigger_threshold", e.target.value)} />
        </div>
      )}
      {showMinAmount && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Monto mínimo de la venta (ARS)</label>
          <Input type="number" min="0" value={form.trigger_min_amount} onChange={(e) => set("trigger_min_amount", e.target.value)} />
        </div>
      )}

      {/* Action type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Acción — ENTONCES…</label>
        <Select value={form.action_type} onValueChange={(v) => set("action_type", v as ActionType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Notificar</div>
            {(["notification", "email", "whatsapp_message"] as ActionType[]).map((v) => (
              <SelectItem key={v} value={v}>
                <span className="flex items-center gap-2">{ACTION_ICONS[v]} {ACTION_LABELS[v]}</span>
              </SelectItem>
            ))}
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Crear</div>
            {(["create_task", "create_purchase_order"] as ActionType[]).map((v) => (
              <SelectItem key={v} value={v}>
                <span className="flex items-center gap-2">{ACTION_ICONS[v]} {ACTION_LABELS[v]}</span>
              </SelectItem>
            ))}
            <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Integración</div>
            <SelectItem value="webhook">
              <span className="flex items-center gap-2">{ACTION_ICONS.webhook} {ACTION_LABELS.webhook}</span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-1">{ACTION_DESCRIPTIONS[form.action_type]}</p>
        {incompatibleAction && (
          <p className="text-[11px] text-destructive mt-1 font-medium">
            ⚠ Esta acción requiere un trigger de stock bajo o sin stock.
          </p>
        )}
      </div>

      {/* Action params: message */}
      {(form.action_type === "notification" || form.action_type === "email" || form.action_type === "whatsapp_message") && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Mensaje {form.action_type === "whatsapp_message" && <span className="text-muted-foreground/60">(podés usar {"{nombre}"}, {"{detalle}"})</span>}
          </label>
          <Input
            value={form.action_message}
            onChange={(e) => set("action_message", e.target.value)}
            placeholder={
              form.action_type === "whatsapp_message"
                ? "Hola {nombre}! Te extrañamos en el negocio…"
                : "Dejá vacío para usar el mensaje predeterminado"
            }
          />
        </div>
      )}

      {/* Action params: email recipient */}
      {form.action_type === "email" && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Email destinatario <span className="text-muted-foreground/60">(opcional — vacío = todos los admins)</span>
          </label>
          <Input
            type="email"
            value={form.action_recipient_email}
            onChange={(e) => set("action_recipient_email", e.target.value)}
            placeholder="ejemplo@empresa.com"
          />
        </div>
      )}

      {/* Action params: create_task */}
      {form.action_type === "create_task" && (
        <>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Título de la tarea</label>
            <Input
              value={form.action_message}
              onChange={(e) => set("action_message", e.target.value)}
              placeholder="Ej: Llamar clientes inactivos"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Prioridad</label>
              <Select value={form.action_task_priority} onValueChange={(v) => set("action_task_priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Vence en (días)</label>
              <Input
                type="number"
                min="1"
                value={form.action_task_due_days}
                onChange={(e) => set("action_task_due_days", e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {/* Action params: create_purchase_order */}
      {form.action_type === "create_purchase_order" && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cantidad a reponer por producto</label>
          <Input
            type="number"
            min="1"
            value={form.action_reorder_qty}
            onChange={(e) => set("action_reorder_qty", e.target.value)}
          />
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="submit"
          className="flex-1 gradient-gold text-primary-foreground font-semibold"
          disabled={saving || incompatibleAction}
        >
          {saving ? "Guardando…" : "Guardar flujo"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Helper: readable trigger description
// ─────────────────────────────────────────────────────────────
function triggerDescription(flow: FlowRule): string {
  const base = TRIGGER_LABELS[flow.trigger_type];
  if (flow.trigger_type === "customer_inactive") return `${base}: ${flow.trigger_config?.days ?? 30} días`;
  if (flow.trigger_type === "debt_overdue") return `${base}: ${flow.trigger_config?.days_overdue ?? 0} días`;
  if (flow.trigger_type === "low_stock") return `${base}: ≤ ${flow.trigger_config?.threshold ?? 3} u.`;
  if (flow.trigger_type === "big_sale") return `${base}: ≥ $${Number(flow.trigger_config?.min_amount ?? 50000).toLocaleString("es-AR")}`;
  return base;
}

// ─────────────────────────────────────────────────────────────
// Helper: action badge color
// ─────────────────────────────────────────────────────────────
function actionBadgeClass(a: ActionType): string {
  const map: Record<ActionType, string> = {
    notification: "bg-primary/10 text-primary",
    email: "bg-blue-500/10 text-blue-400",
    whatsapp_message: "bg-green-500/10 text-green-400",
    create_task: "bg-yellow-500/10 text-yellow-400",
    create_purchase_order: "bg-orange-500/10 text-orange-400",
    webhook: "bg-purple-500/10 text-purple-400",
  };
  return map[a] ?? "bg-muted text-muted-foreground";
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
interface AutomationRun {
  id: string;
  flow_id: string;
  trigger_type: string;
  action_type: string;
  status: "success" | "error" | "skipped";
  entities_matched: number;
  actions_taken: number;
  error_message: string | null;
  ran_at: string;
}

export default function AutomationFlowsPage() {
  const { activeOrg } = useOrg();
  const [flows, setFlows] = useState<FlowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlow, setEditingFlow] = useState<FlowRule | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: flowData }, { data: runData }] = await Promise.all([
      supabase
        .from("automation_flows")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("automation_runs")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("ran_at", { ascending: false })
        .limit(50),
    ]);
    setFlows((flowData || []) as FlowRule[]);
    setRuns((runData || []) as AutomationRun[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const runFlowNow = async (flow: FlowRule) => {
    setRunningFlowId(flow.id);
    try {
      const { error } = await supabase.functions.invoke("execute-automations", {
        body: { org_id: activeOrg?.id, flow_id: flow.id },
      });
      if (error) throw error;
      toast.success(`Flujo "${flow.name}" ejecutado`);
      setTimeout(() => load(), 1500);
    } catch {
      toast.error("Error al ejecutar el flujo");
    }
    setRunningFlowId(null);
  };

  const handleSave = async (data: any) => {
    if (!activeOrg) return;
    if (editingFlow) {
      const { error } = await supabase.from("automation_flows").update(data).eq("id", editingFlow.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Flujo actualizado");
    } else {
      const { error } = await supabase.from("automation_flows").insert({ ...data, org_id: activeOrg.id, active: true });
      if (error) { toast.error(error.message); return; }
      toast.success("Flujo creado");
    }
    setEditingFlow(null);
    await load();
  };

  const toggleActive = async (flow: FlowRule) => {
    await supabase.from("automation_flows").update({ active: !flow.active }).eq("id", flow.id);
    await load();
    toast.success(flow.active ? "Flujo pausado" : "Flujo activado");
  };

  const deleteFlow = async (id: string) => {
    if (!confirm("¿Eliminar este flujo?")) return;
    await supabase.from("automation_flows").delete().eq("id", id);
    await load();
    toast.success("Flujo eliminado");
  };

  const activeCount = flows.filter((f) => f.active).length;

  const totalRuns = runs.length;
  const successRuns = runs.filter(r => r.status === "success").length;

  return (
    <div>
      <PageHeader
        icon={Zap}
        title="Automatizaciones"
        description="Reglas que se ejecutan automáticamente cada día a las 08:00 según eventos del negocio"
        badge={{ label: `${activeCount} activa${activeCount !== 1 ? "s" : ""}`, variant: activeCount > 0 ? "success" : "default" }}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5"
              disabled={runningFlowId === "__all__"}
              onClick={async () => {
                setRunningFlowId("__all__");
                try {
                  const { error } = await supabase.functions.invoke("execute-automations", { body: { org_id: activeOrg?.id } });
                  if (error) throw error;
                  toast.success("Todos los flujos ejecutados");
                  setTimeout(() => load(), 1500);
                } catch { toast.error("Error al ejecutar flujos"); }
                setRunningFlowId(null);
              }}>
              {runningFlowId === "__all__" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Ejecutar todos
            </Button>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"
              onClick={() => { setEditingFlow(null); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />Nuevo flujo
            </Button>
          </div>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display text-primary">{flows.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Flujos totales</p>
        </div>
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display text-success">{activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Activos</p>
        </div>
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display text-blue-400">{totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0}%</p>
          <p className="text-xs text-muted-foreground mt-1">Éxito ({successRuns}/{totalRuns})</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="mb-6 p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
        <Zap className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-medium">Cómo funcionan las automatizaciones</p>
          <p className="text-muted-foreground text-xs">
            Cada flujo activo se evalúa automáticamente <strong>todos los días a las 8:00 AM (Argentina)</strong>.
            Cuando se cumple el disparador, se ejecuta la acción configurada.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["notification", "email", "whatsapp_message", "create_task", "create_purchase_order", "webhook"] as ActionType[]).map((a) => (
              <span key={a} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${actionBadgeClass(a)}`}>
                {ACTION_ICONS[a]}{ACTION_LABELS[a]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Template gallery */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Plantillas sugeridas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {FLOW_TEMPLATES.map((tpl) => (
            <div key={tpl.name} className="flex items-center gap-3 p-3 bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl hover:border-primary/30 transition-colors group">
              <span className="text-2xl shrink-0">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-tight">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleSave(tpl.data)}
              >
                <Plus className="w-3 h-3 mr-1" />Crear
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Flows grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando flujos…</div>
      ) : flows.length === 0 ? (
        <div className="text-center py-12">
          <Zap className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-lg text-muted-foreground font-medium">Sin flujos configurados</p>
          <p className="text-sm text-muted-foreground mt-1">Usá una plantilla o creá tu primera automatización personalizada</p>
          <Button
            className="mt-4 gradient-gold text-primary-foreground font-semibold"
            onClick={() => setShowForm(true)}
          >
            <Plus className="w-4 h-4 mr-2" />Crear flujo personalizado
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {flows.map((flow) => (
            <div
              key={flow.id}
              className={`bg-card border rounded-xl p-5 shadow-card transition-all ${flow.active ? "border-border" : "border-border/40 opacity-60"}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{TRIGGER_EMOJI[flow.trigger_type]}</span>
                  <div>
                    <h3 className="font-semibold text-sm leading-tight">{flow.name}</h3>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 mt-0.5 ${flow.active ? "border-success/40 text-success bg-success/5" : "border-border text-muted-foreground"}`}
                    >
                      {flow.active ? "Activo" : "Pausado"}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => runFlowNow(flow)}
                    disabled={runningFlowId === flow.id}
                    title="Ejecutar ahora"
                    className="text-primary"
                  >
                    {runningFlowId === flow.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Play className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setEditingFlow(flow); setShowForm(true); }}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(flow)} title={flow.active ? "Pausar" : "Activar"}>
                    {flow.active
                      ? <Pause className="w-3.5 h-3.5 text-warning" />
                      : <Zap className="w-3.5 h-3.5 text-success" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteFlow(flow.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">CUANDO</span>
                  <span className="bg-muted/50 rounded-lg px-2 py-1 text-xs flex items-center gap-1.5">
                    {TRIGGER_ICONS[flow.trigger_type]}
                    {triggerDescription(flow)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">HACER</span>
                  <span className={`rounded-lg px-2 py-1 text-xs flex items-center gap-1.5 ${actionBadgeClass(flow.action_type)}`}>
                    {ACTION_ICONS[flow.action_type]}
                    {ACTION_LABELS[flow.action_type]}
                  </span>
                </div>
                {flow.action_config?.message && (
                  <div className="flex items-start gap-2 mt-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0 pt-0.5">MSG</span>
                    <span className="text-xs text-muted-foreground italic truncate max-w-[200px]">
                      {flow.action_config.message}
                    </span>
                  </div>
                )}
                {flow.action_type === "create_task" && flow.action_config?.task_priority && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">CONFIG</span>
                    <span className="text-xs text-muted-foreground">
                      Prioridad: {flow.action_config.task_priority}
                      {flow.action_config.task_due_days && ` · vence en ${flow.action_config.task_due_days}d`}
                    </span>
                  </div>
                )}
                {flow.action_type === "create_purchase_order" && flow.action_config?.reorder_qty && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-16 shrink-0">CONFIG</span>
                    <span className="text-xs text-muted-foreground">
                      Reponer {flow.action_config.reorder_qty} u. por producto
                    </span>
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

      {/* Execution History */}
      {runs.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <History className="w-4 h-4" />
            Historial de ejecuciones ({runs.length})
            <span className="text-xs ml-1">{showHistory ? "▲" : "▼"}</span>
          </button>
          {showHistory && (
            <div className="space-y-2">
              {runs.map(run => {
                const flow = flows.find(f => f.id === run.flow_id);
                const StatusIcon =
                  run.status === "success" ? CheckCircle2 :
                  run.status === "error" ? XCircle : SkipForward;
                const statusColor =
                  run.status === "success" ? "text-success" :
                  run.status === "error" ? "text-destructive" : "text-muted-foreground";
                return (
                  <div key={run.id} className="flex items-start gap-3 bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl px-4 py-3">
                    <StatusIcon className={`w-4 h-4 mt-0.5 shrink-0 ${statusColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{flow?.name ?? "Flujo eliminado"}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          run.status === "success" ? "bg-success/10 text-success" :
                          run.status === "error" ? "bg-destructive/10 text-destructive" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {run.status === "success" ? "Exitoso" : run.status === "error" ? "Error" : "Sin coincidencias"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {run.entities_matched} entidades detectadas · {run.actions_taken} acciones ejecutadas
                        {run.error_message && <span className="text-destructive ml-2">· {run.error_message}</span>}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(run.ran_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditingFlow(null); }}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {editingFlow ? "Editar flujo" : "Nuevo flujo de automatización"}
            </DialogTitle>
          </DialogHeader>
          <FlowForm
            initial={editingFlow ? {
              id: editingFlow.id,
              name: editingFlow.name,
              trigger_type: editingFlow.trigger_type,
              trigger_days: String(
                editingFlow.trigger_config?.days ??
                editingFlow.trigger_config?.days_overdue ??
                "30"
              ),
              trigger_threshold: String(editingFlow.trigger_config?.threshold ?? "3"),
              trigger_min_amount: String(editingFlow.trigger_config?.min_amount ?? "50000"),
              action_type: editingFlow.action_type,
              action_message: editingFlow.action_config?.message ?? "",
              action_recipient_email: editingFlow.action_config?.recipient_email ?? "",
              action_task_priority: editingFlow.action_config?.task_priority ?? "medium",
              action_task_due_days: String(editingFlow.action_config?.task_due_days ?? "3"),
              action_reorder_qty: String(editingFlow.action_config?.reorder_qty ?? "10"),
            } : undefined}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingFlow(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
