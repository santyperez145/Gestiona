import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import {
  getExpensesDB, addExpenseDB, updateExpenseDB, deleteExpenseDB,
  buildExpenseCategories, getExpenseCategoryLabel, getSettingsDB,
  formatARS, dateToNoon, formatDateAR,
} from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Edit, Trash2, Wallet, TrendingDown, Repeat, Filter, Search, Pencil, Check, X, FileSpreadsheet, Printer, Paperclip, Camera, ExternalLink, Receipt, Target, TrendingUp, Copy, ChevronUp, ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePermissions } from "@/lib/usePermissions";

function exportExpensesCSV(expenses: any[], getCategoryLabel: (c: string) => string) {
  const header = ['Fecha', 'Descripción', 'Proveedor', 'Categoría', 'Monto (ARS)', 'Recurrente'];
  const rows = expenses.map(e => [
    e.date,
    `"${(e.description || '').replace(/"/g, '""')}"`,
    `"${(e.vendor || '').replace(/"/g, '""')}"`,
    getCategoryLabel(e.category),
    Number(e.amount_ars).toFixed(2),
    e.recurring ? 'Sí' : 'No',
  ]);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `gastos_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function printExpensesReport(expenses: any[], getCategoryLabel: (c: string) => string, businessName: string, period: string) {
  const total = expenses.reduce((s, e) => s + Number(e.amount_ars), 0);
  const byCat: Record<string, number> = {};
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount_ars); });
  const catRows = Object.entries(byCat).sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `<tr><td>${getCategoryLabel(cat)}</td><td style="text-align:right">$${amt.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td><td style="text-align:right">${((amt / total) * 100).toFixed(1)}%</td></tr>`).join('');
  const detailRows = expenses.sort((a, b) => b.date.localeCompare(a.date))
    .map(e => `<tr><td>${e.date}</td><td>${e.description || ''}</td><td>${getCategoryLabel(e.category)}</td><td style="text-align:right">$${Number(e.amount_ars).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Gastos</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}
    h1{font-size:18px;margin-bottom:4px}h2{font-size:14px;color:#555;margin-top:16px;margin-bottom:6px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th{background:#f0f0f0;text-align:left;padding:5px 8px;border-bottom:2px solid #ccc;font-size:11px}
    td{padding:4px 8px;border-bottom:1px solid #eee}
    .total{font-weight:bold;font-size:14px;margin-top:8px}
    @media print{body{margin:0}}
  </style></head><body>
    <h1>${businessName}</h1>
    <p>Reporte de Gastos · ${period} · Generado ${new Date().toLocaleDateString('es-AR')}</p>
    <p class="total">Total del período: $${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
    <h2>Por Categoría</h2>
    <table><thead><tr><th>Categoría</th><th style="text-align:right">Monto</th><th style="text-align:right">%</th></tr></thead><tbody>${catRows}</tbody></table>
    <h2>Detalle de Gastos (${expenses.length})</h2>
    <table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">Monto</th></tr></thead><tbody>${detailRows}</tbody></table>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const { canCreate, canEdit, canDelete } = usePermissions();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterVendor, setFilterVendor] = useState("all");
  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeTab, setActiveTab] = useState<'gastos' | 'presupuesto' | 'recurrentes' | 'tendencia'>('gastos');
  const [expenseSort, setExpenseSort] = useState<{ col: "date" | "amount_ars" | "category"; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });

  const [budgets, setBudgets] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("gestiona.expense_budgets") || "{}"); } catch { return {}; }
  });
  const [editBudget, setEditBudget] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");

  const categories = useMemo(() => buildExpenseCategories(settings), [settings]);

  const saveBudget = (cat: string, value: number) => {
    const next = { ...budgets, [cat]: value };
    setBudgets(next);
    localStorage.setItem("gestiona.expense_budgets", JSON.stringify(next));
    setEditBudget(null);
    setBudgetInput("");
  };

  const reload = async () => {
    if (!user) return;
    const [data, s] = await Promise.all([getExpensesDB(user.id), getSettingsDB(user.id)]);
    setExpenses(data);
    setSettings(s);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [user]);

  // Recurring overdue alert: fire once per session for recurring expenses past their next date
  useEffect(() => {
    if (!expenses.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const alertKey = "gestiona.expense_recurring_overdue_alerted";
    const alerted = new Set<string>(JSON.parse(sessionStorage.getItem(alertKey) || "[]"));
    const overdue = expenses.filter(e =>
      e.recurring &&
      e.recurring_next_date &&
      e.recurring_next_date < today &&
      !alerted.has(e.id)
    );
    if (overdue.length > 0) {
      const names = overdue.slice(0, 3).map((e: any) => e.description || "Gasto").join(", ");
      const extra = overdue.length > 3 ? ` y ${overdue.length - 3} más` : "";
      toast.warning(
        `🔄 ${overdue.length} gasto${overdue.length !== 1 ? "s" : ""} recurrente${overdue.length !== 1 ? "s" : ""} vencido${overdue.length !== 1 ? "s" : ""}: ${names}${extra}`,
        { duration: 8000 }
      );
      overdue.forEach((e: any) => alerted.add(e.id));
      sessionStorage.setItem(alertKey, JSON.stringify([...alerted]));
    }
  }, [expenses]);

  const vendorOptions = useMemo(() => {
    const vendors = [...new Set(expenses.map(e => e.vendor).filter(Boolean))].sort() as string[];
    return vendors;
  }, [expenses]);

  const filtered = useMemo(() => {
    const base = expenses.filter(e => {
      if (filterCat !== 'all' && e.category !== filterCat) return false;
      if (filterVendor !== 'all' && e.vendor !== filterVendor) return false;
      if (search) {
        const q = search.toLowerCase();
        const catLabel = getExpenseCategoryLabel(e.category, settings).toLowerCase();
        if (!e.description?.toLowerCase().includes(q) && !e.vendor?.toLowerCase().includes(q) && !catLabel.includes(q)) return false;
      }
      if (filterMonth !== 'all') {
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== filterMonth) return false;
      }
      return true;
    });
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (expenseSort.col === "date") cmp = a.date.localeCompare(b.date);
      else if (expenseSort.col === "amount_ars") cmp = Number(a.amount_ars) - Number(b.amount_ars);
      else if (expenseSort.col === "category") cmp = (a.category || "").localeCompare(b.category || "");
      return expenseSort.dir === "asc" ? cmp : -cmp;
    });
  }, [expenses, filterCat, filterMonth, search, filterVendor, expenseSort]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, e) => s + Number(e.amount_ars), 0);
    const byCat: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    filtered.forEach(e => {
      byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount_ars);
      const method = e.payment_method || "efectivo";
      byMethod[method] = (byMethod[method] || 0) + Number(e.amount_ars);
    });
    const chartData = Object.entries(byCat).map(([cat, value]) => ({
      cat,
      name: getExpenseCategoryLabel(cat, settings),
      value,
      color: categories.find(c => c.value === cat)?.color || 'hsl(220,10%,55%)',
    }));
    const methodData = Object.entries(byMethod)
      .map(([method, value]) => ({ method, value, pct: total > 0 ? Math.round((value / total) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);
    return { total, chartData, methodData, recurring: filtered.filter(e => e.recurring).length };
  }, [filtered, settings, categories]);

  // Budget alerts: warn once per session when a category hits 80%+
  const alertedCatsKey = "gestiona.expense_budget_alerted";
  useEffect(() => {
    if (!totals.chartData.length || !Object.keys(budgets).length) return;
    const alerted = new Set<string>(JSON.parse(sessionStorage.getItem(alertedCatsKey) || "[]"));
    totals.chartData.forEach(c => {
      const budget = budgets[c.cat] || 0;
      if (!budget) return;
      const pct = (c.value / budget) * 100;
      const key = `${c.cat}.${filterMonth}`;
      if (pct >= 80 && pct < 100 && !alerted.has(key)) {
        toast.warning(`⚠️ Presupuesto de "${c.name}" al ${pct.toFixed(0)}% (${formatARS(c.value)} de ${formatARS(budget)})`, { duration: 6000 });
        alerted.add(key);
      } else if (pct >= 100 && !alerted.has(key + '_over')) {
        toast.error(`🚨 Presupuesto de "${c.name}" superado (${formatARS(c.value)} > ${formatARS(budget)})`, { duration: 8000 });
        alerted.add(key + '_over');
      }
    });
    sessionStorage.setItem(alertedCatsKey, JSON.stringify([...alerted]));
  }, [totals.chartData, budgets, filterMonth]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    expenses.forEach(e => {
      const d = new Date(e.date);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return Array.from(set).sort().reverse();
  }, [expenses]);

  // Month-over-month comparison
  const prevMonthTotal = useMemo(() => {
    if (filterMonth === 'all') return null;
    const [y, m] = filterMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevFiltered = expenses.filter(e => {
      if (filterCat !== 'all' && e.category !== filterCat) return false;
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === prevKey;
    });
    const total = prevFiltered.reduce((s, e) => s + Number(e.amount_ars), 0);
    return total > 0 ? total : null;
  }, [expenses, filterMonth, filterCat]);

  const monthlyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + Number(e.amount_ars);
    });
    const sorted = Object.keys(map).sort();
    const last12 = sorted.slice(-12);
    return last12.map(key => {
      const [y, m] = key.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      return { key, label, total: map[key] };
    });
  }, [expenses]);

  const monthlyTrendByCat = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    expenses.forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const cat = e.category || 'otros';
      if (!map[key]) map[key] = {};
      map[key][cat] = (map[key][cat] || 0) + Number(e.amount_ars);
    });
    const sorted = Object.keys(map).sort().slice(-6);
    return sorted.map((key, idx) => {
      const [y, m] = key.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      const total = Object.values(map[key]).reduce((a, b) => a + b, 0);
      const prevKey = sorted[idx - 1];
      const prevTotal = prevKey ? Object.values(map[prevKey]).reduce((a, b) => a + b, 0) : null;
      const delta = prevTotal != null && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
      return { key, label, total, cats: map[key], delta };
    });
  }, [expenses]);

  const handleDelete = async (id: string) => {
    await deleteExpenseDB(id);
    if (user) await logAudit(user.id, 'delete', 'expense', id, {});
    toast.success("Gasto eliminado");
    reload();
  };

  const handleDuplicate = async (e: any) => {
    if (!user) return;
    await addExpenseDB({
      user_id: user.id,
      org_id: e.org_id,
      description: e.description,
      amount_ars: Number(e.amount_ars),
      category: e.category,
      date: new Date().toISOString().slice(0, 10),
      payment_method: e.payment_method || "efectivo",
      recurring: false,
    });
    toast.success(`Gasto duplicado para hoy`);
    reload();
  };

  if (loading) return <TableSkeleton rows={6} cols={5} />;

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Gastos Operativos"
        description="Control de egresos por categoría"
        badge={{ label: formatARS(totals.total), variant: "destructive" }}
        actions={
          <div className="flex gap-2">
            {filtered.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => exportExpensesCSV(filtered, getExpenseCategoryLabel)}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => printExpensesReport(filtered, getExpenseCategoryLabel, settings?.business_name || 'Mi Negocio', filterMonth === 'all' ? 'Todos los períodos' : filterMonth)}>
                  <Printer className="w-4 h-4 mr-2" />Imprimir
                </Button>
              </>
            )}
            {canCreate && (
              <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
                <DialogTrigger asChild>
                  <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                    <Plus className="w-4 h-4 mr-2" /> Nuevo Gasto
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-md p-0">
                  <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="font-display">{editItem ? 'Editar Gasto' : 'Registrar Gasto'}</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="max-h-[70vh] px-6 pb-6">
                    <ExpenseForm userId={user!.id} editItem={editItem} categories={categories}
                      onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard icon={TrendingDown} label="Total del período" value={formatARS(totals.total)} color="destructive" sub={`${filtered.length} gastos`} trend={prevMonthTotal ? { value: ((totals.total - prevMonthTotal) / prevMonthTotal) * 100, label: "vs mes ant." } : undefined} />
        <KPICard icon={Wallet} label="Promedio por gasto" value={filtered.length > 0 ? formatARS(totals.total / filtered.length) : "$0"} color="primary" />
        <KPICard icon={Repeat} label="Recurrentes" value={totals.recurring} color="warning" sub="se auto-generan" />
        <KPICard icon={Filter} label="Categorías activas" value={totals.chartData.length} color="blue" />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-muted/40 rounded-[10px] p-1 border border-border w-fit mb-5">
        {([
          { id: 'gastos', label: 'Gastos', icon: Receipt },
          { id: 'presupuesto', label: 'Presupuesto', icon: Target },
          { id: 'recurrentes', label: 'Recurrentes', icon: Repeat },
          { id: 'tendencia', label: 'Tendencia', icon: TrendingUp },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-card border border-border shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Filters row */}
      {(activeTab === 'gastos' || activeTab === 'recurrentes') && (
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar descripción..."
            className="w-full pl-9 pr-3 h-9 text-sm rounded-lg bg-card border border-border outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground" />
        </div>
        <Select value={filterMonth} onValueChange={setFilterMonth}>
          <SelectTrigger className="bg-card border-border w-full sm:w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los meses</SelectItem>
            {monthOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="bg-card border-border w-full sm:w-[150px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {vendorOptions.length > 0 && (
          <Select value={filterVendor} onValueChange={setFilterVendor}>
            <SelectTrigger className="bg-card border-border w-full sm:w-[160px] h-9 text-sm"><SelectValue placeholder="Proveedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proveedores</SelectItem>
              {vendorOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      )}

      {/* Gastos tab: main table */}
      {activeTab === 'gastos' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Chart */}
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Por Categoría</h2>
          {totals.chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={totals.chartData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" stroke="none">
                  {totals.chartData.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatARS(v)} contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-muted-foreground text-sm py-12 text-center">Sin datos</p>}
          <div className="space-y-3 mt-3">
            {totals.chartData.map(c => {
              const budget = budgets[c.cat] || 0;
              const pct = budget > 0 ? Math.min(100, (c.value / budget) * 100) : 0;
              const over = budget > 0 && c.value > budget;
              const isEditing = editBudget === c.cat;
              return (
                <div key={c.cat}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold font-mono ${over ? 'text-destructive' : ''}`}>{formatARS(c.value)}</span>
                      {budget > 0 && <span className="text-muted-foreground">/ {formatARS(budget)}</span>}
                      {!isEditing && (
                        <button onClick={() => { setEditBudget(c.cat); setBudgetInput(budget > 0 ? String(budget) : ""); }}
                          className="text-muted-foreground hover:text-foreground transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="flex items-center gap-1 mb-1">
                      <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
                        placeholder="Presupuesto..." autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') saveBudget(c.cat, parseFloat(budgetInput) || 0); if (e.key === 'Escape') { setEditBudget(null); setBudgetInput(""); }}}
                        className="flex-1 h-6 text-xs px-2 rounded bg-muted border border-border outline-none focus:ring-1 focus:ring-primary/40" />
                      <button onClick={() => saveBudget(c.cat, parseFloat(budgetInput) || 0)} className="text-green-400 hover:text-green-300"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setEditBudget(null); setBudgetInput(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  {budget > 0 && (
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${over ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Table */}
        <div className="lg:col-span-2 bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-3 border-b border-border">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Listado</h2>
            <span className="text-xs text-muted-foreground">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={Wallet} title="Sin gastos en este mes" description="Registrá tus gastos operativos para llevar el control de tu rentabilidad neta." actionLabel="Nuevo Gasto" onAction={() => setOpen(true)} />
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {([
                        { col: "date" as const, label: "Fecha", align: "left" },
                        { col: "category" as const, label: "Categoría", align: "left" },
                      ]).map(h => (
                        <th key={h.col} className={`text-${h.align} px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none`}
                          onClick={() => setExpenseSort(s => ({ col: h.col, dir: s.col === h.col && s.dir === "asc" ? "desc" : "asc" }))}>
                          <span className="inline-flex items-center gap-1">{h.label}
                            {expenseSort.col === h.col ? (expenseSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                          </span>
                        </th>
                      ))}
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descripción</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                        onClick={() => setExpenseSort(s => ({ col: "amount_ars", dir: s.col === "amount_ars" && s.dir === "desc" ? "asc" : "desc" }))}>
                        <span className="inline-flex items-center gap-1 justify-end">Monto
                          {expenseSort.col === "amount_ars" ? (expenseSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                        </span>
                      </th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map(e => {
                      const catCfg = categories.find(c => c.value === e.category);
                      return (
                        <tr key={e.id} className="hover:bg-muted/20 transition-colors group">
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateAR(e.date)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-semibold" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                              {getExpenseCategoryLabel(e.category, settings)}
                              {e.recurring && <Repeat className="w-2.5 h-2.5" />}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate">{e.description || '—'}</p>
                              {e.receipt_url && (
                                <a href={e.receipt_url} target="_blank" rel="noreferrer" title="Ver recibo" className="text-primary hover:text-primary/80 shrink-0">
                                  <Paperclip className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {e.vendor && (
                              <p className="text-[10px] text-amber-400/80 mt-0.5 truncate">{e.vendor}</p>
                            )}
                            {e.recurring && e.recurring_next_date && (
                              <p className="text-[10px] text-warning/70 mt-0.5">
                                próx. {new Date(e.recurring_next_date).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-destructive">-{formatARS(Number(e.amount_ars))}</td>
                          {(canEdit || canDelete) && (
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {canEdit && (
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Duplicar para hoy" onClick={() => handleDuplicate(e)}>
                                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                                  </Button>
                                )}
                                {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(e); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>}
                                {canDelete && (
                                  <ConfirmDialog
                                    trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                                    title="¿Eliminar gasto?"
                                    description={`Se eliminará el gasto de ${formatARS(Number(e.amount_ars))}.`}
                                    confirmText="Eliminar"
                                    onConfirm={() => handleDelete(e.id)}
                                  />
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-2 p-3">
                {filtered.map(e => {
                  const catCfg = categories.find(c => c.value === e.category);
                  return (
                    <div key={e.id} className="bg-muted/30 border border-border rounded-[10px] p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-[5px] font-medium" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                              {getExpenseCategoryLabel(e.category, settings)}
                            </span>
                            {e.recurring && <Repeat className="w-3 h-3 text-warning" />}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-muted-foreground truncate">{e.description || 'Sin descripción'}</p>
                            {e.receipt_url && (
                              <a href={e.receipt_url} target="_blank" rel="noreferrer" title="Ver recibo" className="text-primary shrink-0">
                                <Paperclip className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground/60">
                            {formatDateAR(e.date)}
                            {e.recurring && e.recurring_next_date && (
                              <span className="ml-2 text-warning/70">
                                próx. {new Date(e.recurring_next_date).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-destructive shrink-0">-{formatARS(Number(e.amount_ars))}</span>
                      </div>
                      {(canEdit || canDelete) && (
                        <div className="flex justify-end gap-1 mt-2">
                          {canEdit && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Duplicar para hoy" onClick={() => handleDuplicate(e)}>
                              <Copy className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          )}
                          {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(e); setOpen(true); }}><Edit className="w-3 h-3" /></Button>}
                          {canDelete && (
                            <ConfirmDialog
                              trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                              title="¿Eliminar gasto?"
                              confirmText="Eliminar"
                              onConfirm={() => handleDelete(e.id)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Payment method summary footer */}
              {filtered.length > 0 && totals.methodData.length > 0 && (
                <div className="border-t border-border/60 px-4 py-3 bg-muted/20">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total por método de pago</p>
                  <div className="flex flex-wrap gap-2">
                    {totals.methodData.map(({ method, value, pct }) => {
                      const METHOD_LABELS: Record<string, string> = {
                        efectivo: "Efectivo", transferencia: "Transferencia",
                        tarjeta_debito: "Débito", tarjeta_credito: "Crédito",
                        mercadopago: "MercadoPago", cheque: "Cheque", otro: "Otro",
                      };
                      const METHOD_COLORS: Record<string, string> = {
                        efectivo: "text-green-400", transferencia: "text-blue-400",
                        tarjeta_debito: "text-purple-400", tarjeta_credito: "text-yellow-400",
                        mercadopago: "text-cyan-400", cheque: "text-orange-400", otro: "text-muted-foreground",
                      };
                      return (
                        <div key={method} className="flex items-center gap-1.5 bg-muted/50 border border-border/60 rounded-lg px-2.5 py-1.5">
                          <span className={`text-[11px] font-semibold ${METHOD_COLORS[method] || "text-muted-foreground"}`}>
                            {METHOD_LABELS[method] || method}
                          </span>
                          <span className="text-xs font-bold text-foreground">{formatARS(value)}</span>
                          <span className="text-[10px] text-muted-foreground">({pct}%)</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-1.5 ml-auto">
                      <span className="text-[11px] font-semibold text-destructive">Total</span>
                      <span className="text-xs font-bold text-destructive">{formatARS(totals.total)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Presupuesto tab */}
      {activeTab === 'presupuesto' && (
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Presupuesto por Categoría</h2>
          {totals.chartData.length === 0 ? (
            <p className="text-muted-foreground text-sm py-12 text-center">Sin datos para el período seleccionado</p>
          ) : (
            <div className="space-y-4">
              {totals.chartData.map(c => {
                const budget = budgets[c.cat] || 0;
                const pct = budget > 0 ? Math.min(100, (c.value / budget) * 100) : 0;
                const over = budget > 0 && c.value > budget;
                const isEditing = editBudget === c.cat;
                return (
                  <div key={c.cat}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="font-medium">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold font-mono ${over ? 'text-destructive' : ''}`}>{formatARS(c.value)}</span>
                        {budget > 0 && <span className="text-muted-foreground">/ {formatARS(budget)}</span>}
                        {!isEditing && (
                          <button onClick={() => { setEditBudget(c.cat); setBudgetInput(budget > 0 ? String(budget) : ""); }}
                            className="text-muted-foreground hover:text-foreground transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isEditing && (
                      <div className="flex items-center gap-1 mb-2">
                        <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
                          placeholder="Presupuesto..." autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveBudget(c.cat, parseFloat(budgetInput) || 0); if (e.key === 'Escape') { setEditBudget(null); setBudgetInput(""); }}}
                          className="flex-1 h-8 text-sm px-2 rounded bg-muted border border-border outline-none focus:ring-1 focus:ring-primary/40" />
                        <button onClick={() => saveBudget(c.cat, parseFloat(budgetInput) || 0)} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
                        <button onClick={() => { setEditBudget(null); setBudgetInput(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                    <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${over ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: budget > 0 ? `${pct}%` : '0%' }} />
                    </div>
                    {budget > 0 && (
                      <p className={`text-xs mt-1 ${over ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {over ? `Excedido en ${formatARS(c.value - budget)}` : `Disponible: ${formatARS(budget - c.value)} (${(100 - pct).toFixed(0)}%)`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recurrentes tab */}
      {activeTab === 'recurrentes' && (
        <>
        {/* Upcoming recurring expenses */}
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const next30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          const upcoming = expenses
            .filter(e => e.recurring && e.recurring_next_date && e.recurring_next_date >= today && e.recurring_next_date <= next30)
            .sort((a, b) => (a.recurring_next_date || '').localeCompare(b.recurring_next_date || ''));
          const totalUpcoming = upcoming.reduce((s, e) => s + Number(e.amount_ars), 0);
          if (upcoming.length === 0) return null;
          return (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-amber-400">📅 Próximos vencimientos (30 días)</h3>
                <span className="text-xs font-bold text-amber-400">{formatARS(totalUpcoming)}</span>
              </div>
              <div className="space-y-2">
                {upcoming.slice(0, 6).map(e => {
                  const daysUntil = Math.ceil((new Date(e.recurring_next_date!).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-foreground/80 truncate">{e.description || getExpenseCategoryLabel(e.category, settings)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${daysUntil <= 3 ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                          {daysUntil === 0 ? 'Hoy' : daysUntil === 1 ? 'Mañana' : `en ${daysUntil}d`}
                        </span>
                        <span className="font-medium text-destructive">{formatARS(Number(e.amount_ars))}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-3 border-b border-border">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Gastos Recurrentes</h2>
            <span className="text-xs text-muted-foreground">{filtered.filter(e => e.recurring).length} recurrente{filtered.filter(e => e.recurring).length !== 1 ? "s" : ""}</span>
          </div>
          {filtered.filter(e => e.recurring).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No hay gastos recurrentes registrados</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.filter(e => e.recurring).map(e => {
                const catCfg = categories.find(c => c.value === e.category);
                return (
                  <div key={e.id} className="flex items-center gap-3 p-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-semibold shrink-0" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                      <Repeat className="w-3 h-3" />
                      {getExpenseCategoryLabel(e.category, settings)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{e.description || '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.recurring_frequency === 'monthly' ? 'Mensual' : e.recurring_frequency === 'weekly' ? 'Semanal' : e.recurring_frequency === 'yearly' ? 'Anual' : 'Diario'}
                        {e.recurring_next_date && ` · próx. ${new Date(e.recurring_next_date).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}`}
                      </p>
                    </div>
                    <span className="font-bold text-destructive font-mono shrink-0">-{formatARS(Number(e.amount_ars))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </>
      )}

      {/* Monthly trend chart */}
      {activeTab === 'tendencia' && monthlyTrend.length > 1 && (
        <div className="space-y-4 mb-6">
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 shadow-card">
            <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Tendencia mensual de gastos</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(220,10%,55%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(220,10%,55%)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip
                  formatter={(v: number) => [formatARS(v), 'Total']}
                  contentStyle={{ background: 'hsl(220,18%,12%)', border: '1px solid hsl(220,15%,18%)', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: 'hsl(220,15%,18%)' }}
                />
                <Bar dataKey="total" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={48}
                  label={{ position: 'top', fontSize: 10, fill: 'hsl(220,10%,55%)', formatter: (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : '' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Stacked bar chart per category */}
          {monthlyTrendByCat.length > 1 && (() => {
            const allCats = Array.from(new Set(expenses.map(e => e.category || 'otros')));
            const CAT_COLORS = ["hsl(var(--destructive))", "hsl(221,83%,53%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(290,60%,55%)", "hsl(180,60%,45%)", "hsl(0,0%,50%)"];
            const chartData = monthlyTrendByCat.map(m => {
              const row: Record<string, number | string> = { label: m.label };
              allCats.forEach(cat => { row[cat] = m.cats[cat] || 0; });
              return row;
            });
            return (
              <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 shadow-card">
                <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Distribución por categoría</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(220,10%,55%)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(220,10%,55%)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatARS(v), getExpenseCategoryLabel(name, settings)]}
                      contentStyle={{ background: 'hsl(220,18%,12%)', border: '1px solid hsl(220,15%,18%)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend formatter={name => getExpenseCategoryLabel(name, settings)} wrapperStyle={{ fontSize: 10, color: 'hsl(220,10%,55%)' }} />
                    {allCats.map((cat, i) => (
                      <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLORS[i % CAT_COLORS.length]} maxBarSize={48}
                        radius={i === allCats.length - 1 ? [4, 4, 0, 0] : undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Month-over-month comparison table */}
          {monthlyTrendByCat.length > 1 && (
            <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 shadow-card">
              <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Comparativa mensual por categoría</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Categoría</th>
                      {monthlyTrendByCat.map(m => (
                        <th key={m.key} className="text-right py-2 px-2 text-muted-foreground font-medium min-w-[80px]">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set(expenses.map(e => e.category || 'otros'))).map(cat => (
                      <tr key={cat} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="py-2 pr-4 font-medium">{getExpenseCategoryLabel(cat, settings)}</td>
                        {monthlyTrendByCat.map(m => (
                          <td key={m.key} className="py-2 px-2 text-right font-mono text-muted-foreground">
                            {m.cats[cat] ? formatARS(m.cats[cat]).replace('$', '').trim() : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="py-2 pr-4">Total</td>
                      {monthlyTrendByCat.map(m => (
                        <td key={m.key} className="py-2 px-2 text-right">
                          <div>{formatARS(m.total).replace('$', '').trim()}</div>
                          {m.delta !== null && (
                            <div className={`text-[10px] font-medium ${m.delta > 0 ? 'text-destructive' : 'text-success'}`}>
                              {m.delta > 0 ? '▲' : '▼'}{Math.abs(m.delta).toFixed(0)}%
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AI-assisted expense category inference ─────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  alquiler:      ["alquiler", "rent", "inmobiliaria", "local", "oficina", "deposito", "bodega", "mensualidad", "arriendo"],
  servicios:     ["luz", "electricidad", "edesur", "edenor", "agua", "gas", "metrogas", "telefono", "internet", "fibertel", "claro", "personal", "movistar", "telecom", "wifi", "servicio"],
  personal:      ["sueldo", "salario", "empleado", "jornal", "personal", "rrhh", "recursos humanos", "liquidacion", "aguinaldo", "jornada"],
  marketing:     ["marketing", "publicidad", "facebook", "instagram", "google ads", "meta ads", "tiktok", "campaña", "flyer", "banner", "redes", "digital", "influencer", "promo", "diseño"],
  mantenimiento: ["mantenimiento", "reparacion", "arreglo", "plomero", "electricista", "tecnico", "limpieza", "pintura", "refaccion", "obra"],
  fletes:        ["flete", "envio", "correo", "andreani", "oca", "chilexpress", "despacho", "moto", "delivery", "transporte", "logistica"],
  impuestos:     ["impuesto", "afip", "iva", "ingresos brutos", "iibb", "monotributo", "ganancias", "arba", "agip", "patente", "contribucion", "tasa"],
  bancarios:     ["banco", "comision bancaria", "transferencia", "mercadopago", "tarjeta", "cuota", "interes", "prestamo", "debito", "credito", "cuenta corriente"],
  insumos:       ["insumo", "material", "bolsa", "caja", "embalaje", "packaging", "etiqueta", "papel", "toner", "cartridge", "herramienta", "repuesto", "stock", "mercaderia", "proveedor"],
};

function inferExpenseCategory(description: string, vendor: string): string | null {
  const text = `${description} ${vendor}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let best: { cat: string; score: number } = { cat: "", score: 0 };
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? kw.length : 0), 0);
    if (score > best.score) best = { cat, score };
  }
  return best.score > 0 ? best.cat : null;
}

function ExpenseForm({ userId, editItem, categories, onSave }: { userId: string; editItem?: any; categories: { value: string; label: string; color: string }[]; onSave: () => void }) {
  const [amount, setAmount] = useState(editItem ? String(editItem.amount_ars) : '');
  const [category, setCategory] = useState(editItem?.category || categories[0]?.value || 'otros');
  const [description, setDescription] = useState(editItem?.description || '');
  const [vendor, setVendor] = useState(editItem?.vendor || '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(editItem?.recurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState<string>(editItem?.recurring_frequency || 'monthly');
  const [submitting, setSubmitting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string>(editItem?.receipt_url || '');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptCamRef = useRef<HTMLInputElement>(null);
  const [suggestedCategory, setSuggestedCategory] = useState<string | null>(null);

  // Auto-suggest category when description or vendor changes (debounced 400ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (editItem) return; // Don't auto-suggest when editing
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const inferred = inferExpenseCategory(description, vendor);
      setSuggestedCategory(inferred !== category ? inferred : null);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [description, vendor, category, editItem]);

  const handleReceiptFile = async (file: File) => {
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `receipts/${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
      setReceiptUrl(urlData.publicUrl);
      toast.success('Recibo adjuntado');
    } catch (err: any) {
      toast.error('Error al subir recibo: ' + (err.message || err));
    } finally {
      setUploadingReceipt(false);
      if (receiptInputRef.current) receiptInputRef.current.value = '';
      if (receiptCamRef.current) receiptCamRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Monto inválido");
      return;
    }
    setSubmitting(true);
    try {
      // Calculate next_date based on frequency
      const startDate = new Date(date);
      let nextDate: Date | null = null;
      if (recurring) {
        nextDate = new Date(startDate);
        switch (recurringFrequency) {
          case "daily":  nextDate.setDate(nextDate.getDate() + 1); break;
          case "weekly": nextDate.setDate(nextDate.getDate() + 7); break;
          case "yearly": nextDate.setFullYear(nextDate.getFullYear() + 1); break;
          default: nextDate.setMonth(nextDate.getMonth() + 1);
        }
      }
      const data: any = {
        user_id: userId,
        amount_ars: parseFloat(amount),
        category,
        description: description || null,
        vendor: vendor.trim() || null,
        date: dateToNoon(date),
        recurring,
        recurring_frequency: recurring ? recurringFrequency : null,
        recurring_next_date: nextDate ? nextDate.toISOString().slice(0, 10) : null,
        receipt_url: receiptUrl || null,
      };
      if (editItem) {
        await updateExpenseDB(editItem.id, data);
        await logAudit(userId, 'update', 'expense', editItem.id, data);
        toast.success("Gasto actualizado");
      } else {
        await addExpenseDB(data);
        await logAudit(userId, 'create', 'expense', null, data);
        toast.success("Gasto registrado");
      }
      onSave();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div>
        <label className="text-sm text-muted-foreground">Monto (ARS) *</label>
        <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="0.00" className="bg-muted border-border" required />
      </div>

      <div>
        <label className="text-sm text-muted-foreground">Categoría *</label>
        <Select value={category} onValueChange={(v) => { setCategory(v); setSuggestedCategory(null); }}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {suggestedCategory && (() => {
          const cat = categories.find(c => c.value === suggestedCategory);
          if (!cat) return null;
          return (
            <button
              type="button"
              onClick={() => { setCategory(suggestedCategory); setSuggestedCategory(null); }}
              className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              IA sugiere: <span className="font-bold">{cat.label}</span>
              <span className="opacity-60 ml-1">— Clic para aplicar</span>
            </button>
          );
        })()}
      </div>

      <div>
        <label className="text-sm text-muted-foreground">Descripción</label>
        <Input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Ej: Alquiler local — abril" className="bg-muted border-border" />
      </div>

      <div>
        <label className="text-sm text-muted-foreground">Proveedor / Pagado a <span className="text-[10px] opacity-60">(opcional)</span></label>
        <Input value={vendor} onChange={e => setVendor(e.target.value)}
          placeholder="Ej: Edesur, Telefónica, Proveedor XYZ..." className="bg-muted border-border" />
      </div>

      <div>
        <label className="text-sm text-muted-foreground">Fecha</label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" />
      </div>

      <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5"><Repeat className="w-4 h-4 text-warning" />Gasto recurrente</p>
            <p className="text-xs text-muted-foreground">Se genera automáticamente en la próxima fecha</p>
          </div>
          <Switch checked={recurring} onCheckedChange={setRecurring} />
        </div>
        {recurring && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Frecuencia</label>
            <Select value={recurringFrequency} onValueChange={setRecurringFrequency}>
              <SelectTrigger className="bg-muted border-border h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diario</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensual</SelectItem>
                <SelectItem value="yearly">Anual</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Próxima generación automática: {(() => {
                try {
                  const d = new Date(date);
                  if (recurringFrequency === "daily") d.setDate(d.getDate() + 1);
                  else if (recurringFrequency === "weekly") d.setDate(d.getDate() + 7);
                  else if (recurringFrequency === "yearly") d.setFullYear(d.getFullYear() + 1);
                  else d.setMonth(d.getMonth() + 1);
                  return d.toLocaleDateString("es-AR", { dateStyle: "medium" });
                } catch { return "—"; }
              })()}
            </p>
          </div>
        )}
      </div>

      {/* Receipt upload */}
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" />Recibo / Comprobante</label>
        {receiptUrl ? (
          <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg p-2">
            <img src={receiptUrl} alt="recibo" className="w-12 h-12 object-cover rounded" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-success font-medium">Recibo adjuntado</p>
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="text-[10px] text-primary flex items-center gap-1 hover:underline">
                <ExternalLink className="w-3 h-3" />Ver original
              </a>
            </div>
            <button type="button" onClick={() => setReceiptUrl('')} className="text-muted-foreground hover:text-destructive transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => receiptInputRef.current?.click()} disabled={uploadingReceipt}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50">
              {uploadingReceipt ? <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
              {uploadingReceipt ? 'Subiendo...' : 'Adjuntar archivo'}
            </button>
            <button type="button" onClick={() => receiptCamRef.current?.click()} disabled={uploadingReceipt}
              className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors sm:hidden disabled:opacity-50">
              <Camera className="w-3.5 h-3.5" />Foto
            </button>
          </div>
        )}
        <input ref={receiptInputRef} type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); }} className="hidden" />
        <input ref={receiptCamRef} type="file" accept="image/*" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); }} className="hidden" />
      </div>

      <Button type="submit" disabled={submitting} className="w-full gradient-gold text-primary-foreground font-semibold">
        {submitting ? 'Guardando...' : editItem ? 'Actualizar' : 'Registrar Gasto'}
      </Button>
    </form>
  );
}
