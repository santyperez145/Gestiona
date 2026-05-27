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
  Zap, TrendingUp, TrendingDown, Clock, BarChart3, Brain,
  Plus, Play, Settings, AlertTriangle, Target, DollarSign, RefreshCw
} from "lucide-react";

interface PricingRule {
  id: string;
  name: string;
  rule_type: string;
  priority: number;
  action: string;
  action_value: number;
  is_active: boolean;
  trigger_count: number;
  last_applied: string | null;
  condition_summary: string;
}

interface DemandSignal {
  product_name: string;
  sku: string;
  current_price: number;
  demand_score: number;
  trend: "up" | "down" | "stable";
  suggested_price: number;
  confidence: string;
}

interface PriceEvent {
  product_name: string;
  rule_name: string;
  original_price: number;
  adjusted_price: number;
  adjustment_pct: number;
  event_time: string;
  units_sold: number;
}

const RULE_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  time_of_day:   { label: "Hora del día",   icon: "⏰" },
  day_of_week:   { label: "Día de semana",  icon: "📅" },
  demand:        { label: "Demanda",         icon: "📈" },
  stock_level:   { label: "Nivel de stock", icon: "📦" },
  competitor:    { label: "Competencia",    icon: "👁️" },
  weather:       { label: "Clima",          icon: "🌤️" },
  event:         { label: "Evento",         icon: "🎉" },
  ai_optimized:  { label: "IA Optimizado",  icon: "🤖" },
};

const ACTION_LABELS: Record<string, string> = {
  pct_increase:      "+% aumento",
  pct_decrease:      "-% descuento",
  fixed_amount:      "Monto fijo",
  fixed_price:       "Precio fijo",
  match_competitor:  "Igualar competidor",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-800",
  low:    "bg-gray-100 text-gray-700",
};

const MOCK_RULES: PricingRule[] = [
  { id: "r1", name: "Happy Hour -15%", rule_type: "time_of_day", priority: 1, action: "pct_decrease", action_value: 15, is_active: true, trigger_count: 120, last_applied: "2026-05-27T18:00:00Z", condition_summary: "Lunes-Viernes 18:00-20:00" },
  { id: "r2", name: "Alta Demanda +10%", rule_type: "demand", priority: 2, action: "pct_increase", action_value: 10, is_active: true, trigger_count: 45, last_applied: "2026-05-27T12:30:00Z", condition_summary: "Demand score > 80" },
  { id: "r3", name: "Stock Bajo +5%", rule_type: "stock_level", priority: 3, action: "pct_increase", action_value: 5, is_active: true, trigger_count: 28, last_applied: "2026-05-26T09:00:00Z", condition_summary: "Stock < 10 unidades" },
  { id: "r4", name: "Precio IA Optimizado", rule_type: "ai_optimized", priority: 5, action: "pct_increase", action_value: 0, is_active: false, trigger_count: 0, last_applied: null, condition_summary: "Modelo ML cada 6 horas" },
  { id: "r5", name: "Fin de Semana -5%", rule_type: "day_of_week", priority: 4, action: "pct_decrease", action_value: 5, is_active: true, trigger_count: 62, last_applied: "2026-05-24T10:00:00Z", condition_summary: "Sábados y Domingos" },
];

const MOCK_DEMAND: DemandSignal[] = [
  { product_name: "Notebook Lenovo IdeaPad", sku: "NB-LP-001", current_price: 320_000, demand_score: 87, trend: "up", suggested_price: 352_000, confidence: "high" },
  { product_name: "Auriculares Sony WH-1000XM5", sku: "AU-SN-001", current_price: 105_000, demand_score: 65, trend: "stable", suggested_price: 110_250, confidence: "medium" },
  { product_name: "Monitor LG 27 IPS", sku: "MO-LG-001", current_price: 450_000, demand_score: 18, trend: "down", suggested_price: 405_000, confidence: "medium" },
  { product_name: "Teclado Mecánico Redragon", sku: "TC-RD-001", current_price: 32_000, demand_score: 72, trend: "up", suggested_price: 33_600, confidence: "high" },
  { product_name: "Mouse Logitech MX Master 3", sku: "MS-LG-001", current_price: 58_000, demand_score: 44, trend: "stable", suggested_price: 58_000, confidence: "low" },
];

