import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Bell, Plus, Edit2, Trash2, RefreshCw, Search,
  Zap, Mail, MessageCircle, Webhook, CheckCircle2,
  Clock, AlertTriangle, TrendingUp, Play, Pause,
  ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Types ─────────────────────────────────────────────────────────────────────
interface NotifRule {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Array<{ field: string; op: string; value: unknown }>;
  actions: Array<{ type: string; to?: string; subject?: string; body?: string; message?: string; title?: string; severity?: string; url?: string }>;
  channels: string[];
  active: boolean;
  cooldown_minutes: number;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
}

interface NotifLog {
  id: string;
  rule_id: string | null;
  trigger_event: string;
  channel: string;
  recipient: string | null;
  subject: string | null;
  status: string;
  created_at: string;
}

// ── Config ────────────────────────────────────────────────────────────────────
const TRIGGER_EVENTS: Record<string, { label: string; group: string }> = {
  sale_created:          { label: "Nueva venta",              group: "Ventas" },
  sale_amount_threshold: { label: "Venta supera monto",       group: "Ventas" },
  low_stock:             { label: "Stock bajo",               group: "Inventario" },
  out_of_stock:          { label: "Sin stock",                group: "Inventario" },
  new_customer:          { label: "Nuevo cliente",            group: "CRM" },
  payment_overdue:       { label: "Pago vencido",             group: "Finanzas" },
  sla_breach:            { label: "Incumplimiento SLA",       group: "Soporte" },
  appointment_reminder:  { label: "Recordatorio de turno",    group: "Turnos" },
  order_delivered:       { label: "Pedido entregado",         group: "Envíos" },
  warranty_updated:      { label: "Actualización garantía",   group: "Garantías" },
  rfq_responded:         { label: "RFQ con respuesta",        group: "Compras" },
  goal_achieved:         { label: "Meta alcanzada",           group: "Analytics" },
  badge_awarded:         { label: "Badge otorgado",           group: "Gamificación" },
};

const CHANNELS = [
  { value: "internal_alert", label: "Alerta interna", icon: Bell },
  { value: "email", label: "Email", icon: Mail },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "webhook", label: "Webhook", icon: Webhook },
];

