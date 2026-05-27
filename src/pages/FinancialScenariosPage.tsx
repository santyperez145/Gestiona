import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp, BarChart2, Plus, Calculator, DollarSign,
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  Layers, Target, Zap
} from "lucide-react";

interface Scenario {
  id: string;
  name: string;
  scenario_type: string;
  start_date: string;
  end_date: string;
  is_baseline: boolean;
  assumptions: { inflation_rate?: number; growth_rate?: number };
  description: string | null;
}

interface LineItem {
  id: string;
  scenario_id: string;
  category: string;
  name: string;
  sort_order: number;
  is_subtotal: boolean;
  values: Record<string, number>;
}

interface BreakevenResult {
  fixedCosts: number;
  variableCostPct: number;
  avgPrice: number;
  avgUnitCost: number;
  contributionMarginPct: number;
  breakevenRevenue: number;
  breakevenUnits: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  revenue:        "text-green-700 bg-green-50",
  cogs:           "text-orange-700 bg-orange-50",
  gross_profit:   "text-blue-700 bg-blue-50",
  opex:           "text-red-700 bg-red-50",
  ebitda:         "text-purple-700 bg-purple-50",
  net_income:     "text-emerald-700 bg-emerald-50",
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function genKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2,"0")}`;
}


function PnLTable({ items }: { items: LineItem[] }) {
  const visibleMonths = MONTHS.slice(0, 6).map((_, i) => genKey(2026, i + 1));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 font-semibold text-sm w-40">Ítem</th>
            {visibleMonths.map(m => <th key={m} className="text-right py-2 px-2 font-medium">{MONTHS[parseInt(m.slice(-2)) - 1]}</th>)}
            <th className="text-right py-2 px-2 font-semibold">Total H1</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const total = visibleMonths.reduce((sum, m) => sum + (item.values[m] ?? 0), 0);
            const isNeg = item.category === "cogs" || item.category === "opex";
            return (
              <tr key={item.id} className={`border-b last:border-0 ${item.is_subtotal ? "font-semibold bg-muted/30" : ""}`}>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[item.category] ?? ""}`}>
                      {item.category.toUpperCase()}
                    </span>
                    <span>{item.name}</span>
                  </div>
                </td>
                {visibleMonths.map(m => (
                  <td key={m} className={`text-right py-2 px-2 ${(item.values[m] ?? 0) < 0 ? "text-red-600" : ""}`}>
                    {((item.values[m] ?? 0) / 1000).toFixed(0)}K
                  </td>
                ))}
                <td className={`text-right py-2 px-2 font-semibold ${total < 0 ? "text-red-600" : ""}`}>
                  {(total / 1000).toFixed(0)}K
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BreakevenCalc() {
  const [fixedCosts, setFixedCosts] = useState(120000);
  const [variableCostPct, setVariableCostPct] = useState(45);
  const [avgPrice, setAvgPrice] = useState(15000);
  const [avgUnitCost, setAvgUnitCost] = useState(6750);

  const contributionMarginPct = avgPrice > 0 ? (1 - variableCostPct / 100 - avgUnitCost / avgPrice) * 100 : 0;
  const breakevenRevenue = variableCostPct < 100 ? fixedCosts / (1 - variableCostPct / 100) : 0;
  const breakevenUnits = avgPrice > avgUnitCost ? fixedCosts / (avgPrice - avgUnitCost) : 0;

  const safetyMargin = ((500000 - breakevenRevenue) / 500000 * 100);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Costos Fijos Mensuales (ARS)</Label>
          <Input type="number" value={fixedCosts} onChange={e => setFixedCosts(Number(e.target.value))} className="mt-1" />
        </div>
        <div>
          <Label>% Costo Variable sobre Ventas</Label>
          <Input type="number" value={variableCostPct} onChange={e => setVariableCostPct(Number(e.target.value))} min={0} max={99} className="mt-1" />
        </div>
        <div>
          <Label>Precio Promedio por Unidad (ARS)</Label>
          <Input type="number" value={avgPrice} onChange={e => setAvgPrice(Number(e.target.value))} className="mt-1" />
        </div>
        <div>
          <Label>Costo Variable por Unidad (ARS)</Label>
          <Input type="number" value={avgUnitCost} onChange={e => setAvgUnitCost(Number(e.target.value))} className="mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-blue-600 font-medium mb-1">Margen de Contribución</p>
            <p className="text-3xl font-bold text-blue-700">{contributionMarginPct.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-purple-600 font-medium mb-1">Punto de Equilibrio (ARS)</p>
            <p className="text-2xl font-bold text-purple-700">${breakevenRevenue.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-emerald-600 font-medium mb-1">Unidades de Equilibrio</p>
            <p className="text-3xl font-bold text-emerald-700">{Math.ceil(breakevenUnits).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Visual breakeven chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Margen de Seguridad</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>$0</span>
              <span className="text-purple-600">Equilibrio: ${(breakevenRevenue / 1000).toFixed(0)}K</span>
              <span>Ventas Act.: $500K</span>
            </div>
            <div className="h-4 bg-muted rounded-full overflow-hidden flex">
              <div className="bg-red-400 h-full" style={{ width: `${Math.min((breakevenRevenue / 500000) * 100, 100)}%` }} />
              <div className="bg-green-400 h-full flex-1" />
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Margen de seguridad: <span className={safetyMargin > 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{safetyMargin.toFixed(1)}%</span>
              {safetyMargin < 0 && " ⚠️ Estás por debajo del punto de equilibrio"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FinancialScenariosPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"pnl" | "breakeven" | "cashflow" | "variance">("pnl");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  const [compareScenarioId, setCompareScenarioId] = useState<string>("");
  const [lineItemsMap, setLineItemsMap] = useState<Record<string, LineItem[]>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("what_if");

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("financial_scenarios")
      .select("id, name, scenario_type, start_date, end_date, is_baseline, assumptions, description")
      .eq("org_id", orgId)
      .order("is_baseline", { ascending: false })
      .order("created_at")
      .then(({ data, error }) => {
        if (error) { toast.error("Error cargando escenarios"); return; }
        const list = (data ?? []) as Scenario[];
        setScenarios(list);
        if (list.length > 0) {
          setActiveScenarioId(list[0].id);
          if (list.length > 1) setCompareScenarioId(list[1].id);
        }
      });
  }, [orgId]);

  useEffect(() => {
    if (!activeScenarioId) return;
    // Load line items for active scenario if not cached
    if (lineItemsMap[activeScenarioId]) return;
    supabase
      .from("financial_line_items")
      .select("id, scenario_id, category, name, sort_order, is_subtotal, values")
      .eq("scenario_id", activeScenarioId)
      .order("sort_order")
      .then(({ data }) => {
        setLineItemsMap(prev => ({ ...prev, [activeScenarioId]: (data ?? []) as LineItem[] }));
      });
  }, [activeScenarioId]);

  useEffect(() => {
    if (!compareScenarioId || lineItemsMap[compareScenarioId]) return;
    supabase
      .from("financial_line_items")
      .select("id, scenario_id, category, name, sort_order, is_subtotal, values")
      .eq("scenario_id", compareScenarioId)
      .order("sort_order")
      .then(({ data }) => {
        setLineItemsMap(prev => ({ ...prev, [compareScenarioId]: (data ?? []) as LineItem[] }));
      });
  }, [compareScenarioId]);

  const activeScenario = scenarios.find(s => s.id === activeScenarioId);
  const lineItems = lineItemsMap[activeScenarioId] ?? [];
  const compareItems = lineItemsMap[compareScenarioId] ?? [];

  const handleCreate = async () => {
    if (!newName.trim() || !orgId) { toast.error("Ingresá un nombre"); return; }
    const { data, error } = await supabase
      .from("financial_scenarios")
      .insert({
        org_id: orgId, name: newName, scenario_type: newType,
        start_date: "2026-01-01", end_date: "2026-12-31",
        is_baseline: false, assumptions: { inflation_rate: 40, growth_rate: 10 },
      })
      .select()
      .single();
    if (error) { toast.error("Error creando escenario"); return; }
    setScenarios(prev => [...prev, data as Scenario]);
    setActiveScenarioId(data.id);
    toast.success("Escenario creado");
    setShowNew(false);
    setNewName("");
  };

  // Compute cash projections
  const cashData = MONTHS.map((m, i) => {
    const key = genKey(2026, i + 1);
    const rev = lineItems.find(l => l.category === "revenue")?.values[key] ?? 0;
    const opex = lineItems.find(l => l.category === "opex")?.values[key] ?? 0;
    const cogs = lineItems.find(l => l.category === "cogs")?.values[key] ?? 0;
    const inflow = rev * 0.85; // collections lag
    const outflow = cogs + opex;
    return { month: m, inflow, outflow, net: inflow - outflow };
  });

  const cumulativeCash = cashData.reduce<number[]>((acc, d) => {
    acc.push((acc[acc.length - 1] ?? 50000) + d.net);
    return acc;
  }, []);

  // Variance
  const variance = lineItems.map(item => {
    const baseTotal = Object.values(item.values).reduce((a, b) => a + b, 0);
    const compItem = compareItems.find(c => c.name === item.name);
    const compTotal = compItem ? Object.values(compItem.values).reduce((a, b) => a + b, 0) : 0;
    const varAbs = compTotal - baseTotal;
    const varPct = baseTotal !== 0 ? (varAbs / Math.abs(baseTotal)) * 100 : 0;
    return { name: item.name, category: item.category, baseTotal, compTotal, varAbs, varPct };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6 text-primary" /> Escenarios Financieros</h1>
          <p className="text-muted-foreground text-sm mt-1">P&L, punto de equilibrio y modelado de escenarios</p>
        </div>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Nuevo Escenario</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Crear Escenario</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Nombre</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej: Expansión LATAM" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="projection">Proyección</SelectItem>
                    <SelectItem value="budget">Presupuesto</SelectItem>
                    <SelectItem value="what_if">¿Qué pasa si...?</SelectItem>
                    <SelectItem value="variance">Varianza</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleCreate}>Crear</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Scenario selector */}
      <div className="flex gap-2 flex-wrap">
        {scenarios.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveScenarioId(s.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${s.id === activeScenarioId ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50 bg-background"}`}
          >
            {s.name}
            {s.is_baseline && <span className="ml-1 text-xs opacity-70">★</span>}
          </button>
        ))}
      </div>

      {/* Active scenario info */}
      {activeScenario && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-4 text-sm">
            <div><span className="text-muted-foreground">Tipo: </span><span className="font-medium capitalize">{activeScenario.scenario_type}</span></div>
            <div><span className="text-muted-foreground">Inflación: </span><span className="font-medium">{activeScenario.assumptions.inflation_rate}%</span></div>
            <div><span className="text-muted-foreground">Crecimiento: </span><span className={`font-medium ${(activeScenario.assumptions.growth_rate ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>{activeScenario.assumptions.growth_rate}%</span></div>
            {activeScenario.description && <div className="text-muted-foreground">{activeScenario.description}</div>}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
          <TabsTrigger value="breakeven"><Calculator className="w-3.5 h-3.5 mr-1" />Punto de Equilibrio</TabsTrigger>
          <TabsTrigger value="cashflow">Flujo de Caja</TabsTrigger>
          <TabsTrigger value="variance">Varianza</TabsTrigger>
        </TabsList>

        {/* P&L */}
        <TabsContent value="pnl">
          <Card>
            <CardHeader><CardTitle className="text-base">Estado de Resultados — H1 2026</CardTitle></CardHeader>
            <CardContent>
              <PnLTable items={lineItems} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* BREAKEVEN */}
        <TabsContent value="breakeven">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Análisis de Punto de Equilibrio</CardTitle></CardHeader>
            <CardContent>
              <BreakevenCalc />
            </CardContent>
          </Card>
        </TabsContent>

        {/* CASH FLOW */}
        <TabsContent value="cashflow">
          <Card>
            <CardHeader><CardTitle className="text-base">Proyección de Flujo de Caja 2026</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4">Mes</th>
                      {MONTHS.map(m => <th key={m} className="text-right py-2 px-2 font-medium">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 pr-4 font-medium text-green-700">Ingresos</td>
                      {cashData.map((d, i) => <td key={i} className="text-right py-2 px-2 text-green-700">{(d.inflow / 1000).toFixed(0)}K</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4 font-medium text-red-700">Egresos</td>
                      {cashData.map((d, i) => <td key={i} className="text-right py-2 px-2 text-red-700">{(d.outflow / 1000).toFixed(0)}K</td>)}
                    </tr>
                    <tr className="border-b font-semibold bg-muted/30">
                      <td className="py-2 pr-4">Neto del Mes</td>
                      {cashData.map((d, i) => <td key={i} className={`text-right py-2 px-2 ${d.net < 0 ? "text-red-600" : "text-green-600"}`}>{d.net >= 0 ? "+" : ""}{(d.net / 1000).toFixed(0)}K</td>)}
                    </tr>
                    <tr className="font-bold">
                      <td className="py-2 pr-4">Saldo Acumulado</td>
                      {cumulativeCash.map((c, i) => (
                        <td key={i} className={`text-right py-2 px-2 ${c < 0 ? "text-red-600 font-bold" : ""}`}>
                          {c < 0 && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                          {(c / 1000).toFixed(0)}K
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Simple bar chart */}
              <div className="mt-6">
                <p className="text-xs text-muted-foreground mb-2">Saldo Acumulado</p>
                <div className="flex items-end gap-1 h-24">
                  {cumulativeCash.map((c, i) => {
                    const max = Math.max(...cumulativeCash.map(Math.abs));
                    const pct = Math.abs(c) / max * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                        <div
                          className={`w-full rounded-t ${c < 0 ? "bg-red-400" : "bg-emerald-400"}`}
                          style={{ height: `${pct}%` }}
                        />
                        <span className="text-[10px] text-muted-foreground">{MONTHS[i]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VARIANCE */}
        <TabsContent value="variance" className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Comparar vs:</span>
            <Select value={compareScenarioId} onValueChange={setCompareScenarioId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {scenarios.filter(s => s.id !== activeScenarioId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4">Ítem</th>
                    <th className="text-right py-3 px-4">{activeScenario?.name}</th>
                    <th className="text-right py-3 px-4">{scenarios.find(s => s.id === compareScenarioId)?.name}</th>
                    <th className="text-right py-3 px-4">Diferencia</th>
                    <th className="text-right py-3 px-4">%</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.map((v, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[v.category] ?? ""}`}>{v.category.slice(0,3).toUpperCase()}</span>
                          {v.name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground">${(v.baseTotal / 1000).toFixed(0)}K</td>
                      <td className="py-3 px-4 text-right">${(v.compTotal / 1000).toFixed(0)}K</td>
                      <td className={`py-3 px-4 text-right font-medium ${v.varAbs > 0 ? "text-green-600" : v.varAbs < 0 ? "text-red-600" : ""}`}>
                        {v.varAbs > 0 ? "+" : ""}{(v.varAbs / 1000).toFixed(0)}K
                      </td>
                      <td className={`py-3 px-4 text-right font-medium ${v.varPct > 0 ? "text-green-600" : v.varPct < 0 ? "text-red-600" : ""}`}>
                        {v.varPct > 0 ? "+" : ""}{v.varPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
