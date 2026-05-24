import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Plus,
  Edit,
  Trash2,
  Zap,
  Play,
  ShieldAlert,
  Timer,
  Bell,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SLAPolicy {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent" | "critical";
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only: boolean;
  active: boolean;
  created_at: string;
}

interface SLABreach {
  id: string;
  ticket_id: string | null;
  policy_id: string | null;
  breach_type: "first_response" | "resolution";
  due_at: string;
  breached_at: string;
  minutes_overdue: number;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

interface EscalationRule {
  id: string;
  policy_id: string | null;
  name: string;
  trigger_minutes: number;
  action_type: "notify" | "reassign" | "priority_bump" | "close";
  notify_email: string | null;
  notify_role: string | null;
  priority_bump_to: string | null;
  active: boolean;
}

interface SLATicketAssignment {
  id: string;
  ticket_id: string;
  policy_id: string;
  first_response_due_at: string;
  resolution_due_at: string;
  first_responded_at: string | null;
  resolved_at: string | null;
  first_response_met: boolean | null;
  resolution_met: boolean | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Baja", color: "bg-gray-500/15 text-gray-400" },
  normal: { label: "Normal", color: "bg-blue-500/15 text-blue-400" },
  high: { label: "Alta", color: "bg-amber-500/15 text-amber-400" },
  urgent: { label: "Urgente", color: "bg-orange-500/15 text-orange-400" },
  critical: { label: "Crítica", color: "bg-red-500/15 text-red-400" },
};

const ACTION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  notify: { label: "Notificar", icon: Bell, color: "text-blue-400" },
  reassign: { label: "Reasignar", icon: RefreshCw, color: "text-amber-400" },
  priority_bump: { label: "Subir prioridad", icon: TrendingUp, color: "text-orange-400" },
  close: { label: "Cerrar ticket", icon: XCircle, color: "text-red-400" },
};

