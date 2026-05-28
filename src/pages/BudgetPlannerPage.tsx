import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  PiggyBank, Plus, ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  Pencil, Trash2, Sparkles, ArrowUpRight, ArrowDownRight, Loader2, BarChart3,
} from "lucide-react";

interface BudgetCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: "expense" | "income";
  sort_order: number;
  active: boolean;
}

interface Budget {
  id: string;
  category_id: string;
  year: number;
  month: number;
  amount: number;
}

interface BudgetTransaction {
  id: string;
  category_id: string;
  amount: number;
  description: string;
  date: string;
  created_at: string;
}

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}

export default function BudgetPlannerPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12

  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<BudgetTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  // Dialogs
  const [catOpen, setCatOpen] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const [budgetEditOpen, setBudgetEditOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<BudgetCategory | null>(null);
  const [editingBudgetCat, setEditingBudgetCat] = useState<BudgetCategory | null>(null);

  // Forms
  const [catForm, setCatForm] = useState({ name: "", color: "#6366f1", icon: "💰", type: "expense", sort_order: "0" });
  const [txnForm, setTxnForm] = useState({ category_id: "", amount: "", description: "", date: new Date().toISOString().substring(0,10) });
  const [budgetAmount, setBudgetAmount] = useState("");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [catsRes, budgetsRes, txnRes] = await Promise.all([
      supabase.from("budget_categories").select("*").eq("org_id", orgId).eq("active", true).order("sort_order"),
      supabase.from("budgets").select("*").eq("org_id", orgId).eq("year", year).eq("month", month),
      supabase.from("budget_transactions").select("*").eq("org_id", orgId)
        .gte("date", `${year}-${String(month).padStart(2,"0")}-01`)
        .lte("date", `${year}-${String(month).padStart(2,"0")}-31`)
        .order("date", { ascending: false }),
    ]);
    setCategories((catsRes.data || []) as BudgetCategory[]);
    setBudgets((budgetsRes.data || []) as Budget[]);
    setTransactions((txnRes.data || []) as BudgetTransaction[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId, year, month]);

  async function seedCategories() {
    const { error } = await supabase.rpc("seed_budget_categories", { p_org_id: orgId });
    if (error) { toast.error(error.message); return; }
    toast.success("Categorías por defecto creadas");
    loadData();
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  async function saveCat() {
    if (!catForm.name.trim()) { toast.error("Nombre requerido"); return; }
    const payload = {
      org_id: orgId, name: catForm.name.trim(), color: catForm.color,
      icon: catForm.icon, type: catForm.type, sort_order: Number(catForm.sort_order),
    };
    if (editingCat) {
      const { error } = await supabase.from("budget_categories").update(payload).eq("id", editingCat.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Categoría actualizada");
    } else {
      const { error } = await supabase.from("budget_categories").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Categoría creada");
    }
    setCatOpen(false); setEditingCat(null);
    setCatForm({ name: "", color: "#6366f1", icon: "💰", type: "expense", sort_order: "0" });
    loadData();
  }

  async function deleteCat(id: string) {
    if (!confirm("¿Eliminar categoría?")) return;
    await supabase.from("budget_categories").update({ active: false }).eq("id", id);
    toast.success("Categoría desactivada");
    loadData();
  }

  async function saveBudget() {
    if (!editingBudgetCat || !budgetAmount) return;
    const { error } = await supabase.from("budgets").upsert({
      org_id: orgId, category_id: editingBudgetCat.id,
      year, month, amount: Number(budgetAmount),
    }, { onConflict: "org_id,category_id,year,month" });
    if (error) { toast.error(error.message); return; }
    toast.success("Presupuesto guardado");
    setBudgetEditOpen(false); setEditingBudgetCat(null); setBudgetAmount("");
    loadData();
  }

  async function saveTxn() {
    if (!txnForm.category_id || !txnForm.amount || !txnForm.description.trim()) {
      toast.error("Categoría, monto y descripción son requeridos"); return;
    }
    const { error } = await supabase.from("budget_transactions").insert({
      org_id: orgId, category_id: txnForm.category_id,
      amount: Number(txnForm.amount), description: txnForm.description.trim(),
      date: txnForm.date,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Movimiento registrado");
    setTxnOpen(false);
    setTxnForm({ category_id: "", amount: "", description: "", date: new Date().toISOString().substring(0,10) });
    loadData();
  }

  async function deleteTxn(id: string) {
    if (!confirm("¿Eliminar movimiento?")) return;
    await supabase.from("budget_transactions").delete().eq("id", id);
    toast.success("Movimiento eliminado");
    loadData();
  }

  // Compute spending per category for current month
  const spendingMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transactions) {
      map[t.category_id] = (map[t.category_id] || 0) + Math.abs(t.amount);
    }
    return map;
  }, [transactions]);

  const budgetMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of budgets) map[b.category_id] = b.amount;
    return map;
  }, [budgets]);

  const expenseCats = categories.filter(c => c.type === "expense");
  const incomeCats = categories.filter(c => c.type === "income");

  const totalBudgetedExpenses = expenseCats.reduce((s, c) => s + (budgetMap[c.id] || 0), 0);
  const totalActualExpenses = expenseCats.reduce((s, c) => s + (spendingMap[c.id] || 0), 0);
  const totalBudgetedIncome = incomeCats.reduce((s, c) => s + (budgetMap[c.id] || 0), 0);
  const totalActualIncome = incomeCats.reduce((s, c) => s + (spendingMap[c.id] || 0), 0);

  const netBudgeted = totalBudgetedIncome - totalBudgetedExpenses;
  const netActual = totalActualIncome - totalActualExpenses;
  const expensePct = totalBudgetedExpenses > 0 ? Math.min((totalActualExpenses / totalBudgetedExpenses) * 100, 100) : 0;

  const chartData = useMemo(() => {
    return categories.map(cat => ({
      name: cat.name.length > 14 ? cat.name.slice(0, 14) + "…" : cat.name,
      presupuestado: budgetMap[cat.id] || 0,
      real: spendingMap[cat.id] || 0,
      type: cat.type,
    })).filter(d => d.presupuestado > 0 || d.real > 0);
  }, [categories, budgetMap, spendingMap]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Presupuesto Mensual"
        description="Planificá ingresos y gastos por categoría, con seguimiento en tiempo real"
        icon={PiggyBank}
        actions={
          <div className="flex gap-2 flex-wrap">
            {categories.length === 0 && (
              <Button variant="outline" size="sm" onClick={seedCategories}>
                <Sparkles className="w-4 h-4 mr-1" /> Cargar por defecto
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setEditingCat(null); setCatForm({ name: "", color: "#6366f1", icon: "💰", type: "expense", sort_order: "0" }); setCatOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Categoría
            </Button>
            <Button size="sm" onClick={() => setTxnOpen(true)} disabled={categories.length === 0}>
              <Plus className="w-4 h-4 mr-1" /> Movimiento
            </Button>
          </div>
        }
      />

      {/* Month navigator */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-lg font-semibold min-w-[160px] text-center">
          {MONTHS[month - 1]} {year}
        </span>
        <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Gasto real" value={fmt(totalActualExpenses)} sub={`de ${fmt(totalBudgetedExpenses)} presupuestado`} icon={TrendingDown} color={totalActualExpenses > totalBudgetedExpenses ? "destructive" : "warning"} />
        <KPICard label="Ingreso real" value={fmt(totalActualIncome)} sub={`de ${fmt(totalBudgetedIncome)} presupuestado`} icon={TrendingUp} color="success" />
        <KPICard label="Balance presupuestado" value={fmt(netBudgeted)} sub="ingresos − gastos estimados" icon={PiggyBank} color={netBudgeted >= 0 ? "primary" : "destructive"} />
        <KPICard label="Balance real" value={fmt(netActual)} sub="ingresos − gastos reales" icon={BarChart3} color={netActual >= 0 ? "success" : "destructive"} />
      </div>

      {/* Overall progress bar */}
      {totalBudgetedExpenses > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Ejecución presupuesto de gastos</span>
            <span className={`font-semibold ${expensePct >= 90 ? "text-destructive" : expensePct >= 70 ? "text-yellow-400" : "text-emerald-400"}`}>
              {expensePct.toFixed(1)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${expensePct >= 90 ? "bg-destructive" : expensePct >= 70 ? "bg-yellow-400" : "bg-emerald-400"}`}
              style={{ width: `${expensePct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Gastado: {fmt(totalActualExpenses)}</span>
            <span>Presupuestado: {fmt(totalBudgetedExpenses)}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Cargando presupuesto...</span>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Por categoría</TabsTrigger>
            <TabsTrigger value="transactions">Movimientos ({transactions.length})</TabsTrigger>
            <TabsTrigger value="graficos">Gráficos</TabsTrigger>
            <TabsTrigger value="categories">Categorías ({categories.length})</TabsTrigger>
          </TabsList>

          {/* By-category overview */}
          <TabsContent value="overview" className="pt-3 space-y-6">
            {categories.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <PiggyBank className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No hay categorías. Cargá las por defecto o creá una.
              </div>
            ) : (
              <>
                {[{ label: "Gastos", cats: expenseCats }, { label: "Ingresos", cats: incomeCats }].map(({ label, cats }) => (
                  cats.length > 0 && (
                    <div key={label}>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">{label}</h3>
                      <div className="space-y-2">
                        {cats.map(cat => {
                          const budgeted = budgetMap[cat.id] || 0;
                          const actual = spendingMap[cat.id] || 0;
                          const pct = budgeted > 0 ? Math.min((actual / budgeted) * 100, 100) : 0;
                          const over = budgeted > 0 && actual > budgeted;
                          return (
                            <div key={cat.id} className="rounded-xl border border-border/50 bg-card p-3">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="text-lg">{cat.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-sm truncate">{cat.name}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {over && <span className="text-[10px] text-destructive font-semibold">EXCEDIDO</span>}
                                      <button
                                        onClick={() => {
                                          setEditingBudgetCat(cat);
                                          setBudgetAmount(String(budgeted || ""));
                                          setBudgetEditOpen(true);
                                        }}
                                        className="text-xs text-primary hover:underline"
                                      >
                                        {budgeted > 0 ? fmt(budgeted) : "Asignar presupuesto"}
                                      </button>
                                    </div>
                                  </div>
                                  {budgeted > 0 && (
                                    <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${over ? "bg-destructive" : pct >= 70 ? "bg-yellow-400" : "bg-emerald-400"}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex justify-between text-xs text-muted-foreground pl-8">
                                <span>Real: <strong className={over ? "text-destructive" : ""}>{fmt(actual)}</strong></span>
                                {budgeted > 0 && (
                                  <span>{pct.toFixed(0)}% ejecutado · {fmt(budgeted - actual)} {over ? "excedido" : "restante"}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                ))}
              </>
            )}
          </TabsContent>

          {/* Transactions */}
          <TabsContent value="transactions" className="pt-3">
            {transactions.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin movimientos este mes.</p>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/50 bg-muted/20">
                    <tr className="text-muted-foreground text-xs">
                      <th className="text-left px-3 py-2.5">Fecha</th>
                      <th className="text-left px-3 py-2.5">Descripción</th>
                      <th className="text-left px-3 py-2.5 hidden md:table-cell">Categoría</th>
                      <th className="text-right px-3 py-2.5">Monto</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(t => {
                      const cat = categories.find(c => c.id === t.category_id);
                      return (
                        <tr key={t.id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {new Date(t.date + "T00:00:00").toLocaleDateString("es-AR", { day:"2-digit", month:"short" })}
                          </td>
                          <td className="px-3 py-2">{t.description}</td>
                          <td className="px-3 py-2 hidden md:table-cell">
                            {cat && <span className="flex items-center gap-1 text-xs">{cat.icon} {cat.name}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            <span className={cat?.type === "income" ? "text-emerald-400" : "text-destructive"}>
                              {cat?.type === "income" ? "+" : "-"}{fmt(t.amount)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => deleteTxn(t.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* Charts */}
          <TabsContent value="graficos" className="pt-3 space-y-6">
            {chartData.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                Sin datos para graficar. Asigná presupuestos o registrá movimientos.
              </div>
            ) : (
              <>
                {/* Overall progress ring + bar */}
                <div className="rounded-2xl border border-border/50 bg-card p-5">
                  <h3 className="text-sm font-semibold mb-4">Ejecución global de gastos</h3>
                  {totalBudgetedExpenses > 0 ? (
                    <>
                      <div className="flex items-end gap-3 mb-2">
                        <span className={`text-3xl font-bold ${expensePct >= 90 ? "text-destructive" : expensePct >= 70 ? "text-warning" : "text-success"}`}>
                          {expensePct.toFixed(1)}%
                        </span>
                        <span className="text-sm text-muted-foreground mb-1">ejecutado</span>
                      </div>
                      <div className="h-4 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${expensePct >= 90 ? "bg-destructive" : expensePct >= 70 ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${Math.min(expensePct, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground mt-2">
                        <span>Real: <strong>{fmt(totalActualExpenses)}</strong></span>
                        <span>Presupuestado: <strong>{fmt(totalBudgetedExpenses)}</strong></span>
                        <span className={totalBudgetedExpenses - totalActualExpenses < 0 ? "text-destructive" : "text-success"}>
                          {totalBudgetedExpenses - totalActualExpenses >= 0 ? "Disponible: " : "Excedido: "}
                          <strong>{fmt(Math.abs(totalBudgetedExpenses - totalActualExpenses))}</strong>
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No hay presupuesto de gastos asignado.</p>
                  )}
                </div>

                {/* Presupuestado vs Real bar chart */}
                <div className="rounded-2xl border border-border/50 bg-card p-5">
                  <h3 className="text-sm font-semibold mb-4">Presupuestado vs Real por categoría</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(220 15% 55%)" }} angle={-35} textAnchor="end" interval={0} />
                      <YAxis tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} tick={{ fontSize: 10, fill: "hsl(220 15% 55%)" }} width={55} />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{ background: "hsl(228 24% 9%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(220 15% 70%)" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Bar dataKey="presupuestado" name="Presupuestado" fill="hsl(220 15% 30%)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="real" name="Real" radius={[3, 3, 0, 0]}>
                        {chartData.map((entry, i) => (
                          <Cell key={i} fill={
                            entry.type === "income"
                              ? "hsl(155 55% 45%)"
                              : entry.real > entry.presupuestado
                                ? "hsl(0 68% 55%)"
                                : "hsl(40 82% 52%)"
                          } />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Income vs Expense summary */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-border/50 bg-card p-5">
                    <h3 className="text-sm font-semibold text-success mb-3 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" /> Ingresos
                    </h3>
                    <div className="space-y-2">
                      {incomeCats.map(cat => (
                        <div key={cat.id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{cat.icon} {cat.name}</span>
                          <span className="font-semibold text-success">{fmt(spendingMap[cat.id] || 0)}</span>
                        </div>
                      ))}
                      {incomeCats.length === 0 && <p className="text-xs text-muted-foreground">Sin categorías de ingreso.</p>}
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/40 flex justify-between text-xs font-semibold">
                      <span>Total</span>
                      <span className="text-success">{fmt(totalActualIncome)}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-card p-5">
                    <h3 className="text-sm font-semibold text-destructive mb-3 flex items-center gap-1.5">
                      <TrendingDown className="w-4 h-4" /> Gastos
                    </h3>
                    <div className="space-y-2">
                      {expenseCats.map(cat => (
                        <div key={cat.id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{cat.icon} {cat.name}</span>
                          <span className={`font-semibold ${(spendingMap[cat.id] || 0) > (budgetMap[cat.id] || 0) && (budgetMap[cat.id] || 0) > 0 ? "text-destructive" : ""}`}>
                            {fmt(spendingMap[cat.id] || 0)}
                          </span>
                        </div>
                      ))}
                      {expenseCats.length === 0 && <p className="text-xs text-muted-foreground">Sin categorías de gasto.</p>}
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/40 flex justify-between text-xs font-semibold">
                      <span>Total</span>
                      <span className="text-destructive">{fmt(totalActualExpenses)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Categories manager */}
          <TabsContent value="categories" className="pt-3">
            <div className="space-y-2">
              {categories.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5">
                  <span className="text-lg">{cat.icon}</span>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="flex-1 font-medium text-sm">{cat.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${cat.type === "income" ? "bg-emerald-500/15 text-emerald-400" : "bg-destructive/15 text-destructive"}`}>
                    {cat.type === "income" ? "Ingreso" : "Gasto"}
                  </span>
                  <button onClick={() => { setEditingCat(cat); setCatForm({ name: cat.name, color: cat.color, icon: cat.icon, type: cat.type, sort_order: String(cat.sort_order) }); setCatOpen(true); }}
                    className="text-muted-foreground hover:text-primary">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteCat(cat.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-center py-8 text-muted-foreground text-sm">Sin categorías. Creá una o cargá las por defecto.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={v => { setCatOpen(v); if (!v) setEditingCat(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editingCat ? "Editar categoría" : "Nueva categoría"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Ícono (emoji)</Label>
                <Input value={catForm.icon} onChange={e => setCatForm(p => ({ ...p, icon: e.target.value }))} placeholder="💰" maxLength={4} />
              </div>
              <div><Label>Color</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={catForm.color} onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))}
                    className="h-9 w-12 rounded border border-border cursor-pointer bg-transparent" />
                  <Input value={catForm.color} onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))} className="font-mono text-sm" />
                </div>
              </div>
            </div>
            <div><Label>Nombre *</Label>
              <Input value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} placeholder="Alquiler, Sueldos..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo</Label>
                <Select value={catForm.type} onValueChange={v => setCatForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Gasto</SelectItem>
                    <SelectItem value="income">Ingreso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Orden</Label>
                <Input type="number" min="0" value={catForm.sort_order} onChange={e => setCatForm(p => ({ ...p, sort_order: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCatOpen(false); setEditingCat(null); }}>Cancelar</Button>
            <Button onClick={saveCat}>{editingCat ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget amount dialog */}
      <Dialog open={budgetEditOpen} onOpenChange={setBudgetEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Presupuesto: {editingBudgetCat?.icon} {editingBudgetCat?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>Monto presupuestado para {MONTHS[month-1]} {year}</Label>
            <Input type="number" min="0" step="0.01" value={budgetAmount}
              onChange={e => setBudgetAmount(e.target.value)}
              placeholder="0.00" className="mt-1 text-lg" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveBudget}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction dialog */}
      <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registrar movimiento</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Categoría *</Label>
              <Select value={txnForm.category_id} onValueChange={v => setTxnForm(p => ({ ...p, category_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná categoría..." /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Monto *</Label>
                <Input type="number" min="0" step="0.01" value={txnForm.amount}
                  onChange={e => setTxnForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div><Label>Fecha</Label>
                <Input type="date" value={txnForm.date} onChange={e => setTxnForm(p => ({ ...p, date: e.target.value }))} />
              </div>
            </div>
            <div><Label>Descripción *</Label>
              <Input value={txnForm.description} onChange={e => setTxnForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Pago alquiler local..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxnOpen(false)}>Cancelar</Button>
            <Button onClick={saveTxn}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
