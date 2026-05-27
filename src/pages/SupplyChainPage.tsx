import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Truck, Star, TrendingUp, TrendingDown, AlertTriangle, Plus,
  RefreshCw, Search, BarChart3, FileText, Clock, Package,
  CheckCircle2, XCircle, Target, DollarSign
} from "lucide-react";

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  "A+": { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  "A":  { bg: "bg-green-500/15",   text: "text-green-400" },
  "B":  { bg: "bg-blue-500/15",    text: "text-blue-400" },
  "C":  { bg: "bg-yellow-500/15",  text: "text-yellow-400" },
  "D":  { bg: "bg-orange-500/15",  text: "text-orange-400" },
  "F":  { bg: "bg-red-500/15",     text: "text-red-400" },
};

// Mock suppliers with scorecards
const MOCK_SUPPLIERS = [
  { id: "s1", name: "Distribuidora Norte SA", on_time: 94, quality: 98, fill: 96, price_var: 1.2, grade: "A+", score: 96.0, orders: 34, avg_lead: 3.2, spend: 485000, response_hrs: 4 },
  { id: "s2", name: "Mayorista Central SRL", on_time: 82, quality: 91, fill: 88, price_var: 3.5, grade: "B",  score: 87.5, orders: 21, avg_lead: 5.8, spend: 312000, response_hrs: 12 },
  { id: "s3", name: "Importadora del Sur", on_time: 71, quality: 85, fill: 79, price_var: 5.1, grade: "C",  score: 78.2, orders: 15, avg_lead: 9.0, spend: 198000, response_hrs: 24 },
  { id: "s4", name: "Tech Supplies CABA", on_time: 97, quality: 99, fill: 99, price_var: 0.5, grade: "A+", score: 98.3, orders: 47, avg_lead: 2.1, spend: 890000, response_hrs: 2 },
  { id: "s5", name: "Proveedor Económico",  on_time: 55, quality: 72, fill: 68, price_var: 8.2, grade: "D",  score: 63.1, orders: 8,  avg_lead: 14.5, spend: 87000, response_hrs: 48 },
];

// Mock lead times timeline
const MOCK_LEAD_TIMES = [
  { id: "l1", supplier: "Distribuidora Norte SA", product: "Artículo Premium XL", ordered: "2026-05-20", received: "2026-05-23", promised: 3, actual: 3, qty_ordered: 100, qty_received: 100, status: "complete", cost: 45000 },
  { id: "l2", supplier: "Tech Supplies CABA",    product: "Componente Electrónico A", ordered: "2026-05-22", received: "2026-05-24", promised: 2, actual: 2, qty_ordered: 50, qty_received: 50, status: "complete", cost: 120000 },
  { id: "l3", supplier: "Mayorista Central SRL", product: "Producto Estándar M",  ordered: "2026-05-18", received: "2026-05-24", promised: 4, actual: 6, qty_ordered: 200, qty_received: 180, status: "partial", cost: 28000 },
  { id: "l4", supplier: "Distribuidora Norte SA", product: "Accesorio Premium",   ordered: "2026-05-27", received: null,          promised: 3, actual: null, qty_ordered: 75, qty_received: 0,   status: "open",   cost: 15000 },
  { id: "l5", supplier: "Importadora del Sur",    product: "Importado Especial",  ordered: "2026-05-15", received: "2026-05-24", promised: 7, actual: 9, qty_ordered: 30, qty_received: 30, status: "complete", cost: 67000 },
];

// Mock procurement budgets
const MOCK_BUDGETS = [
  { category: "Electrónica",  budgeted: 500000, actual: 487000 },
  { category: "Textil",       budgeted: 200000, actual: 231000 },
  { category: "Alimentos",    budgeted: 150000, actual: 142000 },
  { category: "Oficina",      budgeted: 80000,  actual: 65000  },
  { category: "Herramientas", budgeted: 120000, actual: 118000 },
];

function GradeBadge({ grade }: { grade: string }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS["C"];
  return <Badge className={`${c.bg} ${c.text} border-0 font-bold text-xs`}>{grade}</Badge>;
}

