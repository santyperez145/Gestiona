import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tag, Plus, Play, Pause, RefreshCw, TrendingUp, TrendingDown,
  AlertTriangle, BarChart3, Settings, Calculator, ChevronDown,
  ChevronUp, Check, Zap, Target, DollarSign, Edit3, Trash2
} from "lucide-react";

const RULE_TYPES = [
  { id: "cost_plus",      label: "Costo + Margen",       desc: "Precio basado en costo + % fijo",         color: "text-blue-400" },
  { id: "margin_floor",   label: "Piso de Margen",       desc: "Garantiza margen mínimo",                  color: "text-emerald-400" },
  { id: "competitor_based", label: "Basado en Competidor", desc: "Ajusta al precio del competidor",       color: "text-purple-400" },
  { id: "volume_tier",    label: "Descuento por Volumen", desc: "Precio escalonado por cantidad",           color: "text-yellow-400" },
  { id: "customer_tier",  label: "Por Segmento Cliente",  desc: "Precio diferenciado por tipo de cliente", color: "text-pink-400" },
  { id: "time_based",     label: "Por Horario/Fecha",     desc: "Precios según día u hora",                color: "text-orange-400" },
  { id: "clearance",      label: "Liquidación",           desc: "Rebaja automática por antigüedad",         color: "text-red-400" },
  { id: "dynamic",        label: "Dinámico",              desc: "Sube/baja según demanda en tiempo real",   color: "text-primary" },
];

// Mock pricing rules
const MOCK_RULES = [
  { id: "r1", name: "Margen mínimo 25%", type: "margin_floor",   priority: 10, active: true,  runs: 1240, last: "hace 5 min",  action: { type: "pct_markup", value: 25 } },
  { id: "r2", name: "Mayorista -15%",    type: "customer_tier",   priority: 20, active: true,  runs: 342,  last: "hace 1 hora", action: { type: "pct_discount", value: 15 } },
  { id: "r3", name: "Liquidación >90d",  type: "clearance",        priority: 50, active: true,  runs: 87,   last: "ayer",        action: { type: "pct_discount", value: 30 } },
  { id: "r4", name: "Happy hour 18-20h", type: "time_based",       priority: 30, active: false, runs: 44,   last: "hace 2 días", action: { type: "pct_discount", value: 10 } },
  { id: "r5", name: "Compra +10 unid.",  type: "volume_tier",      priority: 40, active: true,  runs: 156,  last: "hace 30 min", action: { type: "pct_discount", value: 8  } },
];

// Mock A/B experiments
const MOCK_EXPERIMENTS = [
  { id: "e1", name: "Precio Alpha A/B", product: "Producto Premium Alpha", control: 12500, variant: 10900, status: "running", control_cvr: 3.2, variant_cvr: 4.8, confidence: 87 },
  { id: "e2", name: "Precio Kit XL",    product: "Kit Estándar XL",        control: 8900,  variant: 8200,  status: "completed", winner: "variant", control_cvr: 2.1, variant_cvr: 3.1, confidence: 95 },
];

// Mock margin alerts
const MOCK_MARGIN_ALERTS = [
  { product: "Artículo Económico B", current_margin: 8.2,  target: 25, alert_at: 15 },
  { product: "Importado Especial X",  current_margin: 12.5, target: 30, alert_at: 15 },
];

function RuleTypeBadge({ type }: { type: string }) {
  const rt = RULE_TYPES.find(r => r.id === type);
  return <Badge className={`bg-muted border-0 text-xs ${rt?.color || "text-muted-foreground"}`}>{rt?.label || type}</Badge>;
}

function MarginBar({ value, target, alertAt }: { value: number; target: number; alertAt: number }) {
  const color = value >= target ? "bg-emerald-400" : value >= alertAt ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="relative h-2.5 bg-muted rounded-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      <div className="absolute top-0 bottom-0 w-px bg-yellow-400" style={{ left: `${alertAt}%` }} title={`Alerta: ${alertAt}%`} />
      <div className="absolute top-0 bottom-0 w-px bg-emerald-400" style={{ left: `${target}%` }} title={`Target: ${target}%`} />
    </div>
  );
}

