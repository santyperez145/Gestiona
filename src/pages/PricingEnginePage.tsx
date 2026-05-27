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

interface PricingRule {
  id: string;
  name: string;
  rule_type: string;
  priority: number;
  is_active: boolean;
  run_count: number;
  last_applied_at: string | null;
  action: { type: string; value: number };
}

interface PricingExperiment {
  id: string;
  name: string;
  product_id: string;
  control_price: number;
  variant_price: number;
  status: string;
  winner: string | null;
  confidence_pct: number | null;
  control_conversions: number;
  variant_conversions: number;
  control_impressions: number;
  variant_impressions: number;
}

interface MarginTarget {
  id: string;
  name: string;
  applies_to: string;
  entity_id: string | null;
  min_margin_pct: number;
  target_margin_pct: number;
  alert_threshold: number;
  is_active: boolean;
}

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
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [experiments, setExperiments] = useState<PricingExperiment[]>([]);
  const [marginTargets, setMarginTargets] = useState<MarginTarget[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);

    Promise.all([
      supabase
        .from("pricing_rules")
        .select("id, name, rule_type, priority, is_active, run_count, last_applied_at, action")
        .eq("org_id", orgId)
        .order("priority", { ascending: true }),
      supabase
        .from("pricing_experiments")
        .select("id, name, product_id, control_price, variant_price, status, winner, confidence_pct, control_conversions, variant_conversions, control_impressions, variant_impressions")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("margin_targets")
        .select("id, name, applies_to, entity_id, min_margin_pct, target_margin_pct, alert_threshold, is_active")
        .eq("org_id", orgId)
        .eq("is_active", true),
    ]).then(([rulesRes, expRes, marginRes]) => {
      if (!rulesRes.error && rulesRes.data) setRules(rulesRes.data as PricingRule[]);
      if (!expRes.error && expRes.data) setExperiments(expRes.data as PricingExperiment[]);
      if (!marginRes.error && marginRes.data) setMarginTargets(marginRes.data as MarginTarget[]);
      setLoading(false);
    });
  }, [orgId]);

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
    // Refresh rules list
    supabase
      .from("pricing_rules")
      .select("id, name, rule_type, priority, is_active, run_count, last_applied_at, action")
      .eq("org_id", orgId)
      .order("priority", { ascending: true })
      .then(({ data, error: err }) => {
        if (!err && data) setRules(data as PricingRule[]);
      });
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
          <p className="text-2xl font-bold">{rules.filter(r => r.is_active).length}</p>
          <p className="text-xs text-muted-foreground">{rules.length} en total</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Aplicaciones hoy</p>
          <p className="text-2xl font-bold">{rules.reduce((a, r) => a + r.run_count, 0).toLocaleString("es-AR")}</p>
          <p className="text-xs text-emerald-400">total ejecuciones</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Alertas de margen</p>
          <p className="text-2xl font-bold text-red-400">{marginTargets.length}</p>
          <p className="text-xs text-muted-foreground">targets configurados</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Experimentos activos</p>
          <p className="text-2xl font-bold text-blue-400">{experiments.filter(e => e.status === "running").length}</p>
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
                  {rules.map(r => (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-sm">{r.name}</td>
                      <td className="px-4 py-3"><RuleTypeBadge type={r.rule_type} /></td>
                      <td className="px-4 py-3 text-xs font-mono">{r.priority}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={r.action?.type === "pct_discount" ? "text-red-400" : "text-emerald-400"}>
                          {r.action?.type === "pct_discount" ? "-" : "+"}{r.action?.value}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.run_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.last_applied_at ? new Date(r.last_applied_at).toLocaleString("es-AR") : "—"}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toast.success(`Regla ${r.is_active ? "pausada" : "activada"}`)}
                          className={`w-9 h-5 rounded-full transition-all ${r.is_active ? "bg-emerald-500" : "bg-muted"}`}>
                          <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${r.is_active ? "translate-x-4" : "translate-x-0"}`} />
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
          {experiments.map(exp => {
            const isRunning = exp.status === "running";
            const controlCvr = exp.control_impressions > 0 ? (exp.control_conversions / exp.control_impressions * 100) : 0;
            const variantCvr = exp.variant_impressions > 0 ? (exp.variant_conversions / exp.variant_impressions * 100) : 0;
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
                    <p className="text-xs text-muted-foreground mt-0.5">{exp.product_id}</p>
                  </div>
                  <Badge className="bg-primary/15 text-primary border-0 text-xs">{exp.confidence_pct ?? 0}% confianza</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  {[
                    { label: "Control (actual)", price: exp.control_price, cvr: controlCvr, winner: !isRunning && exp.winner === "control" },
                    { label: "Variante (test)",  price: exp.variant_price, cvr: variantCvr, winner: !isRunning && exp.winner === "variant" },
                  ].map((v, i) => (
                    <div key={i} className={`p-4 rounded-xl border ${v.winner ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/40 bg-muted/20"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">{v.label}</span>
                        {v.winner && <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs">🏆 Ganador</Badge>}
                      </div>
                      <p className="text-2xl font-bold">${v.price.toLocaleString("es-AR")}</p>
                      <p className="text-xs text-muted-foreground mt-1">CVR: <span className="font-semibold text-foreground">{v.cvr.toFixed(1)}%</span></p>
                      <div className="mt-2 h-1.5 bg-muted rounded-full">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(controlCvr, variantCvr) > 0 ? (v.cvr / Math.max(controlCvr, variantCvr)) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  {isRunning && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => toast.success("Experimento pausado")}><Pause className="w-3 h-3" />Pausar</Button>}
                  {!isRunning && exp.winner === "variant" && <Button size="sm" className="h-7 text-xs gap-1 gradient-gold text-primary-foreground" onClick={() => toast.success("Precio variante aplicado")}><Check className="w-3 h-3" />Aplicar precio ganador</Button>}
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
          {marginTargets.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">Targets de margen configurados</p>
                <p className="text-xs text-muted-foreground mt-0.5">{marginTargets.length} targets activos</p>
              </div>
            </div>
          )}

          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-primary" />Targets de Margen</h3>
            <div className="space-y-4">
              {marginTargets.map((mt) => (
                <div key={mt.id}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-medium">{mt.name}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Target: {mt.target_margin_pct}%</span>
                      <span className="text-muted-foreground">Alerta: {mt.alert_threshold}%</span>
                      <span className="text-muted-foreground">Mínimo: {mt.min_margin_pct}%</span>
                    </div>
                  </div>
                  <MarginBar value={mt.min_margin_pct} target={mt.target_margin_pct} alertAt={mt.alert_threshold} />
                </div>
              ))}
              {marginTargets.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No hay targets de margen configurados</p>
              )}
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