const DEFAULT_RULES = [
  {
    name: "Stock Bajo 🔴", description: "Alerta cuando un producto baja del umbral de stock",
    trigger_event: "low_stock", channels: ["internal_alert"],
    conditions: [{ field: "stock", op: "lte", value: 5 }],
    actions: [{ type: "internal_alert", title: "Stock bajo detectado", severity: "warning" }],
    cooldown_minutes: 60,
  },
  {
    name: "Venta Grande 💰", description: "Notifica cuando una venta supera los $50,000",
    trigger_event: "sale_amount_threshold", channels: ["internal_alert"],
    conditions: [{ field: "amount", op: "gte", value: 50000 }],
    actions: [{ type: "internal_alert", title: "Venta grande registrada", severity: "info" }],
    cooldown_minutes: 0,
  },
  {
    name: "Nuevo Cliente ⭐", description: "Bienvenida automática al registrar un nuevo cliente",
    trigger_event: "new_customer", channels: ["internal_alert"],
    conditions: [], actions: [{ type: "internal_alert", title: "Nuevo cliente registrado", severity: "info" }],
    cooldown_minutes: 0,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

const STATUS_COLORS: Record<string, string> = {
  sent: "text-emerald-400", failed: "text-destructive", skipped: "text-yellow-500",
};

// ── Rule Form ─────────────────────────────────────────────────────────────────
const blankRule = () => ({
  name: "", description: "", trigger_event: "sale_created",
  channels: ["internal_alert"], cooldown_minutes: 60,
  conditions: [] as NotifRule["conditions"],
  actions: [{ type: "internal_alert", title: "Nueva notificación", severity: "info" }] as NotifRule["actions"],
  active: true,
});

function RuleForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: NotifRule | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankRule());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    setF(editing ? {
      name: editing.name, description: editing.description || "",
      trigger_event: editing.trigger_event, channels: editing.channels,
      cooldown_minutes: editing.cooldown_minutes,
      conditions: editing.conditions || [], actions: editing.actions || [],
      active: editing.active,
    } : blankRule());
  }, [editing, open]);

  async function save() {
    if (!f.name.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    const payload = {
      org_id: orgId, name: f.name.trim(), description: f.description || null,
      trigger_event: f.trigger_event, channels: f.channels,
      cooldown_minutes: Number(f.cooldown_minutes),
      conditions: f.conditions, actions: f.actions, active: f.active,
    };
    const { error } = editing
      ? await supabase.from("notification_rules").update(payload).eq("id", editing.id)
      : await supabase.from("notification_rules").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Regla guardada");
    onSaved(); onClose();
  }

  function addCondition() {
    setF(p => ({ ...p, conditions: [...p.conditions, { field: "amount", op: "gte", value: 0 }] }));
  }
  function updCondition(i: number, k: string, v: unknown) {
    setF(p => ({ ...p, conditions: p.conditions.map((c, idx) => idx === i ? { ...c, [k]: v } : c) }));
  }
  function addAction() {
    setF(p => ({ ...p, actions: [...p.actions, { type: "internal_alert", title: "", severity: "info" }] }));
  }
  function updAction(i: number, k: string, v: unknown) {
    setF(p => ({ ...p, actions: p.actions.map((a, idx) => idx === i ? { ...a, [k]: v } : a) }));
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar regla" : "Nueva regla de notificación"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="Stock bajo — alerta crítica..." />
          </div>
          <div><Label>Disparador</Label>
            <Select value={f.trigger_event} onValueChange={v => upd("trigger_event", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGER_EVENTS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.group} — {v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Condiciones (opcional)</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addCondition}>+ Condición</Button>
            </div>
            {f.conditions.map((c, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <Input placeholder="campo" value={c.field} onChange={e => updCondition(i, "field", e.target.value)} className="text-xs h-8 w-24" />
                <Select value={c.op} onValueChange={v => updCondition(i, "op", v)}>
                  <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">=</SelectItem>
                    <SelectItem value="gte">≥</SelectItem>
                    <SelectItem value="lte">≤</SelectItem>
                    <SelectItem value="gt">&gt;</SelectItem>
                    <SelectItem value="lt">&lt;</SelectItem>
                    <SelectItem value="contains">contiene</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="valor" value={String(c.value)} onChange={e => updCondition(i, "value", e.target.value)} className="text-xs h-8 flex-1" />
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive"
                  onClick={() => setF(p => ({ ...p, conditions: p.conditions.filter((_, idx) => idx !== i) }))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Acciones</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addAction}>+ Acción</Button>
            </div>
            {f.actions.map((a, i) => (
              <div key={i} className="rounded-lg border border-border/40 p-3 mb-2 space-y-2">
                <div className="flex gap-2 items-center">
                  <Select value={a.type} onValueChange={v => updAction(i, "type", v)}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal_alert">Alerta interna</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setF(p => ({ ...p, actions: p.actions.filter((_, idx) => idx !== i) }))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {a.type === "internal_alert" && (
                  <div className="flex gap-2">
                    <Input placeholder="Título..." value={a.title || ""} onChange={e => updAction(i, "title", e.target.value)} className="text-xs h-8 flex-1" />
                    <Select value={a.severity || "info"} onValueChange={v => updAction(i, "severity", v)}>
                      <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Crítico</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(a.type === "email" || a.type === "whatsapp") && (
                  <div className="space-y-1">
                    <Input placeholder="Destinatario..." value={a.to || ""} onChange={e => updAction(i, "to", e.target.value)} className="text-xs h-8" />
                    {a.type === "email" && <Input placeholder="Asunto..." value={a.subject || ""} onChange={e => updAction(i, "subject", e.target.value)} className="text-xs h-8" />}
                    <Textarea placeholder="Mensaje..." value={a.message || a.body || ""} onChange={e => updAction(i, a.type === "email" ? "body" : "message", e.target.value)} rows={2} className="text-xs" />
                  </div>
                )}
                {a.type === "webhook" && (
                  <Input placeholder="https://..." value={a.url || ""} onChange={e => updAction(i, "url", e.target.value)} className="text-xs h-8" />
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cooldown (minutos)</Label>
              <Input type="number" min="0" value={f.cooldown_minutes} onChange={e => upd("cooldown_minutes", Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="rule-active" checked={f.active} onChange={e => upd("active", e.target.checked)} className="w-4 h-4" />
              <label htmlFor="rule-active" className="text-sm">Regla activa</label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar regla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NotificationRulesPage() {
  usePageTitle("Reglas de Notificación");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [rules, setRules] = useState<NotifRule[]>([]);
  const [logs, setLogs] = useState<NotifLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("rules");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotifRule | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [rulesData, logsData] = await Promise.all([
      supabase.from("notification_rules").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("notification_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100),
    ]);
    setRules((rulesData.data || []) as NotifRule[]);
    setLogs(logsData.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function seedDefaults() {
    setSeeding(true);
    await supabase.from("notification_rules").insert(DEFAULT_RULES.map(r => ({ ...r, org_id: orgId })));
    setSeeding(false);
    toast.success("Reglas de ejemplo creadas");
    loadData();
  }

  async function toggleActive(rule: NotifRule) {
    await supabase.from("notification_rules").update({ active: !rule.active }).eq("id", rule.id);
    loadData();
  }

  async function deleteRule(id: string) {
    if (!confirm("¿Eliminar esta regla?")) return;
    await supabase.from("notification_rules").delete().eq("id", id);
    toast.success("Regla eliminada");
    loadData();
  }

  const activeCount = rules.filter(r => r.active).length;
  const totalFires = rules.reduce((s, r) => s + r.fire_count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bell}
        title="Reglas de Notificación"
        description="Configurá alertas automáticas por email, WhatsApp, webhooks y más."
        actions={
          <>
            {rules.length === 0 && !loading && (
              <Button variant="outline" onClick={seedDefaults} disabled={seeding}>
                {seeding ? "Creando..." : "Cargar ejemplos"}
              </Button>
            )}
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nueva regla
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Reglas activas"    value={activeCount}   icon={Zap}         color="primary" />
        <KPICard label="Total reglas"      value={rules.length}  icon={Bell}        color="blue" />
        <KPICard label="Veces disparadas"  value={totalFires}    icon={TrendingUp}  color="warning" />
        <KPICard label="Notif. enviadas"   value={logs.length}   icon={CheckCircle2} color="success" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">Reglas ({rules.length})</TabsTrigger>
          <TabsTrigger value="log">Log de notificaciones ({logs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-2 pt-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Sin reglas. Cargá ejemplos o creá una.
            </div>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className={`rounded-xl border p-4 transition-all ${rule.active ? "border-border/50 bg-card" : "border-border/20 bg-muted/10 opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${rule.active ? "bg-emerald-400" : "bg-muted"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{rule.name}</p>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                        {TRIGGER_EVENTS[rule.trigger_event]?.label || rule.trigger_event}
                      </span>
                      {rule.channels.map(ch => {
                        const cfg = CHANNELS.find(c => c.value === ch);
                        return cfg ? (
                          <span key={ch} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            {cfg.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                    {rule.description && <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>Disparada {rule.fire_count}x</span>
                      {rule.last_fired_at && <span>Última: {fmtDate(rule.last_fired_at)}</span>}
                      {rule.cooldown_minutes > 0 && <span>Cooldown: {rule.cooldown_minutes}min</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive(rule)}
                      title={rule.active ? "Pausar" : "Activar"}>
                      {rule.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(rule); setFormOpen(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteRule(rule.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="log" className="pt-2">
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 bg-muted/20">
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left px-3 py-2.5">Evento</th>
                  <th className="text-left px-3 py-2.5">Canal</th>
                  <th className="text-left px-3 py-2.5 hidden md:table-cell">Destinatario</th>
                  <th className="text-left px-3 py-2.5 hidden md:table-cell">Asunto</th>
                  <th className="text-center px-3 py-2.5">Estado</th>
                  <th className="text-right px-3 py-2.5">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs">{TRIGGER_EVENTS[log.trigger_event]?.label || log.trigger_event}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{log.channel}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">{log.recipient || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell truncate max-w-32">{log.subject || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs font-medium ${STATUS_COLORS[log.status]}`}>{log.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">{fmtDate(log.created_at)}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Sin registros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <RuleForm open={formOpen} onClose={() => setFormOpen(false)}
        editing={editing} orgId={orgId} onSaved={loadData} />
    </div>
  );
}
