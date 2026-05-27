import { useState } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Bell, AlertTriangle, CheckCircle, Info, Zap, Plus,
  Mail, MessageCircle, Webhook, Smartphone, Clock, Filter,
  XCircle, Eye, Settings
} from "lucide-react";

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
  critical: { label: "Crítico",  color: "bg-red-100 text-red-700 border-red-300",    icon: XCircle },
  high:     { label: "Alto",     color: "bg-orange-100 text-orange-700 border-orange-300", icon: AlertTriangle },
  medium:   { label: "Medio",    color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: Bell },
  low:      { label: "Bajo",     color: "bg-blue-100 text-blue-700 border-blue-300",  icon: Info },
  info:     { label: "Info",     color: "bg-gray-100 text-gray-700 border-gray-300",  icon: Info },
};

const CHANNEL_ICONS: Record<string, { label: string; icon: typeof Bell }> = {
  app:      { label: "App",      icon: Bell },
  email:    { label: "Email",    icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  slack:    { label: "Slack",    icon: Zap },
  webhook:  { label: "Webhook",  icon: Webhook },
};

const MOCK_RULES: AlertRule[] = [
  { id: "r1", name: "Stock Crítico", category: "stock", metric: "stock_level", condition_op: "lt", threshold: 5, priority: "critical", channels: ["app", "email"], cooldown_min: 120, is_active: true, last_triggered: "2026-05-27T08:30:00Z", trigger_count: 12 },
  { id: "r2", name: "Caída de Ventas Diarias", category: "sales", metric: "daily_revenue", condition_op: "change_pct", threshold: -20, priority: "high", channels: ["app", "whatsapp"], cooldown_min: 1440, is_active: true, last_triggered: "2026-05-25T18:00:00Z", trigger_count: 3 },
  { id: "r3", name: "Factura Vencida", category: "financial", metric: "invoice_overdue_days", condition_op: "gt", threshold: 30, priority: "high", channels: ["app", "email"], cooldown_min: 1440, is_active: true, last_triggered: "2026-05-20T09:00:00Z", trigger_count: 7 },
  { id: "r4", name: "NPS Bajo", category: "customer", metric: "nps_score", condition_op: "lt", threshold: 30, priority: "medium", channels: ["app"], cooldown_min: 10080, is_active: true, last_triggered: null, trigger_count: 0 },
  { id: "r5", name: "Margen Bruto Bajo", category: "financial", metric: "gross_margin_pct", condition_op: "lt", threshold: 25, priority: "medium", channels: ["app", "email"], cooldown_min: 1440, is_active: false, last_triggered: null, trigger_count: 1 },
];

const MOCK_EVENTS: AlertEvent[] = [
  { id: "e1", rule_name: "Stock Crítico", category: "stock", priority: "critical", title: "Stock crítico: Notebook Lenovo IdeaPad", message: "Solo quedan 3 unidades en stock (umbral: 5). Reposición urgente requerida.", metric_value: 3, threshold_value: 5, acknowledged_at: null, created_at: "2026-05-27T09:15:00Z" },
  { id: "e2", rule_name: "Stock Crítico", category: "stock", priority: "critical", title: "Stock crítico: Auriculares Sony WH-1000XM5", message: "Solo quedan 2 unidades en stock (umbral: 5).", metric_value: 2, threshold_value: 5, acknowledged_at: null, created_at: "2026-05-27T08:30:00Z" },
  { id: "e3", rule_name: "Caída de Ventas Diarias", category: "sales", priority: "high", title: "Ventas cayeron 28% vs ayer", message: "Revenue del día: $245.000 vs $340.000 ayer (-28%).", metric_value: -28, threshold_value: -20, acknowledged_at: "2026-05-25T20:00:00Z", created_at: "2026-05-25T18:00:00Z" },
  { id: "e4", rule_name: "Factura Vencida", category: "financial", priority: "high", title: "Cliente Distribuidora Sur — factura 45 días vencida", message: "Factura FAC-001234 por $182.500 vencida hace 45 días.", metric_value: 45, threshold_value: 30, acknowledged_at: null, created_at: "2026-05-20T09:00:00Z" },
];

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
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"events" | "rules" | "config">("events");
  const [rules, setRules] = useState<AlertRule[]>(MOCK_RULES);
  const [events, setEvents] = useState<AlertEvent[]>(MOCK_EVENTS);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", category: "stock", metric: "stock_level", condition_op: "lt", threshold: "0", priority: "medium" });

  const unacked = events.filter(e => !e.acknowledged_at).length;

  const filteredEvents = events.filter(e =>
    (priorityFilter === "all" || e.priority === priorityFilter) &&
    (categoryFilter === "all" || e.category === categoryFilter)
  );

  const acknowledge = (id: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, acknowledged_at: new Date().toISOString() } : e));
    toast.success("Alerta reconocida");
  };

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !r.is_active } : r));
  };

  const handleCreateRule = () => {
    if (!newRule.name.trim()) { toast.error("Ingresá un nombre"); return; }
    setRules(prev => [...prev, {
      id: `r${Date.now()}`,
      name: newRule.name,
      category: newRule.category,
      metric: newRule.metric,
      condition_op: newRule.condition_op,
      threshold: parseFloat(newRule.threshold) || 0,
      priority: newRule.priority,
      channels: ["app"],
      cooldown_min: 60,
      is_active: true,
      last_triggered: null,
      trigger_count: 0,
    }]);
    toast.success("Regla creada");
    setShowNew(false);
  };

  const stats = {
    critical: events.filter(e => e.priority === "critical" && !e.acknowledged_at).length,
    high: events.filter(e => e.priority === "high" && !e.acknowledged_at).length,
    active_rules: rules.filter(r => r.is_active).length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-6 h-6 text-primary" /> Motor de Alertas Inteligentes</h1>
          <p className="text-muted-foreground text-sm mt-1">Reglas automáticas, notificaciones multicanal y gestión de incidentes</p>
        </div>
        <div className="flex items-center gap-2">
          {unacked > 0 && <Badge className="bg-red-500 text-white">{unacked} sin reconocer</Badge>}
          <Dialog open={showNew} onOpenChange={setShowNew}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Nueva Regla</Button></DialogTrigger>
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
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-red-200"><CardContent className="p-4 flex gap-3 items-center"><XCircle className="w-8 h-8 text-red-500" /><div><p className="text-xs text-muted-foreground">Críticas</p><p className="text-2xl font-bold text-red-600">{stats.critical}</p></div></CardContent></Card>
        <Card className="border-orange-200"><CardContent className="p-4 flex gap-3 items-center"><AlertTriangle className="w-8 h-8 text-orange-500" /><div><p className="text-xs text-muted-foreground">Altas</p><p className="text-2xl font-bold text-orange-600">{stats.high}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><Bell className="w-8 h-8 text-blue-500" /><div><p className="text-xs text-muted-foreground">Sin Reconocer</p><p className="text-2xl font-bold">{unacked}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><CheckCircle className="w-8 h-8 text-green-500" /><div><p className="text-xs text-muted-foreground">Reglas Activas</p><p className="text-2xl font-bold">{stats.active_rules}</p></div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="events" className="relative">
            Eventos
            {unacked > 0 && <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{unacked}</span>}
          </TabsTrigger>
          <TabsTrigger value="rules">Reglas</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        {/* EVENTS */}
        <TabsContent value="events" className="space-y-4">
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
              <Button variant="outline" size="sm" onClick={() => {
                setEvents(prev => prev.map(e => ({ ...e, acknowledged_at: e.acknowledged_at ?? new Date().toISOString() })));
                toast.success("Todas las alertas reconocidas");
              }}>Reconocer todas</Button>
            )}
          </div>
          <div className="space-y-2">
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
        <TabsContent value="rules" className="space-y-3">
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

        {/* CONFIG */}
        <TabsContent value="config">
          <Card className="max-w-lg">
            <CardHeader><CardTitle className="text-base">Canales de Notificación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
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