export default function PricingEnginePage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"rules" | "calculator" | "experiments" | "margins">("rules");
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", type: "cost_plus", action_type: "pct_markup", value: "40", priority: "100" });
  const [calcCost, setCalcCost] = useState("1000");
  const [calcBase, setCalcBase] = useState("1500");
  const [calcQty, setCalcQty] = useState("1");

  // Calculator results
  const cost = Number(calcCost);
  const base = Number(calcBase);
  const margin = base > 0 ? ((base - cost) / base * 100).toFixed(1) : "0";
  const markup = cost > 0 ? ((base - cost) / cost * 100).toFixed(1) : "0";

  const saveRule = async () => {
    if (!orgId || !newRule.name) return;
    const { error } = await supabase.from("pricing_rules").insert({
      org_id: orgId, name: newRule.name, rule_type: newRule.type,
      priority: Number(newRule.priority), applies_to: "all", is_active: true,
      action: { type: newRule.action_type, value: Number(newRule.value) },
    });
    if (error) { toast.error("Error al crear regla"); return; }
    toast.success("Regla de precios creada");
    setShowNewRule(false);
    setNewRule({ name: "", type: "cost_plus", action_type: "pct_markup", value: "40", priority: "100" });
  };

  const TABS = [
    { id: "rules",       label: "Reglas de Precios" },
    { id: "calculator",  label: "Calculadora" },
    { id: "experiments", label: "A/B Testing" },
    { id: "margins",     label: "Control Márgenes" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Tag className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold">Motor de Precios</h1>
          </div>
          <p className="text-sm text-muted-foreground">Reglas dinámicas, A/B testing y control de márgenes</p>
        </div>
        <Button size="sm" onClick={() => setShowNewRule(true)} className="gap-1.5 gradient-gold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />Nueva Regla
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Reglas Activas</p>
          <p className="text-2xl font-bold">{MOCK_RULES.filter(r => r.active).length}</p>
          <p className="text-xs text-muted-foreground">{MOCK_RULES.length} en total</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Aplicaciones hoy</p>
          <p className="text-2xl font-bold">1,869</p>
          <p className="text-xs text-emerald-400">+12% vs ayer</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Alertas de margen</p>
          <p className="text-2xl font-bold text-red-400">{MOCK_MARGIN_ALERTS.length}</p>
          <p className="text-xs text-muted-foreground">productos bajo target</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Experimentos activos</p>
          <p className="text-2xl font-bold text-blue-400">{MOCK_EXPERIMENTS.filter(e => e.status === "running").length}</p>
          <p className="text-xs text-muted-foreground">A/B tests corriendo</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Rules tab ─── */}
      {tab === "rules" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {RULE_TYPES.slice(0, 4).map(rt => (
              <div key={rt.id} className="bg-card border border-border/40 rounded-xl p-3 text-center">
                <p className={`text-sm font-semibold ${rt.color}`}>{rt.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{rt.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Nombre", "Tipo", "Prioridad", "Acción", "Ejecuciones", "Última vez", "Estado", ""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_RULES.map(r => (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-sm">{r.name}</td>
                      <td className="px-4 py-3"><RuleTypeBadge type={r.type} /></td>
                      <td className="px-4 py-3 text-xs font-mono">{r.priority}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={r.action.type === "pct_discount" ? "text-red-400" : "text-emerald-400"}>
                          {r.action.type === "pct_discount" ? "-" : "+"}{r.action.value}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.runs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.last}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toast.success(`Regla ${r.active ? "pausada" : "activada"}`)}
                          className={`w-9 h-5 rounded-full transition-all ${r.active ? "bg-emerald-500" : "bg-muted"}`}>
                          <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${r.active ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button className="text-muted-foreground hover:text-foreground"><Edit3 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Calculator tab ─── */}
      {tab === "calculator" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border/40 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" />Calculadora de Margen</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Precio de costo (ARS)</label>
                <Input type="number" value={calcCost} onChange={e => setCalcCost(e.target.value)} className="h-9 font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Precio de venta (ARS)</label>
                <Input type="number" value={calcBase} onChange={e => setCalcBase(e.target.value)} className="h-9 font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Cantidad</label>
                <Input type="number" value={calcQty} onChange={e => setCalcQty(e.target.value)} className="h-9 font-mono" min={1} />
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Ganancia unitaria</span><span className="font-semibold">${(base - cost).toLocaleString("es-AR")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Margen</span>
                <span className={`font-semibold ${Number(margin) >= 25 ? "text-emerald-400" : Number(margin) >= 15 ? "text-yellow-400" : "text-red-400"}`}>{margin}%</span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Markup</span><span className="font-semibold">{markup}%</span></div>
              <div className="flex justify-between border-t border-border/40 pt-2"><span className="text-muted-foreground">Ganancia total ({calcQty}u)</span><span className="font-bold text-primary">${((base - cost) * Number(calcQty)).toLocaleString("es-AR")}</span></div>
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-primary" />¿Cuánto cobrar para llegar a X% margen?</h3>
            <div className="space-y-3">
              {[20, 30, 40, 50, 60].map(targetMargin => {
                const priceForMargin = cost > 0 ? cost / (1 - targetMargin / 100) : 0;
                return (
                  <div key={targetMargin} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-8 ${targetMargin >= 40 ? "text-emerald-400" : targetMargin >= 25 ? "text-yellow-400" : "text-muted-foreground"}`}>{targetMargin}%</span>
                      <div className="h-1.5 w-20 bg-muted rounded-full"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${targetMargin}%` }} /></div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">${priceForMargin.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
                      <p className="text-[10px] text-muted-foreground">markup {cost > 0 ? ((priceForMargin - cost) / cost * 100).toFixed(0) : 0}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Experiments tab ─── */}
      {tab === "experiments" && (
        <div className="space-y-4">
          {MOCK_EXPERIMENTS.map(exp => {
            const isRunning = exp.status === "running";
            const totalConv = (exp.control_cvr || 0) + (exp.variant_cvr || 0);
            return (
              <div key={exp.id} className="bg-card border border-border/40 rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{exp.name}</h3>
                      <Badge className={isRunning ? "bg-blue-500/15 text-blue-400 border-0" : "bg-emerald-500/15 text-emerald-400 border-0"}>
                        {isRunning ? "● Corriendo" : "✓ Completado"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{exp.product}</p>
                  </div>
                  <Badge className="bg-primary/15 text-primary border-0 text-xs">{exp.confidence}% confianza</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  {[
                    { label: "Control (actual)", price: exp.control, cvr: exp.control_cvr, winner: !isRunning && (exp as any).winner === "control" },
                    { label: "Variante (test)",  price: exp.variant, cvr: exp.variant_cvr, winner: !isRunning && (exp as any).winner === "variant" },
                  ].map((v, i) => (
                    <div key={i} className={`p-4 rounded-xl border ${v.winner ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/40 bg-muted/20"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">{v.label}</span>
                        {v.winner && <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs">🏆 Ganador</Badge>}
                      </div>
                      <p className="text-2xl font-bold">${v.price.toLocaleString("es-AR")}</p>
                      <p className="text-xs text-muted-foreground mt-1">CVR: <span className="font-semibold text-foreground">{v.cvr}%</span></p>
                      <div className="mt-2 h-1.5 bg-muted rounded-full">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(v.cvr / Math.max(exp.control_cvr, exp.variant_cvr)) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  {isRunning && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => toast.success("Experimento pausado")}><Pause className="w-3 h-3" />Pausar</Button>}
                  {!isRunning && (exp as any).winner === "variant" && <Button size="sm" className="h-7 text-xs gap-1 gradient-gold text-primary-foreground" onClick={() => toast.success("Precio variante aplicado")}><Check className="w-3 h-3" />Aplicar precio ganador</Button>}
                </div>
              </div>
            );
          })}
          <Button variant="outline" className="gap-1.5" onClick={() => toast.info("Nuevo experimento")}><Plus className="w-4 h-4" />Crear Experimento A/B</Button>
        </div>
      )}

      {/* ─── Margins tab ─── */}
      {tab === "margins" && (
        <div className="space-y-4">
          {MOCK_MARGIN_ALERTS.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">Alertas de margen activas</p>
                <p className="text-xs text-muted-foreground mt-0.5">{MOCK_MARGIN_ALERTS.length} productos con margen por debajo del umbral de alerta</p>
              </div>
            </div>
          )}

          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-primary" />Márgenes por Producto</h3>
            <div className="space-y-4">
              {[
                { name: "Producto Premium Alpha", cost: 8500, price: 15000, target: 40, alert_at: 25 },
                { name: "Kit Estándar XL",         cost: 4200, price: 8900,  target: 35, alert_at: 20 },
                ...MOCK_MARGIN_ALERTS.map(a => ({ name: a.product, cost: 1000, price: 1090, target: a.target, alert_at: a.alert_at, margin: a.current_margin })),
              ].map((p: any, i) => {
                const m = p.margin !== undefined ? p.margin : ((p.price - p.cost) / p.price * 100);
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium">{p.name}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground">Target: {p.target}%</span>
                        <span className={`font-semibold ${m >= p.target ? "text-emerald-400" : m >= p.alert_at ? "text-yellow-400" : "text-red-400"}`}>
                          {m >= p.target ? "✓" : m >= p.alert_at ? "⚠" : "✗"} {m.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <MarginBar value={m} target={p.target} alertAt={p.alert_at} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── New Rule dialog ─── */}
      {showNewRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />Nueva Regla de Precios</h3>
              <button onClick={() => setShowNewRule(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nombre</label>
                <Input value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Descuento mayoristas" className="h-9" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de regla</label>
                <select value={newRule.type} onChange={e => setNewRule(p => ({ ...p, type: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {RULE_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de acción</label>
                  <select value={newRule.action_type} onChange={e => setNewRule(p => ({ ...p, action_type: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="pct_markup">% Markup sobre costo</option>
                    <option value="pct_discount">% Descuento sobre precio</option>
                    <option value="fixed_price">Precio fijo</option>
                    <option value="cost_plus">Costo + fijo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Valor</label>
                  <Input type="number" value={newRule.value} onChange={e => setNewRule(p => ({ ...p, value: e.target.value }))} className="h-9" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Prioridad (menor = mayor prioridad)</label>
                <Input type="number" value={newRule.priority} onChange={e => setNewRule(p => ({ ...p, priority: e.target.value }))} className="h-9" min={1} max={999} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewRule(false)}>Cancelar</Button>
              <Button onClick={saveRule} disabled={!newRule.name} className="gradient-gold text-primary-foreground">Crear Regla</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