const MOCK_EVENTS: PriceEvent[] = [
  { product_name: "Notebook Lenovo IdeaPad", rule_name: "Alta Demanda +10%", original_price: 320_000, adjusted_price: 352_000, adjustment_pct: 10, event_time: "2026-05-27T12:30:00Z", units_sold: 3 },
  { product_name: "Auriculares Sony WH-1000XM5", rule_name: "Happy Hour -15%", original_price: 105_000, adjusted_price: 89_250, adjustment_pct: -15, event_time: "2026-05-27T18:00:00Z", units_sold: 7 },
  { product_name: "Monitor LG 27 IPS", rule_name: "Stock Bajo +5%", original_price: 450_000, adjusted_price: 472_500, adjustment_pct: 5, event_time: "2026-05-26T09:00:00Z", units_sold: 1 },
];

export default function DynamicPricingPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"rules" | "demand" | "events" | "simulator">("rules");
  const [rules, setRules] = useState<PricingRule[]>(MOCK_RULES);
  const [showNew, setShowNew] = useState(false);
  const [simPrice, setSimPrice] = useState("100000");
  const [simDemand, setSimDemand] = useState("75");

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !r.is_active } : r));
  };

  const simSuggested = parseFloat(simDemand) > 80 ? parseFloat(simPrice) * 1.10
    : parseFloat(simDemand) < 20 ? parseFloat(simPrice) * 0.90
    : parseFloat(simPrice);
  const simRevChange = parseFloat(simDemand) > 80 ? 4.5
    : parseFloat(simDemand) < 20 ? 6.2
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="w-6 h-6 text-yellow-500" /> Precios Dinámicos</h1>
          <p className="text-muted-foreground text-sm mt-1">Reglas automáticas de precios por tiempo, demanda, stock e IA</p>
        </div>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Nueva Regla</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Crear Regla de Precio Dinámico</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Nombre</Label><Input placeholder="Ej: Promoción nocturna -20%" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Tipo</Label>
                  <Select defaultValue="time_of_day">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Prioridad</Label><Input type="number" defaultValue={10} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Acción</Label>
                  <Select defaultValue="pct_decrease">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor</Label><Input type="number" placeholder="15" /></div>
              </div>
              <Button className="w-full" onClick={() => { toast.success("Regla creada"); setShowNew(false); }}>Crear Regla</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-primary">{rules.filter(r => r.is_active).length}</p><p className="text-xs text-muted-foreground">Reglas Activas</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{rules.reduce((s, r) => s + r.trigger_count, 0)}</p><p className="text-xs text-muted-foreground">Total Disparos</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{MOCK_DEMAND.filter(d => d.demand_score > 50).length}</p><p className="text-xs text-muted-foreground">Alta Demanda</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-orange-600">{MOCK_EVENTS.length}</p><p className="text-xs text-muted-foreground">Ajustes Hoy</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="rules">Reglas</TabsTrigger>
          <TabsTrigger value="demand"><Brain className="w-3.5 h-3.5 mr-1" />Señales Demanda</TabsTrigger>
          <TabsTrigger value="events">Historial</TabsTrigger>
          <TabsTrigger value="simulator">Simulador</TabsTrigger>
        </TabsList>

        {/* RULES */}
        <TabsContent value="rules" className="space-y-3">
          {rules.sort((a, b) => a.priority - b.priority).map(rule => {
            const typeInfo = RULE_TYPE_LABELS[rule.rule_type] ?? { label: rule.rule_type, icon: "⚡" };
            return (
              <Card key={rule.id} className={!rule.is_active ? "opacity-50" : ""}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="text-2xl">{typeInfo.icon}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{rule.name}</span>
                      <Badge variant="outline" className="text-xs">P{rule.priority}</Badge>
                      <span className="text-xs text-muted-foreground">{typeInfo.label}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span>Acción: {ACTION_LABELS[rule.action]} {rule.action_value > 0 ? rule.action_value + "%" : ""}</span>
                      <span>Condición: {rule.condition_summary}</span>
                      <span>Disparos: {rule.trigger_count}</span>
                    </div>
                  </div>
                  <Switch checked={rule.is_active} onCheckedChange={() => toggleRule(rule.id)} />
                  <Button size="sm" variant="ghost" onClick={() => toast.info("Ejecutando regla manualmente...")}>
                    <Play className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* DEMAND */}
        <TabsContent value="demand" className="space-y-3">
          <p className="text-sm text-muted-foreground">Señales en tiempo real para ajuste automático de precios</p>
          {MOCK_DEMAND.map((d, i) => (
            <Card key={i}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{d.product_name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{d.sku}</span>
                    {d.trend === "up" && <TrendingUp className="w-4 h-4 text-green-500" />}
                    {d.trend === "down" && <TrendingDown className="w-4 h-4 text-red-500" />}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${d.demand_score > 70 ? "bg-green-500" : d.demand_score > 40 ? "bg-yellow-500" : "bg-red-400"}`} style={{ width: `${d.demand_score}%` }} />
                    </div>
                    <span className="text-xs font-medium">{d.demand_score} / 100</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground line-through">${d.current_price.toLocaleString()}</p>
                  <p className="font-bold text-primary">${d.suggested_price.toLocaleString()}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_COLORS[d.confidence]}`}>{d.confidence}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => toast.success(`Precio actualizado a $${d.suggested_price.toLocaleString()}`)}>
                  Aplicar
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* EVENTS */}
        <TabsContent value="events">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left py-3 px-4">Producto</th>
                    <th className="text-left py-3 px-4">Regla</th>
                    <th className="text-right py-3 px-4">Precio Orig.</th>
                    <th className="text-right py-3 px-4">Precio Ajust.</th>
                    <th className="text-right py-3 px-4">Variación</th>
                    <th className="text-right py-3 px-4">Unidades</th>
                    <th className="text-left py-3 px-4">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_EVENTS.map((ev, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4 font-medium">{ev.product_name}</td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">{ev.rule_name}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">${ev.original_price.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold">${ev.adjusted_price.toLocaleString()}</td>
                      <td className={`py-3 px-4 text-right font-medium ${ev.adjustment_pct > 0 ? "text-green-600" : "text-red-600"}`}>
                        {ev.adjustment_pct > 0 ? "+" : ""}{ev.adjustment_pct}%
                      </td>
                      <td className="py-3 px-4 text-right">{ev.units_sold}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{new Date(ev.event_time).toLocaleString("es-AR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SIMULATOR */}
        <TabsContent value="simulator">
          <Card className="max-w-md">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4" />Simulador de Precio Óptimo</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Precio Actual (ARS)</Label>
                <Input type="number" value={simPrice} onChange={e => setSimPrice(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Score de Demanda (0-100)</Label>
                <Input type="number" value={simDemand} onChange={e => setSimDemand(e.target.value)} min={0} max={100} className="mt-1" />
                <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
                  <div className={`h-full rounded-full ${parseFloat(simDemand) > 70 ? "bg-green-500" : parseFloat(simDemand) > 40 ? "bg-yellow-500" : "bg-red-400"}`} style={{ width: `${Math.min(parseFloat(simDemand) || 0, 100)}%` }} />
                </div>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Precio actual:</span>
                  <span className="font-medium">${parseFloat(simPrice || "0").toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Precio sugerido:</span>
                  <span className={`font-bold ${simSuggested > parseFloat(simPrice) ? "text-green-600" : simSuggested < parseFloat(simPrice) ? "text-red-600" : ""}`}>
                    ${simSuggested.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Impacto en revenue:</span>
                  <span className={`font-medium ${simRevChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {simRevChange >= 0 ? "+" : ""}{simRevChange.toFixed(1)}% estimado
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Confianza:</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${parseFloat(simDemand) > 60 ? CONFIDENCE_COLORS.high : parseFloat(simDemand) > 30 ? CONFIDENCE_COLORS.medium : CONFIDENCE_COLORS.low}`}>
                    {parseFloat(simDemand) > 60 ? "Alta" : parseFloat(simDemand) > 30 ? "Media" : "Baja"}
                  </span>
                </div>
              </div>
              <Button className="w-full" onClick={() => toast.success("Precio aplicado al producto")}>
                <Zap className="w-4 h-4 mr-2" />Aplicar Precio Sugerido
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
