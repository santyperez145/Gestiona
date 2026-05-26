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
import {
  PiggyBank, Plus, ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  Pencil, Trash2, Sparkles, ArrowUpRight, ArrowDownRight,
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PiggyBank className="w-6 h-6 text-primary" /> Presupuesto Mensual
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Planificá ingresos y gastos por categoría, con seguimiento en tiempo real.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.length === 0 && (
            <Button variant="outline" onClick={seedCategories}>
              <Sparkles className="w-4 h-4 mr-1" /> Cargar categorías por defecto
            </Button>
          )}
          <Button variant="outline" onClick={() => { setEditingCat(null); setCatForm({ name: "", color: "#6366f1", icon: "💰", type: "expense", sort_order: "0" }); setCatOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Categoría
          </Button>
          <Button onClick={() => setTxnOpen(true)} disabled={categories.length === 0}>
            <Plus className="w-4 h-4 mr-1" /> Movimiento
          </Button>
        </div>
      </div>

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
        {[
          { label: "Gasto real", value: fmt(totalActualExpenses), sub: `de ${fmt(totalBudgetedExpenses)} pres.`, icon: TrendingDown, bad: totalActualExpenses > totalBudgetedExpenses },
          { label: "Ingreso real", value: fmt(totalActualIncome), sub: `de ${fmt(totalBudgetedIncome)} pres.`, icon: TrendingUp, bad: false },
          { label: "Balance presupuestado", value: fmt(netBudgeted), sub: "ingresos − gastos", icon: PiggyBank, bad: netBudgeted < 0 },
          { label: "Balance real", value: fmt(netActual), sub: "ingresos − gastos", icon: PiggyBank, bad: netActual < 0 },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className={`text-xl font-bold ${k.bad ? "text-destructive" : ""}`}>{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
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
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Por categoría</TabsTrigger>
            <TabsTrigger value="transactions">Movimientos ({transactions.length})</TabsTrigger>
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