function ScoreBar({ value }: { value: number }) {
  const color = value >= 90 ? "bg-emerald-400" : value >= 70 ? "bg-blue-400" : value >= 55 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full">
        <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold w-8">{value.toFixed(0)}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: any) {
  return (
    <div className="bg-card border border-border/40 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold font-display">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function SupplyChainPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"scorecards" | "leadtimes" | "budgets" | "contracts">("scorecards");
  const [search, setSearch] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [scoreForm, setScoreForm] = useState({ on_time: "90", quality: "95", fill: "92", price_var: "2", response_hrs: "8" });

  const filtered = MOCK_SUPPLIERS.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  const topSupplier = MOCK_SUPPLIERS.reduce((a, b) => a.score > b.score ? a : b);
  const totalSpend = MOCK_SUPPLIERS.reduce((acc, s) => acc + s.spend, 0);
  const avgOnTime = Math.round(MOCK_SUPPLIERS.reduce((acc, s) => acc + s.on_time, 0) / MOCK_SUPPLIERS.length);
  const atRisk = MOCK_SUPPLIERS.filter(s => s.grade === "D" || s.grade === "F").length;

  const TABS = [
    { id: "scorecards", label: "Scorecards" },
    { id: "leadtimes",  label: "Lead Times" },
    { id: "budgets",    label: "Presupuesto" },
    { id: "contracts",  label: "Contratos" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Truck className="w-4 h-4 text-purple-400" />
            </div>
            <h1 className="text-2xl font-display font-bold">Supply Chain Intelligence</h1>
          </div>
          <p className="text-sm text-muted-foreground">Scorecards de proveedores, lead times y análisis de procurement</p>
        </div>
        <Button size="sm" onClick={() => { setShowScoreDialog(true); }} className="gap-1.5 gradient-gold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />Nuevo Scorecard
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Truck} label="Proveedores activos" value={MOCK_SUPPLIERS.length} sub="evaluados este período" />
        <StatCard icon={CheckCircle2} label="Entrega a tiempo" value={`${avgOnTime}%`} color="text-emerald-400" sub="promedio" />
        <StatCard icon={DollarSign} label="Gasto total" value={`$${(totalSpend / 1000000).toFixed(2)}M`} color="text-primary" sub="últimos 90 días" />
        <StatCard icon={AlertTriangle} label="Proveedores en riesgo" value={atRisk} color="text-red-400" sub="Grade D o F" />
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

      {/* ─── Scorecards tab ─── */}
      {tab === "scorecards" && (
        <div className="space-y-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Buscar proveedor..." className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Proveedor", "Grade", "Score", "Entrega %", "Calidad %", "Fill Rate %", "Lead Time", "Gasto", "Órdenes"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.id} className="border-b border-border/20 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setSelectedSupplier(s)}>
                      <td className="px-4 py-3 font-medium text-sm">{s.name}</td>
                      <td className="px-4 py-3"><GradeBadge grade={s.grade} /></td>
                      <td className="px-4 py-3 min-w-[120px]"><ScoreBar value={s.score} /></td>
                      <td className="px-4 py-3 text-xs">
                        <span className={s.on_time >= 90 ? "text-emerald-400" : s.on_time >= 75 ? "text-yellow-400" : "text-red-400"}>{s.on_time}%</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={s.quality >= 90 ? "text-emerald-400" : "text-yellow-400"}>{s.quality}%</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={s.fill >= 90 ? "text-emerald-400" : "text-yellow-400"}>{s.fill}%</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{s.avg_lead} días</td>
                      <td className="px-4 py-3 text-xs font-semibold">${(s.spend / 1000).toFixed(0)}K</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{s.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ranking highlight */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-400">Mejor Proveedor</span>
              </div>
              <p className="font-bold">{topSupplier.name}</p>
              <p className="text-xs text-muted-foreground mt-1">Score: {topSupplier.score.toFixed(1)} — Grade {topSupplier.grade}</p>
              <p className="text-xs text-muted-foreground">Lead time prom: {topSupplier.avg_lead} días</p>
            </div>
            {MOCK_SUPPLIERS.filter(s => s.grade === "D" || s.grade === "F").map(s => (
              <div key={s.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-red-400">Requiere Atención</span>
                </div>
                <p className="font-bold">{s.name}</p>
                <p className="text-xs text-muted-foreground mt-1">Score: {s.score.toFixed(1)} — Grade {s.grade}</p>
                <p className="text-xs text-red-400">Entrega puntual: solo {s.on_time}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Lead Times tab ─── */}
      {tab === "leadtimes" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <h3 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />Historial de Lead Times</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Proveedor", "Producto", "Ordenado", "Recibido", "Prometido", "Real", "Δ Días", "Qty", "Estado"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_LEAD_TIMES.map(l => {
                    const delta = l.actual !== null ? l.actual - l.promised : null;
                    return (
                      <tr key={l.id} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-4 py-3 text-xs font-medium">{l.supplier}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{l.product}</td>
                        <td className="px-4 py-3 text-xs font-mono">{l.ordered}</td>
                        <td className="px-4 py-3 text-xs font-mono">{l.received || "—"}</td>
                        <td className="px-4 py-3 text-xs text-center">{l.promised}d</td>
                        <td className="px-4 py-3 text-xs text-center">{l.actual !== null ? `${l.actual}d` : "—"}</td>
                        <td className="px-4 py-3 text-xs text-center">
                          {delta !== null ? (
                            <span className={delta > 0 ? "text-red-400" : delta < 0 ? "text-emerald-400" : "text-muted-foreground"}>
                              {delta > 0 ? `+${delta}` : delta}d
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs">{l.qty_received}/{l.qty_ordered}</td>
                        <td className="px-4 py-3">
                          <Badge className={
                            l.status === "complete" ? "bg-emerald-500/15 text-emerald-400 border-0 text-xs" :
                            l.status === "partial"  ? "bg-yellow-500/15 text-yellow-400 border-0 text-xs" :
                            l.status === "open"     ? "bg-blue-500/15 text-blue-400 border-0 text-xs" :
                            "bg-zinc-500/15 text-zinc-400 border-0 text-xs"
                          }>{l.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Budgets tab ─── */}
      {tab === "budgets" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-5"><BarChart3 className="w-4 h-4 text-primary" />Presupuesto de Compras — Mayo 2026</h3>
            <div className="space-y-4">
              {MOCK_BUDGETS.map(b => {
                const pct = Math.round((b.actual / b.budgeted) * 100);
                const over = b.actual > b.budgeted;
                return (
                  <div key={b.category}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium">{b.category}</span>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-muted-foreground">Ppto: ${b.budgeted.toLocaleString("es-AR")}</span>
                        <span className={over ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
                          Real: ${b.actual.toLocaleString("es-AR")}
                        </span>
                        <Badge className={over ? "bg-red-500/15 text-red-400 border-0 text-xs" : "bg-emerald-500/15 text-emerald-400 border-0 text-xs"}>
                          {over ? "+" : ""}{((b.actual - b.budgeted) / b.budgeted * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${over ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>0%</span>
                      <span className={over ? "text-red-400" : ""}>{pct}% ejecutado</span>
                      <span>100%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Contracts tab ─── */}
      {tab === "contracts" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MOCK_SUPPLIERS.slice(0, 3).map((s, i) => (
              <div key={s.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{s.name}</p>
                    <p className="text-xs text-muted-foreground">Contrato #{String(i + 1).padStart(4, "0")}-2026</p>
                  </div>
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs">Activo</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div><span className="text-muted-foreground block">Vigencia</span>2026-01 → 2026-12</div>
                  <div><span className="text-muted-foreground block">Plazo pago</span>30 días neto</div>
                  <div><span className="text-muted-foreground block">Descuento</span>{(i * 1.5 + 2).toFixed(1)}%</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"><FileText className="w-3 h-3" />Ver contrato</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Target className="w-3 h-3" />Renovar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Scorecard dialog ─── */}
      {showScoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Star className="w-4 h-4 text-primary" />Nuevo Scorecard</h3>
              <button onClick={() => setShowScoreDialog(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Proveedor</label>
                <select className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {MOCK_SUPPLIERS.map(s => <option key={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "on_time", label: "Entrega a tiempo %" },
                  { key: "quality", label: "Calidad %" },
                  { key: "fill", label: "Fill Rate %" },
                  { key: "price_var", label: "Variación precio %" },
                  { key: "response_hrs", label: "Tiempo respuesta (hrs)" },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-muted-foreground mb-1.5 block">{f.label}</label>
                    <Input type="number" value={(scoreForm as any)[f.key]}
                      onChange={e => setScoreForm(p => ({ ...p, [f.key]: e.target.value }))} className="h-9" min={0} max={100} step={0.1} />
                  </div>
                ))}
              </div>
              {/* Preview score */}
              <div className="bg-muted/30 rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Score calculado</span>
                  <span className="font-bold text-lg">
                    {Math.round(Number(scoreForm.on_time) * 0.35 + Number(scoreForm.quality) * 0.30 + Number(scoreForm.fill) * 0.20 + (100 - Math.min(Number(scoreForm.price_var) * 5, 100)) * 0.15)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">Fórmula: Entrega×35% + Calidad×30% + Fill×20% + Precio×15%</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowScoreDialog(false)}>Cancelar</Button>
              <Button onClick={() => { toast.success("Scorecard guardado"); setShowScoreDialog(false); }} className="gradient-gold text-primary-foreground">
                Guardar Scorecard
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Supplier detail panel ─── */}
      {selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between sticky top-0 bg-card">
              <div>
                <h3 className="font-semibold">{selectedSupplier.name}</h3>
                <div className="flex items-center gap-2 mt-0.5"><GradeBadge grade={selectedSupplier.grade} /><span className="text-xs text-muted-foreground">Score: {selectedSupplier.score.toFixed(1)}/100</span></div>
              </div>
              <button onClick={() => setSelectedSupplier(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Entrega a tiempo", value: selectedSupplier.on_time, suffix: "%" },
                  { label: "Calidad", value: selectedSupplier.quality, suffix: "%" },
                  { label: "Fill Rate", value: selectedSupplier.fill, suffix: "%" },
                  { label: "Lead time prom.", value: selectedSupplier.avg_lead, suffix: " días" },
                  { label: "Órdenes", value: selectedSupplier.orders, suffix: "" },
                  { label: "Respuesta", value: selectedSupplier.response_hrs, suffix: " hrs" },
                ].map(m => (
                  <div key={m.label} className="bg-muted/30 rounded-lg p-3">
                    <span className="text-xs text-muted-foreground">{m.label}</span>
                    <p className="text-xl font-bold mt-0.5">{m.value}{m.suffix}</p>
                  </div>
                ))}
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-2">Gasto total (90 días)</span>
                <p className="text-2xl font-bold text-primary">${selectedSupplier.spend.toLocaleString("es-AR")}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