function fmtMinutes(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Policy Form ──────────────────────────────────────────────────────────────

interface PolicyFormProps {
  open: boolean;
  policy: SLAPolicy | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function PolicyForm({ open, policy, orgId, onClose, onSaved }: PolicyFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [firstResponse, setFirstResponse] = useState("60");
  const [resolution, setResolution] = useState("480");
  const [businessHours, setBusinessHours] = useState(true);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (policy) {
      setName(policy.name); setDescription(policy.description ?? ""); setPriority(policy.priority);
      setFirstResponse(String(policy.first_response_minutes)); setResolution(String(policy.resolution_minutes));
      setBusinessHours(policy.business_hours_only); setActive(policy.active);
    } else {
      setName(""); setDescription(""); setPriority("normal"); setFirstResponse("60"); setResolution("480");
      setBusinessHours(true); setActive(true);
    }
  }, [policy, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId,
      name: name.trim(),
      description: description.trim() || null,
      priority,
      first_response_minutes: parseInt(firstResponse) || 60,
      resolution_minutes: parseInt(resolution) || 480,
      business_hours_only: businessHours,
      active,
    };
    const { error } = policy
      ? await supabase.from("sla_policies").update(payload).eq("id", policy.id)
      : await supabase.from("sla_policies").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error al guardar"); return; }
    toast.success(policy ? "Política actualizada" : "Política creada");
    onSaved();
    onClose();
  };

  const SLA_PRESETS = [
    { label: "Básico (4h / 24h)", fr: 240, res: 1440 },
    { label: "Estándar (1h / 8h)", fr: 60, res: 480 },
    { label: "Premium (30m / 4h)", fr: 30, res: 240 },
    { label: "Crítico (15m / 1h)", fr: 15, res: 60 },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{policy ? "Editar política SLA" : "Nueva política SLA"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap gap-2">
            {SLA_PRESETS.map(p => (
              <Button key={p.label} size="sm" variant="outline" onClick={() => { setFirstResponse(String(p.fr)); setResolution(String(p.res)); }}>
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: SLA Premium" />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prioridad aplicada</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div />
            <div>
              <Label>Primera respuesta (minutos)</Label>
              <Input type="number" value={firstResponse} onChange={e => setFirstResponse(e.target.value)} min="1" />
              <p className="text-xs text-muted-foreground mt-1">{fmtMinutes(parseInt(firstResponse) || 0)}</p>
            </div>
            <div>
              <Label>Resolución (minutos)</Label>
              <Input type="number" value={resolution} onChange={e => setResolution(e.target.value)} min="1" />
              <p className="text-xs text-muted-foreground mt-1">{fmtMinutes(parseInt(resolution) || 0)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="biz_hours" checked={businessHours} onChange={e => setBusinessHours(e.target.checked)} className="rounded" />
              <Label htmlFor="biz_hours">Solo horario laboral</Label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="pol_active" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
              <Label htmlFor="pol_active">Activa</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {policy ? "Guardar" : "Crear política"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Escalation Form ──────────────────────────────────────────────────────────

interface EscFormProps {
  open: boolean;
  rule: EscalationRule | null;
  policies: SLAPolicy[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function EscForm({ open, rule, policies, orgId, onClose, onSaved }: EscFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [policyId, setPolicyId] = useState("none");
  const [triggerMinutes, setTriggerMinutes] = useState("30");
  const [actionType, setActionType] = useState("notify");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyRole, setNotifyRole] = useState("none");
  const [priorityBumpTo, setPriorityBumpTo] = useState("none");

  useEffect(() => {
    if (rule) {
      setName(rule.name); setPolicyId(rule.policy_id ?? "none"); setTriggerMinutes(String(rule.trigger_minutes));
      setActionType(rule.action_type); setNotifyEmail(rule.notify_email ?? ""); setNotifyRole(rule.notify_role ?? "none");
      setPriorityBumpTo(rule.priority_bump_to ?? "none");
    } else {
      setName(""); setPolicyId("none"); setTriggerMinutes("30"); setActionType("notify");
      setNotifyEmail(""); setNotifyRole("none"); setPriorityBumpTo("none");
    }
  }, [rule, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId,
      policy_id: policyId === "none" ? null : policyId,
      name: name.trim(),
      trigger_minutes: parseInt(triggerMinutes) || 30,
      action_type: actionType,
      notify_email: notifyEmail.trim() || null,
      notify_role: notifyRole === "none" ? null : notifyRole,
      priority_bump_to: priorityBumpTo === "none" ? null : priorityBumpTo,
    };
    const { error } = rule
      ? await supabase.from("escalation_rules").update(payload).eq("id", rule.id)
      : await supabase.from("escalation_rules").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error al guardar"); return; }
    toast.success(rule ? "Regla actualizada" : "Regla creada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar escalación" : "Nueva regla de escalación"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Notificar admin urgente" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Política SLA</Label>
              <Select value={policyId} onValueChange={setPolicyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Todas</SelectItem>
                  {policies.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Disparar después de (min)</Label>
              <Input type="number" value={triggerMinutes} onChange={e => setTriggerMinutes(e.target.value)} min="1" />
              <p className="text-xs text-muted-foreground mt-1">{fmtMinutes(parseInt(triggerMinutes) || 0)} sin respuesta</p>
            </div>
          </div>
          <div>
            <Label>Acción</Label>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ACTION_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(actionType === "notify" || actionType === "reassign") && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email a notificar</Label>
                <Input type="email" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)} placeholder="admin@empresa.com" />
              </div>
              <div>
                <Label>Rol a notificar</Label>
                <Select value={notifyRole} onValueChange={setNotifyRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {actionType === "priority_bump" && (
            <div>
              <Label>Nueva prioridad</Label>
              <Select value={priorityBumpTo} onValueChange={setPriorityBumpTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {rule ? "Guardar" : "Crear regla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SLARulesPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [policies, setPolicies] = useState<SLAPolicy[]>([]);
  const [breaches, setBreaches] = useState<SLABreach[]>([]);
  const [escRules, setEscRules] = useState<EscalationRule[]>([]);
  const [assignments, setAssignments] = useState<SLATicketAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SLAPolicy | null>(null);
  const [escDialogOpen, setEscDialogOpen] = useState(false);
  const [editingEsc, setEditingEsc] = useState<EscalationRule | null>(null);
  const [checking, setChecking] = useState(false);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [polRes, brRes, escRes, assRes] = await Promise.all([
      supabase.from("sla_policies").select("*").eq("org_id", orgId).order("priority"),
      supabase.from("sla_breaches").select("*").eq("org_id", orgId).order("breached_at", { ascending: false }).limit(50),
      supabase.from("escalation_rules").select("*").eq("org_id", orgId).order("trigger_minutes"),
      supabase.from("sla_ticket_assignments").select("*").eq("org_id", orgId).order("resolution_due_at").limit(50),
    ]);
    setPolicies(polRes.data ?? []);
    setBreaches(brRes.data ?? []);
    setEscRules(escRes.data ?? []);
    setAssignments(assRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  const kpis = useMemo(() => {
    const openBreaches = breaches.filter(b => !b.resolved).length;
    const resolvedBreaches = breaches.filter(b => b.resolved).length;
    const atRisk = assignments.filter(a => !a.resolved_at && new Date(a.resolution_due_at) > new Date() && (new Date(a.resolution_due_at).getTime() - Date.now()) < 30 * 60 * 1000).length;
    const metSLA = assignments.filter(a => a.resolution_met === true).length;
    const total = assignments.filter(a => a.resolution_met !== null).length;
    const compliancePct = total > 0 ? Math.round((metSLA / total) * 100) : 100;
    return { openBreaches, resolvedBreaches, atRisk, compliancePct };
  }, [breaches, assignments]);

  const handleCheckBreaches = async () => {
    setChecking(true);
    const { data, error } = await supabase.rpc("check_sla_breaches", { p_org_id: orgId });
    setChecking(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(`Se detectaron ${data} incumplimientos`);
    loadAll();
  };

  const handleTogglePolicy = async (pol: SLAPolicy) => {
    await supabase.from("sla_policies").update({ active: !pol.active }).eq("id", pol.id);
    setPolicies(prev => prev.map(p => p.id === pol.id ? { ...p, active: !p.active } : p));
  };

  const handleDeletePolicy = async (pol: SLAPolicy) => {
    if (!confirm("¿Eliminar esta política?")) return;
    const { error } = await supabase.from("sla_policies").delete().eq("id", pol.id);
    if (error) { toast.error("No se pudo eliminar"); return; }
    setPolicies(prev => prev.filter(p => p.id !== pol.id));
    toast.success("Política eliminada");
  };

  const handleDeleteEsc = async (esc: EscalationRule) => {
    if (!confirm("¿Eliminar esta regla?")) return;
    await supabase.from("escalation_rules").delete().eq("id", esc.id);
    setEscRules(prev => prev.filter(e => e.id !== esc.id));
    toast.success("Regla eliminada");
  };

  const resolveBreachItem = async (breach: SLABreach) => {
    await supabase.from("sla_breaches").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", breach.id);
    setBreaches(prev => prev.map(b => b.id === breach.id ? { ...b, resolved: true, resolved_at: new Date().toISOString() } : b));
    toast.success("Incumplimiento marcado como resuelto");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Timer className="w-6 h-6 text-primary" />
            SLA & Escalaciones
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Políticas de tiempo de respuesta y escalación automática de tickets
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCheckBreaches} disabled={checking}>
            {checking ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Zap className="w-4 h-4 mr-1.5" />}
            Verificar SLA
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setEditingEsc(null); setEscDialogOpen(true); }}>
            <Bell className="w-4 h-4 mr-1.5" /> Nueva escalación
          </Button>
          <Button size="sm" onClick={() => { setEditingPolicy(null); setPolicyDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Nueva política
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Incumplimientos abiertos", value: kpis.openBreaches, icon: AlertTriangle, color: "text-red-400" },
          { label: "Resueltos", value: kpis.resolvedBreaches, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Por vencer (<30m)", value: kpis.atRisk, icon: Clock, color: "text-amber-400" },
          { label: "Cumplimiento SLA", value: `${kpis.compliancePct}%`, icon: ShieldAlert, color: kpis.compliancePct >= 90 ? "text-emerald-400" : kpis.compliancePct >= 70 ? "text-amber-400" : "text-red-400" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="policies">
        <TabsList>
          <TabsTrigger value="policies">Políticas SLA</TabsTrigger>
          <TabsTrigger value="escalations">Escalaciones</TabsTrigger>
          <TabsTrigger value="breaches" className="relative">
            Incumplimientos
            {kpis.openBreaches > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {kpis.openBreaches}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tickets">Tickets asignados</TabsTrigger>
        </TabsList>

        {/* ── Policies ── */}
        <TabsContent value="policies" className="mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{policies.filter(p => p.active).length} política{policies.filter(p => p.active).length !== 1 ? "s" : ""} activa{policies.filter(p => p.active).length !== 1 ? "s" : ""}</p>
          </div>
          {loading ? <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          : policies.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Timer className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin políticas SLA</p>
              <p className="text-sm">Creá tu primera política de tiempos de respuesta</p>
            </div>
          ) : policies.map(pol => {
            const pc = PRIORITY_CONFIG[pol.priority];
            return (
              <div key={pol.id} className={`p-4 rounded-xl border border-border bg-card flex items-start gap-4 transition-all ${!pol.active ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{pol.name}</h3>
                    <Badge className={`text-xs ${pc.color}`}>{pc.label}</Badge>
                    {!pol.active && <Badge className="text-xs bg-gray-500/15 text-gray-400">Inactiva</Badge>}
                    {pol.business_hours_only && <Badge className="text-xs bg-blue-500/15 text-blue-400">Horario laboral</Badge>}
                  </div>
                  {pol.description && <p className="text-xs text-muted-foreground mt-1">{pol.description}</p>}
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-muted-foreground">1ª respuesta:</span>
                      <span className="font-medium">{fmtMinutes(pol.first_response_minutes)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-muted-foreground">Resolución:</span>
                      <span className="font-medium">{fmtMinutes(pol.resolution_minutes)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => handleTogglePolicy(pol)}>
                    {pol.active ? <Trash2 className="w-3.5 h-3.5 opacity-50" /> : <Play className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingPolicy(pol); setPolicyDialogOpen(true); }}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeletePolicy(pol)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </TabsContent>

        {/* ── Escalations ── */}
        <TabsContent value="escalations" className="mt-4 space-y-3">
          {escRules.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin reglas de escalación</p>
            </div>
          ) : escRules.map(esc => {
            const ac = ACTION_CONFIG[esc.action_type];
            const ActionIcon = ac.icon;
            const relPolicy = policies.find(p => p.id === esc.policy_id);
            return (
              <div key={esc.id} className={`p-4 rounded-xl border border-border bg-card flex items-start gap-4 ${!esc.active ? "opacity-50" : ""}`}>
                <div className={`p-2 rounded-lg bg-muted`}>
                  <ActionIcon className={`w-4 h-4 ${ac.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm">{esc.name}</h3>
                    <Badge className="text-xs bg-muted text-muted-foreground">{ac.label}</Badge>
                    {relPolicy && <Badge className="text-xs bg-blue-500/15 text-blue-400">{relPolicy.name}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Disparar después de {fmtMinutes(esc.trigger_minutes)} sin respuesta
                    {esc.notify_email ? ` → ${esc.notify_email}` : ""}
                    {esc.notify_role ? ` → rol: ${esc.notify_role}` : ""}
                    {esc.priority_bump_to ? ` → prioridad: ${PRIORITY_CONFIG[esc.priority_bump_to]?.label}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingEsc(esc); setEscDialogOpen(true); }}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteEsc(esc)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </TabsContent>

        {/* ── Breaches ── */}
        <TabsContent value="breaches" className="mt-4 space-y-3">
          {breaches.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30 text-emerald-500" />
              <p className="font-medium">Sin incumplimientos registrados</p>
            </div>
          ) : breaches.map(b => {
            const relPolicy = policies.find(p => p.id === b.policy_id);
            return (
              <div key={b.id} className={`p-3 rounded-lg border flex items-center gap-3 ${b.resolved ? "border-border opacity-50" : "border-red-500/30 bg-red-500/5"}`}>
                <AlertTriangle className={`w-4 h-4 shrink-0 ${b.resolved ? "text-muted-foreground" : "text-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{b.breach_type === "first_response" ? "Primera respuesta" : "Resolución"}</span>
                    {b.resolved ? <Badge className="text-xs bg-emerald-500/15 text-emerald-400">Resuelto</Badge> : <Badge className="text-xs bg-red-500/15 text-red-400">Abierto</Badge>}
                    {relPolicy && <Badge className="text-xs bg-muted text-muted-foreground">{relPolicy.name}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {b.minutes_overdue}min de retraso · {formatDistanceToNow(new Date(b.breached_at), { addSuffix: true, locale: es })}
                  </p>
                </div>
                {!b.resolved && (
                  <Button size="sm" variant="outline" onClick={() => resolveBreachItem(b)}>
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolver
                  </Button>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* ── Ticket Assignments ── */}
        <TabsContent value="tickets" className="mt-4">
          {assignments.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Timer className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin tickets con SLA asignado</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Ticket</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">1ª Respuesta</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Resolución</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {assignments.map(a => {
                    const rDue = new Date(a.resolution_due_at);
                    const frDue = new Date(a.first_response_due_at);
                    const isResOverdue = !a.resolved_at && rDue < new Date();
                    const isFrOverdue = !a.first_responded_at && frDue < new Date();
                    return (
                      <tr key={a.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono text-xs">{a.ticket_id.slice(0, 8)}…</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {a.first_response_met === true ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : isFrOverdue ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <Clock className="w-3.5 h-3.5 text-blue-400" />}
                            <span className="text-xs">{format(frDue, "dd/MM HH:mm")}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {a.resolution_met === true ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : isResOverdue ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
                            <span className="text-xs">{format(rDue, "dd/MM HH:mm")}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {a.resolved_at ? (
                            <Badge className="text-xs bg-emerald-500/15 text-emerald-400">Resuelto</Badge>
                          ) : isResOverdue ? (
                            <Badge className="text-xs bg-red-500/15 text-red-400">Vencido</Badge>
                          ) : (
                            <Badge className="text-xs bg-blue-500/15 text-blue-400">En curso</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PolicyForm
        open={policyDialogOpen}
        policy={editingPolicy}
        orgId={orgId}
        onClose={() => { setPolicyDialogOpen(false); setEditingPolicy(null); }}
        onSaved={loadAll}
      />
      <EscForm
        open={escDialogOpen}
        rule={editingEsc}
        policies={policies}
        orgId={orgId}
        onClose={() => { setEscDialogOpen(false); setEditingEsc(null); }}
        onSaved={loadAll}
      />
    </div>
  );
}
