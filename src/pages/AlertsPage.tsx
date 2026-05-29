import { useState, useEffect, useCallback, useMemo } from "react";
import { safeChannel } from "@/lib/realtimeChannel";
import {
  Bell, Package, AlertTriangle, DollarSign, Users, TrendingDown,
  RefreshCw, CheckCheck, ToggleLeft, ToggleRight, Save, Play,
  Clock, Zap, Info, ShieldCheck, CalendarX2, Mail, ChevronDown, ChevronUp,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { useProductExpiry } from "@/hooks/useProductExpiry";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { usePageTitle } from "@/hooks/usePageTitle";

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
  product_expiry: {
    label: "Productos por vencer",
    description: "Avisa cuando productos con stock tienen fecha de vencimiento próxima.",
    icon: CalendarX2,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    thresholdLabel: "Días de anticipación",
    thresholdUnit: "días",
    useDays: true,
    daysLabel: "días antes de vencer",
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
  usePageTitle("Alertas");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const orgId = activeOrg?.id;

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<AlertRule>>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [showExpiryPanel, setShowExpiryPanel] = useState(true);
  const { expired, critical, warning, totalAtRisk } = useProductExpiry(products);

  // Per-rule email notification prefs (localStorage per org)
  const emailPrefKey = `gestiona.alert_email.${orgId || 'default'}`;
  const [emailPrefs, setEmailPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(emailPrefKey) || '{}'); } catch { return {}; }
  });
  const toggleEmailPref = (ruleId: string) => {
    const next = { ...emailPrefs, [ruleId]: !emailPrefs[ruleId] };
    setEmailPrefs(next);
    localStorage.setItem(emailPrefKey, JSON.stringify(next));
    toast.success(next[ruleId] ? 'Recibirás email cuando se dispare esta alerta' : 'Notificación por email desactivada');
  };

  // ─── Load products for expiry ─────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("products")
      .select("id,name,stock,expiry_date,lot_number,category")
      .eq("org_id", orgId)
      .not("expiry_date", "is", null)
      .then(({ data }) => setProducts(data || []));
  }, [orgId]);

  // ─── Load ────────────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("alert_rules")
      .select("*")
      .eq("org_id", orgId)
      .order("type");
    setRules((data as AlertRule[]) ?? []);
  }, [orgId]);

  const [historialTypeFilter, setHistorialTypeFilter] = useState("all");

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(80);
    setNotifications((data as Notification[]) ?? []);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRules(), loadNotifications()]).finally(() => setLoading(false));
  }, [loadRules, loadNotifications]);

  // ─── Realtime ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    const ch = safeChannel("alerts-notif-rt", user.id)
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
    const { error } = await supabase
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
    const { error } = await supabase
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

  const activeRules = rules.filter(r => r.enabled).length;
  const firedToday = rules.filter(r => r.last_triggered_at && new Date(r.last_triggered_at) > new Date(Date.now() - 86400000)).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        icon={Zap}
        title="Alertas inteligentes"
        description="Configurá qué situaciones te notificamos automáticamente cada día a las 07:00 UTC."
        badge={{ label: `${activeRules} activa${activeRules !== 1 ? 's' : ''}`, variant: activeRules > 0 ? "success" : "default" }}
        actions={
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1.5">
                <CheckCheck className="w-4 h-4" />
                Marcar leídas ({unreadCount})
              </Button>
            )}
            <Button onClick={runCheck} disabled={running} size="sm" className="gradient-gold text-primary-foreground gap-1.5">
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? "Revisando..." : "Revisar ahora"}
            </Button>
          </div>
        }
      />

      {/* Expiring Products Live Panel */}
      {totalAtRisk > 0 && (
        <div className="bg-card border border-rose-500/20 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowExpiryPanel(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-rose-500/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CalendarX2 className="w-4 h-4 text-rose-400" />
              <span className="text-sm font-semibold">Productos por vencer o vencidos</span>
              <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 text-[10px] font-bold">{totalAtRisk} con stock</span>
              {expired.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 text-[10px] font-bold animate-pulse">{expired.length} VENCIDOS</span>
              )}
            </div>
            {showExpiryPanel ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showExpiryPanel && (
            <div className="border-t border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Producto</th>
                    <th className="px-4 py-2 text-right text-xs text-muted-foreground font-medium">Stock</th>
                    <th className="px-4 py-2 text-right text-xs text-muted-foreground font-medium">Vence</th>
                    <th className="px-4 py-2 text-center text-xs text-muted-foreground font-medium">Estado</th>
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium hidden sm:table-cell">Lote</th>
                  </tr>
                </thead>
                <tbody>
                  {[...expired, ...critical, ...warning].filter(p => p.stock > 0).map(p => {
                    const isExpired = p.urgency === "expired";
                    const isCritical = p.urgency === "critical";
                    return (
                      <tr key={p.id} className={`border-b border-border/30 last:border-0 hover:bg-muted/20 ${isExpired ? "bg-red-500/5" : isCritical ? "bg-orange-500/5" : ""}`}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-sm truncate max-w-[180px]">{p.name}</p>
                          {p.lot_number && <p className="text-[10px] text-muted-foreground sm:hidden">Lote: {p.lot_number}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">{p.stock}</td>
                        <td className={`px-4 py-2.5 text-right text-sm font-semibold ${isExpired ? "text-red-400" : isCritical ? "text-orange-400" : "text-yellow-400"}`}>
                          {p.expiryLabel}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            isExpired ? "bg-red-500/15 text-red-400" :
                            isCritical ? "bg-orange-500/15 text-orange-400" :
                            "bg-yellow-500/15 text-yellow-400"
                          }`}>
                            {isExpired ? `Venció hace ${Math.abs(p.daysUntil)}d` : isCritical ? `${p.daysUntil}d` : `${p.daysUntil}d`}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                          {p.lot_number || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border/60 rounded-[10px] p-4 text-center">
          <p className="text-2xl font-bold font-mono tracking-tight font-display text-primary">{activeRules}</p>
          <p className="text-xs text-muted-foreground mt-1">Reglas activas</p>
        </div>
        <div className="bg-card border border-border/60 rounded-[10px] p-4 text-center">
          <p className="text-2xl font-bold font-mono tracking-tight font-display text-warning">{firedToday}</p>
          <p className="text-xs text-muted-foreground mt-1">Disparadas hoy</p>
        </div>
        <div className="bg-card border border-border/60 rounded-[10px] p-4 text-center">
          <p className="text-2xl font-bold font-mono tracking-tight font-display text-destructive">{unreadCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Sin leer</p>
        </div>
      </div>

      {/* Rules grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Reglas configuradas
        </h2>
        <div className="grid gap-3">
          {Object.entries(RULE_CONFIG).map(([type, cfg]) => {
            const rule = rules.find(r => r.type === type);

            // Rule doesn't exist in DB yet — show a create button
            if (!rule) {
              const Icon = cfg.icon;
              return (
                <div key={type} className="rounded-xl border border-dashed border-border p-4 flex items-center gap-3 opacity-60">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{cfg.label}</span>
                    <p className="text-xs text-muted-foreground">{cfg.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0"
                    onClick={async () => {
                      if (!orgId) return;
                      await supabase.from("alert_rules").insert({
                        org_id: orgId,
                        type,
                        threshold_value: cfg.useDays ? 0 : 5,
                        threshold_days: cfg.useDays ? 30 : 0,
                        enabled: true,
                      });
                      loadRules();
                      toast.success("Regla creada");
                    }}
                  >
                    + Crear
                  </Button>
                </div>
              );
            }
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

                  {/* Email toggle + main toggle */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      onClick={() => toggleEmailPref(rule.id)}
                      title={emailPrefs[rule.id] ? 'Email activado — click para desactivar' : 'Activar notificación por email'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-[5px] text-[10px] font-semibold border transition-all ${
                        emailPrefs[rule.id]
                          ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                          : 'bg-muted/30 border-border/40 text-muted-foreground hover:border-border hover:text-foreground'
                      }`}
                    >
                      <Mail className="w-3 h-3" />
                      <span className="hidden sm:inline">Email</span>
                    </button>
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

      {/* Notification history — enhanced table */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            Historial de alertas
            {unreadCount > 0 && (
              <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">
                {unreadCount} nuevas
              </Badge>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {/* Type filter */}
            {(() => {
              const types = [...new Set(notifications.map(n => n.type))];
              if (types.length < 2) return null;
              return (
                <select
                  value={historialTypeFilter}
                  onChange={e => setHistorialTypeFilter(e.target.value)}
                  className="bg-card border border-border/60 rounded-lg px-2 py-1 text-xs text-foreground"
                >
                  <option value="all">Todos los tipos</option>
                  {types.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              );
            })()}
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="gap-1 text-xs h-7">
                <CheckCheck className="w-3 h-3" /> Leídas
              </Button>
            )}
          </div>
        </div>

        {/* Summary stats by type */}
        {notifications.length > 0 && (() => {
          const byType: Record<string, number> = {};
          notifications.forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
          const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
          return (
            <div className="flex flex-wrap gap-2 mb-3">
              {entries.map(([type, count]) => {
                const Icon = NOTIF_ICON[type] ?? Bell;
                return (
                  <button key={type} onClick={() => setHistorialTypeFilter(prev => prev === type ? 'all' : type)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${historialTypeFilter === type ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'}`}>
                    <Icon className="w-3 h-3" />
                    {type.replace(/_/g, ' ')} <span className="font-bold tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Table */}
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          {(() => {
            const visibleNotifs = historialTypeFilter === 'all'
              ? notifications
              : notifications.filter(n => n.type === historialTypeFilter);
            if (visibleNotifs.length === 0) return (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {notifications.length === 0
                    ? 'Sin alertas registradas — hacé clic en "Revisar ahora" para ejecutar una revisión.'
                    : 'Sin alertas para este tipo.'}
                </p>
              </div>
            );
            return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-8"></th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Alerta</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Tipo</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Cuándo</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-8">●</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleNotifs.slice(0, 50).map(n => {
                    const Icon = NOTIF_ICON[n.type] ?? Bell;
                    const cfg = Object.values(RULE_CONFIG).find(c => {
                      if (n.type === "stock_bajo") return c.label === "Stock bajo";
                      if (n.type === "deuda_vencida") return c.label === "Deudas vencidas";
                      return false;
                    });
                    const color = cfg?.color ?? "text-muted-foreground";
                    return (
                      <tr key={n.id} className={`transition-colors hover:bg-muted/10 ${n.read ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5">
                          <Icon className={`w-4 h-4 ${color}`} />
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-sm leading-tight">{n.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{n.message}</p>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          <span className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground font-mono">{n.type.replace(/_/g, ' ')}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-muted-foreground hidden sm:table-cell">
                          <span title={new Date(n.created_at).toLocaleString('es-AR')}>
                            {formatDistanceToNow(new Date(n.created_at), { locale: es, addSuffix: true })}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {!n.read && <div className="w-2 h-2 rounded-full bg-primary mx-auto" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>

      {/* Alert rules fire log */}
      {rules.some(r => r.last_triggered_at) && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Última vez disparadas</h2>
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Alerta</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Tipo</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Última vez</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {[...rules].filter(r => r.last_triggered_at).sort((a, b) =>
                  new Date(b.last_triggered_at!).getTime() - new Date(a.last_triggered_at!).getTime()
                ).map(r => {
                  const cfg = RULE_CONFIG[r.type] || { label: r.type, color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border", icon: Bell };
                  const Icon = cfg.icon;
                  const firedAt = new Date(r.last_triggered_at!);
                  const wasToday = firedAt > new Date(Date.now() - 86400000);
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                          <span className="font-medium text-xs">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className="text-xs text-muted-foreground">{cfg.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {formatDistanceToNow(firedAt, { locale: es, addSuffix: true })}
                      </td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell">
                        {wasToday
                          ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning font-semibold">Hoy</span>
                          : <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Anterior</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
