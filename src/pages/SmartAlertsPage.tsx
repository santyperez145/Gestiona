import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Bell, AlertTriangle, CheckCircle, Info, Zap, Plus,
  Mail, MessageCircle, Webhook, Smartphone, Clock, Filter,
  XCircle, Eye, Settings, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import LegacyAlertRulesTab from "@/components/alerts/LegacyAlertRulesTab";

interface AlertRule {
  id: string;
  name: string;
  category: string;
  metric: string;
  condition_op: string;
  threshold: number;
  priority: string;
  channels: string[];
  cooldown_min: number;
  is_active: boolean;
  last_triggered: string | null;
  trigger_count: number;
}

interface AlertEvent {
  id: string;
  rule_name: string;
  category: string;
  priority: string;
  title: string;
  message: string;
  metric_value: number | null;
  threshold_value: number | null;
  acknowledged_at: string | null;
  created_at: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: typeof Bell }> = {
  critical: { label: "Crítico",  color: "bg-red-500/15 text-red-400 border-red-500/20",       icon: XCircle },
  high:     { label: "Alto",     color: "bg-orange-500/15 text-orange-400 border-orange-500/20", icon: AlertTriangle },
  medium:   { label: "Medio",    color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20", icon: Bell },
  low:      { label: "Bajo",     color: "bg-blue-500/15 text-blue-400 border-blue-500/20",   icon: Info },
  info:     { label: "Info",     color: "bg-muted/40 text-muted-foreground border-border/40", icon: Info },
};

const CHANNEL_ICONS: Record<string, { label: string; icon: typeof Bell }> = {
  app:      { label: "App",      icon: Bell },
  email:    { label: "Email",    icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  slack:    { label: "Slack",    icon: Zap },
  webhook:  { label: "Webhook",  icon: Webhook },
};


function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.info;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

export default function SmartAlertsPage() {
  usePageTitle("Alertas");
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState<"events" | "rules" | "legacy" | "config">("events");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", category: "stock", metric: "stock_level", condition_op: "lt", threshold: "0", priority: "medium" });

  useEffect(() => {
    if (!activeOrg) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [rulesRes, eventsRes] = await Promise.all([
          supabase
            .from("alert_rules")
            .select("id, name, category, metric, condition_op, threshold, priority, channels, cooldown_min, is_active, last_triggered, trigger_count")
            .eq("org_id", activeOrg.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("alert_events")
            .select("id, rule_name, category, priority, title, message, metric_value, threshold_value, acknowledged_at, created_at")
            .eq("org_id", activeOrg.id)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        setRules(
          (rulesRes.data ?? []).map(r => ({
            ...r,
            threshold: Number(r.threshold),
            last_triggered: r.last_triggered ?? null,
          }))
        );
        setEvents(
          (eventsRes.data ?? []).map(e => ({
            ...e,
            metric_value: e.metric_value !== null ? Number(e.metric_value) : null,
            threshold_value: e.threshold_value !== null ? Number(e.threshold_value) : null,
          }))
        );
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeOrg]);

  const unacked = events.filter(e => !e.acknowledged_at).length;

  const filteredEvents = events.filter(e =>
    (priorityFilter === "all" || e.priority === priorityFilter) &&
    (categoryFilter === "all" || e.category === categoryFilter)
  );

  const acknowledge = async (id: string) => {
    const now = new Date().toISOString();
    await supabase
      .from("alert_events")
      .update({ acknowledged_at: now, acknowledged_by: (await supabase.auth.getUser()).data.user?.id })
      .eq("id", id);
    setEvents(prev => prev.map(e => e.id === id ? { ...e, acknowledged_at: now } : e));
    toast.success("Alerta reconocida");
  };

  const toggleRule = async (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const newActive = !rule.is_active;
    await supabase
      .from("alert_rules")
      .update({ is_active: newActive })
      .eq("id", id);
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: newActive } : r));
  };

  const handleCreateRule = async () => {
    if (!newRule.name.trim()) { toast.error("Ingresá un nombre"); return; }
    if (!activeOrg) return;
    const payload = {
      org_id: activeOrg.id,
      name: newRule.name,
      category: newRule.category,
      metric: newRule.metric,
      condition_op: newRule.condition_op,
      threshold: parseFloat(newRule.threshold) || 0,
      priority: newRule.priority,
      channels: ["app"],
      cooldown_min: 60,
      is_active: true,
    };
    const { data, error } = await supabase
      .from("alert_rules")
      .insert(payload)
      .select()
      .single();
    if (error) { toast.error("Error al crear regla"); return; }
    setRules(prev => [{ ...data, threshold: Number(data.threshold), last_triggered: data.last_triggered ?? null }, ...prev]);
    toast.success("Regla creada");
    setShowNew(false);
  };

  const stats = {
    critical: events.filter(e => e.priority === "critical" && !e.acknowledged_at).length,
    high: events.filter(e => e.priority === "high" && !e.acknowledged_at).length,
    active_rules: rules.filter(r => r.is_active).length,
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Bell}
        title="Motor de Alertas Inteligentes"
        description="Reglas automáticas, notificaciones multicanal y gestión de incidentes"
        actions={
          <div className="flex items-center flex-wrap gap-2">
            {unacked > 0 && <Badge className="bg-destructive text-destructive-foreground">{unacked} sin reconocer</Badge>}
            <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />Nueva Regla</Button>
          </div>
        }
      />

      {/* New Rule Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Crear Regla de Alerta</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nombre</Label><Input value={newRule.name} onChange={e => setNewRule(n => ({ ...n, name: e.target.value }))} placeholder="Ej: Stock bajo de producto crítico" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Categoría</Label>
                <Select value={newRule.category} onValueChange={v => setNewRule(n => ({ ...n, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["stock","sales","financial","operations","customer","business","system"].map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Prioridad</Label>
                <Select value={newRule.priority} onValueChange={v => setNewRule(n => ({ ...n, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Crítico</SelectItem>
                    <SelectItem value="high">Alto</SelectItem>
                    <SelectItem value="medium">Medio</SelectItem>
                    <SelectItem value="low">Bajo</SelectItem>
                    <SelectItem value="info">Informativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Condición</Label>
                <Select value={newRule.condition_op} onValueChange={v => setNewRule(n => ({ ...n, condition_op: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lt">Menor que</SelectItem>
                    <SelectItem value="gt">Mayor que</SelectItem>
                    <SelectItem value="lte">Menor o igual</SelectItem>
                    <SelectItem value="gte">Mayor o igual</SelectItem>
                    <SelectItem value="eq">Igual a</SelectItem>
                    <SelectItem value="change_pct">Cambio % vs período anterior</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Umbral</Label><Input type="number" value={newRule.threshold} onChange={e => setNewRule(n => ({ ...n, threshold: e.target.value }))} /></div>
            </div>
            <Button className="w-full" onClick={handleCreateRule}>Crear Regla</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Críticas"       value={stats.critical}    icon={XCircle}      color="destructive" />
        <KPICard label="Altas"          value={stats.high}        icon={AlertTriangle} color="warning" />
        <KPICard label="Sin Reconocer"  value={unacked}           icon={Bell}          color="blue" />
        <KPICard label="Reglas Activas" value={stats.active_rules} icon={CheckCircle}  color="success" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="events" className="relative">
            Eventos
            {unacked > 0 && <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{unacked}</span>}
          </TabsTrigger>
          <TabsTrigger value="rules">Reglas</TabsTrigger>
          <TabsTrigger value="legacy">Reglas Clásicas</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        {/* EVENTS */}
        <TabsContent value="events" className="space-y-4 pb-12">
          <div className="flex gap-2">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Prioridad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {["stock","sales","financial","operations","customer"].map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {unacked > 0 && (
              <Button variant="outline" size="sm" onClick={async () => {
                const now = new Date().toISOString();
                if (activeOrg) {
                  await supabase
                    .from("alert_events")
                    .update({ acknowledged_at: now })
                    .eq("org_id", activeOrg.id)
                    .is("acknowledged_at", null);
                }
                setEvents(prev => prev.map(e => ({ ...e, acknowledged_at: e.acknowledged_at ?? now })));
                toast.success("Todas las alertas reconocidas");
              }}>Reconocer todas</Button>
            )}
          </div>
          <div className="space-y-2 pb-12">
            {filteredEvents.map(event => (
              <Card key={event.id} className={`${!event.acknowledged_at ? `border-l-4 ${event.priority === "critical" ? "border-l-red-500" : event.priority === "high" ? "border-l-orange-500" : "border-l-yellow-500"}` : "opacity-60"}`}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <PriorityBadge priority={event.priority} />
                      <span className="font-medium text-sm">{event.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{event.rule_name} · {new Date(event.created_at).toLocaleString("es-AR")}</p>
                    <p className="text-sm mt-1">{event.message}</p>
                    {event.metric_value !== null && event.threshold_value !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Valor actual: <strong>{event.metric_value}</strong> | Umbral: <strong>{event.threshold_value}</strong>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {!event.acknowledged_at && (
                      <Button size="sm" variant="outline" onClick={() => acknowledge(event.id)}>
                        <CheckCircle className="w-3 h-3 mr-1" />OK
                      </Button>
                    )}
                    {event.acknowledged_at && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />Reconocida
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredEvents.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No hay alertas que coincidan</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* RULES */}
        <TabsContent value="rules" className="space-y-3 pb-12">
          {rules.map(rule => (
            <Card key={rule.id} className={!rule.is_active ? "opacity-50" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                <Switch checked={rule.is_active} onCheckedChange={() => toggleRule(rule.id)} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{rule.name}</span>
                    <PriorityBadge priority={rule.priority} />
                    <span className="text-xs text-muted-foreground capitalize bg-muted px-1.5 py-0.5 rounded">{rule.category}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Métrica: {rule.metric}</span>
                    <span>Umbral: {rule.condition_op} {rule.threshold}</span>
                    <span>Cooldown: {rule.cooldown_min}min</span>
                    <span>Disparos: {rule.trigger_count}</span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {rule.channels.map(ch => {
                      const cfg = CHANNEL_ICONS[ch];
                      if (!cfg) return null;
                      const Icon = cfg.icon;
                      return <span key={ch} className="flex items-center gap-0.5 text-xs bg-muted px-1.5 py-0.5 rounded"><Icon className="w-3 h-3" />{cfg.label}</span>;
                    })}
                  </div>
                </div>
                {rule.last_triggered && (
                  <p className="text-xs text-muted-foreground text-right flex-shrink-0">
                    Último: {new Date(rule.last_triggered).toLocaleDateString("es-AR")}
                  </p>
                )}
                <Button size="sm" variant="ghost" onClick={() => toast.info("Editando regla...")}><Settings className="w-4 h-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* LEGACY — ported from the old /alertas page: expiry tracking + fixed-type rules */}
        <TabsContent value="legacy" className="pb-12">
          <LegacyAlertRulesTab />
        </TabsContent>

        {/* CONFIG */}
        <TabsContent value="config">
          <Card className="max-w-lg">
            <CardHeader><CardTitle className="text-base">Canales de Notificación</CardTitle></CardHeader>
            <CardContent className="space-y-4 pb-12">
              {Object.entries(CHANNEL_ICONS).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const isConfigured = key === "app" || key === "email";
                return (
                  <div key={key} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{cfg.label}</p>
                        <p className="text-xs text-muted-foreground">{isConfigured ? "Configurado" : "No configurado"}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => toast.info(`Configurando ${cfg.label}...`)}>
                      {isConfigured ? "Editar" : "Conectar"}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
