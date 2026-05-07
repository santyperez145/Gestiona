import { useState, useEffect, useCallback } from "react";
import {
  Bell, Package, AlertTriangle, DollarSign, Users, TrendingDown,
  RefreshCw, CheckCheck, ToggleLeft, ToggleRight, Save, Play,
  Clock, Zap, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertRule {
  id: string;
  type: string;
  enabled: boolean;
  threshold_value: number;
  threshold_days: number;
  last_run_at: string | null;
  last_triggered_at: string | null;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const RULE_CONFIG: Record<string, {
  label: string;
  description: string;
  icon: typeof Bell;
  color: string;
  bg: string;
  border: string;
  thresholdLabel: string;
  thresholdUnit: string;
  useDays: boolean;
  daysLabel?: string;
}> = {
  stock_low: {
    label: "Stock bajo",
    description: "Avisa cuando un producto tiene pocas unidades disponibles.",
    icon: Package,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    thresholdLabel: "Umbral de stock",
    thresholdUnit: "unidades",
    useDays: false,
  },
  low_margin: {
    label: "Margen bajo",
    description: "Alerta cuando el margen de ganancia de un producto es muy bajo.",
    icon: TrendingDown,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    thresholdLabel: "Margen mínimo",
    thresholdUnit: "%",
    useDays: false,
  },
  debt_overdue: {
    label: "Deudas vencidas",
    description: "Notifica cuando una deuda de cliente lleva ciertos días sin cobrarse.",
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    thresholdLabel: "Días de gracia",
    thresholdUnit: "días",
    useDays: true,
    daysLabel: "días sin cobrar",
  },
  customer_inactive: {
    label: "Clientes inactivos",
    description: "Avisa cuando un cliente no realiza compras en mucho tiempo.",
    icon: Users,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    thresholdLabel: "Días sin comprar",
    thresholdUnit: "días",
    useDays: true,
    daysLabel: "días sin compras",
  },
  high_expense: {
    label: "Gastos elevados",
    description: "Alerta cuando los gastos del mes superan un monto máximo.",
    icon: DollarSign,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    thresholdLabel: "Límite mensual",
    thresholdUnit: "ARS",
    useDays: false,
  },
};

const NOTIF_ICON: Record<string, typeof Bell> = {
  stock_bajo: Package,
  deuda_vencida: AlertTriangle,
  venta_grande: DollarSign,
  tiendanube: Bell,
  sistema: Info,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const orgId = activeOrg?.id;

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<AlertRule>>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // ─── Load ────────────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("alert_rules" as any)
      .select("*")
      .eq("org_id", orgId)
      .order("type");
    setRules((data as AlertRule[]) ?? []);
  }, [orgId]);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .in("type", ["stock_bajo", "deuda_vencida", "sistema"])
      .order("created_at", { ascending: false })
      .limit(40);
    setNotifications((data as Notification[]) ?? []);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRules(), loadNotifications()]).finally(() => setLoading(false));
  }, [loadRules, loadNotifications]);

  // ─── Realtime ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("alerts-notif-rt")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const n = payload.new as Notification;
        if (["stock_bajo", "deuda_vencida", "sistema"].includes(n.type)) {
          setNotifications(prev => [n, ...prev].slice(0, 40));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // ─── Edit helpers ────────────────────────────────────────────────────────

  const getEdit = (rule: AlertRule) => ({ ...rule, ...(edits[rule.id] ?? {}) });

  const updateEdit = (id: string, patch: Partial<AlertRule>) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  };

  const saveRule = async (rule: AlertRule) => {
    const patch = edits[rule.id];
    if (!patch) return;
    setSaving(rule.id);
    const { error } = await (supabase as any)
      .from("alert_rules")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    if (error) {
      toast.error("Error al guardar la regla");
    } else {
      toast.success("Regla guardada");
      setEdits(prev => { const n = { ...prev }; delete n[rule.id]; return n; });
      loadRules();
    }
    setSaving(null);
  };

  const toggleRule = async (rule: AlertRule) => {
    const newVal = !rule.enabled;
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: newVal } : r));
    const { error } = await (supabase as any)
      .from("alert_rules")
      .update({ enabled: newVal, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    if (error) {
      toast.error("Error al actualizar");
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !newVal } : r));
    }
  };

  // ─── Run check now ────────────────────────────────────────────────────────

  const runCheck = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("check-alerts", { body: {} });
      if (error) throw error;
      toast.success("Revisión completada — recargando notificaciones");
      setTimeout(() => { loadRules(); loadNotifications(); }, 1500);
    } catch {
      toast.error("Error al ejecutar la revisión");
    }
    setRunning(false);
  };

  // ─── Mark all read ────────────────────────────────────────────────────────

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    toast.success("Todas marcadas como leídas");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const unreadCount = notifications.filter(n => !n.read).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            Alertas inteligentes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá qué situaciones te notificamos automáticamente cada día.
          </p>
        </div>
        <Button onClick={runCheck} disabled={running} size="sm" className="gap-2">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? "Revisando..." : "Revisar ahora"}
        </Button>
      </div>

      {/* Rules grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Reglas configuradas
        </h2>
        <div className="grid gap-3">
          {Object.entries(RULE_CONFIG).map(([type, cfg]) => {
            const rule = rules.find(r => r.type === type);
            if (!rule) return null;
            const e = getEdit(rule);
            const hasChanges = !!edits[rule.id];
            const Icon = cfg.icon;

            return (
              <div
                key={type}
                className={`rounded-xl border p-4 transition-all ${
                  rule.enabled
                    ? `${cfg.bg} ${cfg.border}`
                    : "bg-muted/20 border-border opacity-60"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm">{cfg.label}</span>
                      {rule.last_triggered_at && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          <Clock className="w-2.5 h-2.5 mr-1" />
                          {formatDistanceToNow(new Date(rule.last_triggered_at), { locale: es, addSuffix: true })}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{cfg.description}</p>

                    {/* Threshold inputs */}
                    {rule.enabled && (
                      <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {cfg.useDays ? (
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                              {cfg.daysLabel ?? "días"}:
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              value={e.threshold_days}
                              onChange={ev => updateEdit(rule.id, { threshold_days: Number(ev.target.value) })}
                              className="w-20 h-7 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{cfg.thresholdUnit}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                              {cfg.thresholdLabel}:
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              value={e.threshold_value}
                              onChange={ev => updateEdit(rule.id, { threshold_value: Number(ev.target.value) })}
                              className="w-24 h-7 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{cfg.thresholdUnit}</span>
                          </div>
                        )}

                        {hasChanges && (
                          <Button
                            size="sm"
                            onClick={() => saveRule(rule)}
                            disabled={saving === rule.id}
                            className="h-7 text-xs gap-1"
                          >
                            {saving === rule.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Guardar
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Last run */}
                    {rule.last_run_at && (
                      <p className="text-[10px] text-muted-foreground/60 mt-2">
                        Última revisión:{" "}
                        {formatDistanceToNow(new Date(rule.last_run_at), { locale: es, addSuffix: true })}
                      </p>
                    )}
                  </div>

                  {/* Toggle */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {rule.enabled
                      ? <ToggleRight className={`w-4 h-4 ${cfg.color}`} />
                      : <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                    }
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => toggleRule(rule)}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {rules.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No hay reglas configuradas</p>
            </div>
          )}
        </div>
      </div>

      {/* Notification history */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Historial de alertas
            {unreadCount > 0 && (
              <Badge className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0">
                {unreadCount} nuevas
              </Badge>
            )}
          </h2>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="gap-1 text-xs h-7">
              <CheckCheck className="w-3 h-3" /> Marcar todas como leídas
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {notifications.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Sin alertas recientes — hacé clic en "Revisar ahora" para ejecutar una revisión.
              </p>
            </div>
          )}

          {notifications.map(n => {
            const Icon = NOTIF_ICON[n.type] ?? Bell;
            const cfg = Object.values(RULE_CONFIG).find(c => {
              if (n.type === "stock_bajo") return c.label === "Stock bajo";
              if (n.type === "deuda_vencida") return c.label === "Deudas vencidas";
              return false;
            });
            const color = cfg?.color ?? "text-muted-foreground";
            const bg = cfg?.bg ?? "bg-muted/30";
            const border = cfg?.border ?? "border-border";

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
                  n.read ? "opacity-60 bg-muted/10 border-border" : `${bg} ${border}`
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { locale: es, addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
