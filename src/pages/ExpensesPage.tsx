import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Plus, Edit, Trash2, Wallet, TrendingDown, Repeat, Filter, Search, Pencil, Check, X, FileSpreadsheet, Printer, Paperclip, Camera, ExternalLink, Receipt, Target, TrendingUp, Copy, ChevronUp, ChevronDown, Sparkles, AlertCircle, RefreshCw, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import ReceiptScanner from "@/components/shared/ReceiptScanner";
import { logAudit } from "@/lib/auditLog";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { useModulePermissions } from "@/lib/usePermissions";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import {
  createExpenseReceiptUrl,
  removeExpenseReceipt,
  uploadExpenseReceipt,
  validateExpenseReceipt,
} from "@/lib/expenseReceipts";
import {
  expenseBudgetMap,
  expenseBudgetPeriod,
  expenseBudgetSpendByCategory,
  getExpenseBudgets,
  setExpenseBudget,
} from "@/lib/financeBudgets";

import { plural } from "@/lib/plural";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import EmptyState from "@/components/shared/EmptyState";

function ExpenseReceiptLink({
  reference,
  compact = false,
}: {
  reference: string;
  compact?: boolean;
}) {
  const [opening, setOpening] = useState(false);

  const openReceipt = async () => {
    if (opening) return;
    // Abrir la pestaña dentro del gesto evita el bloqueo de popups mientras
    // se emite la URL firmada. `opener = null` impide reverse tabnabbing.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setOpening(true);
    try {
      const url = await createExpenseReceiptUrl(reference);
      if (!tab) {
        toast.error("Permití ventanas emergentes para ver el comprobante");
        return;
      }
      tab.location.replace(url);
    } catch (error) {
      tab?.close();
      console.error("No se pudo abrir el comprobante", error);
      toast.error("No se pudo abrir el comprobante. Reintentá.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={openReceipt}
      disabled={opening}
      title={opening ? "Preparando comprobante" : "Ver comprobante"}
      aria-label={opening ? "Preparando comprobante" : "Ver comprobante"}
      className={compact
        ? "text-primary hover:text-primary/80 shrink-0 disabled:opacity-50"
        : "text-[10px] text-primary inline-flex items-center gap-1 hover:underline disabled:opacity-50"}
    >
      {compact ? <Paperclip className="w-3 h-3" /> : <><ExternalLink className="w-3 h-3" />Ver original</>}
    </button>
  );
}

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
  usePageTitle("Gastos");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { canCreate, canEdit, canDelete } = useModulePermissions("expenses");
  const [expenses, setExpenses] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filterCat, setFilterCat] = usePersistedState(
    orgViewKey("expenses.category-filter", activeOrg?.id),
    "all",
  );
  const [filterVendor, setFilterVendor] = usePersistedState(
    orgViewKey("expenses.vendor-filter", activeOrg?.id),
    "all",
  );
  const [search, setSearch] = usePersistedState(
    orgViewKey("expenses.search", activeOrg?.id),
    "",
  );
  const currentMonthKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();
  const [filterMonth, setFilterMonth] = usePersistedState(
    orgViewKey("expenses.month-filter", activeOrg?.id),
    currentMonthKey,
  );
  const [activeTab, setActiveTab] = usePersistedState<'gastos' | 'presupuesto' | 'recurrentes' | 'tendencia'>(
    orgViewKey("expenses.tab", activeOrg?.id),
    "gastos",
  );
  const [viewParams, setViewParams] = useSearchParams();
  const [expenseSort, setExpenseSort] = useState<{ col: "date" | "amount_ars" | "category"; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });

  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState<string | null>(null);
  const [editBudget, setEditBudget] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");

  const categories = useMemo(() => buildExpenseCategories(settings), [settings]);
  const selectedBudgetPeriod = useMemo(() => expenseBudgetPeriod(filterMonth), [filterMonth]);

  useEffect(() => {
    const requestedTab = viewParams.get("vista");
    if (
      requestedTab
      && ["gastos", "presupuesto", "recurrentes", "tendencia"].includes(requestedTab)
      && requestedTab !== activeTab
    ) {
      setActiveTab(requestedTab as typeof activeTab);
    }
    const requestedPeriod = viewParams.get("periodo");
    if (requestedPeriod && expenseBudgetPeriod(requestedPeriod) && requestedPeriod !== filterMonth) {
      setFilterMonth(requestedPeriod);
    }
  }, [activeTab, filterMonth, setActiveTab, setFilterMonth, viewParams]);

  const selectExpenseTab = useCallback((tab: typeof activeTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(viewParams);
    if (tab === "gastos") next.delete("vista");
    else next.set("vista", tab);
    if (tab === "presupuesto") next.set("periodo", filterMonth);
    else next.delete("periodo");
    setViewParams(next, { replace: true });
  }, [filterMonth, setActiveTab, setViewParams, viewParams]);

  const selectBudgetMonth = useCallback((month: string) => {
    setFilterMonth(month);
    const next = new URLSearchParams(viewParams);
    next.set("vista", "presupuesto");
    next.set("periodo", month);
    setViewParams(next, { replace: true });
  }, [setFilterMonth, setViewParams, viewParams]);

  useEffect(() => {
    if (activeTab === "presupuesto" && !selectedBudgetPeriod) setFilterMonth(currentMonthKey);
  }, [activeTab, currentMonthKey, selectedBudgetPeriod, setFilterMonth]);

  const saveBudget = async (cat: string, value: number) => {
    if (!activeOrg?.id || !selectedBudgetPeriod || !canEdit) return;
    if (value < 0 || !Number.isFinite(value)) {
      toast.error("Ingresá un monto de presupuesto válido");
      return;
    }
    const category = categories.find(item => item.value === cat) ?? {
      value: cat,
      label: getExpenseCategoryLabel(cat, settings),
    };
    setSavingBudget(cat);
    try {
      await setExpenseBudget({
        orgId: activeOrg.id,
        categoryKey: category.value,
        categoryName: category.label,
        period: selectedBudgetPeriod,
        amount: value,
      });
      setBudgets(previous => ({ ...previous, [cat]: value }));
      setEditBudget(null);
      setBudgetInput("");
      setBudgetsError(null);
      toast.success(`Presupuesto de ${category.label} actualizado`);
    } catch (error) {
      console.error("No se pudo guardar el presupuesto", error);
      toast.error("No pudimos guardar el presupuesto. Reintentá.");
    } finally {
      setSavingBudget(null);
    }
  };

  const reload = useCallback(async () => {
    if (!user?.id || !activeOrg?.id) {
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      const [data, s] = await Promise.all([
        getExpensesDB(user.id, activeOrg.id),
        getSettingsDB(user.id, activeOrg.id),
      ]);
      setExpenses(data);
      setSettings(s);
    } catch (error) {
      console.error("No se pudieron cargar los gastos", error);
      setLoadError("No pudimos cargar los gastos de la organización.");
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id, user?.id]);

  useEffect(() => { void reload(); }, [reload]);

  const loadBudgets = useCallback(async () => {
    if (!activeOrg?.id || !selectedBudgetPeriod) {
      setBudgets({});
      setBudgetsError(null);
      return;
    }
    setBudgetsLoading(true);
    setBudgetsError(null);
    try {
      const rows = await getExpenseBudgets(activeOrg.id, selectedBudgetPeriod);
      setBudgets(expenseBudgetMap(rows));
    } catch (error) {
      console.error("No se pudieron cargar los presupuestos", error);
      setBudgets({});
      setBudgetsError("No pudimos cargar los presupuestos de este período.");
    } finally {
      setBudgetsLoading(false);
    }
  }, [activeOrg?.id, selectedBudgetPeriod]);

  useEffect(() => {
    setEditBudget(null);
    setBudgetInput("");
    void loadBudgets();
  }, [loadBudgets]);

  // Recurring overdue alert: fire once per session for recurring expenses past their next date
  useEffect(() => {
    if (!expenses.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const alertKey = `gestiona.expense_recurring_overdue_alerted.${activeOrg?.id || "default"}`;
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
  }, [activeOrg?.id, expenses]);

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
  }, [expenses, filterCat, filterMonth, search, filterVendor, expenseSort, settings]);

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
      color: categories.find(c => c.value === cat)?.color || 'hsl(var(--muted-foreground))',
    }));
    const methodData = Object.entries(byMethod)
      .map(([method, value]) => ({ method, value, pct: total > 0 ? Math.round((value / total) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);
    return { total, chartData, methodData, recurring: filtered.filter(e => e.recurring).length };
  }, [filtered, settings, categories]);

  const budgetSpentByCategory = useMemo(
    () => selectedBudgetPeriod
      ? expenseBudgetSpendByCategory(expenses, selectedBudgetPeriod)
      : {},
    [expenses, selectedBudgetPeriod],
  );

  const budgetRows = useMemo(() => {
    const visibleCategories = [...categories];
    const knownKeys = new Set(visibleCategories.map(category => category.value));
    const historicalKeys = new Set([
      ...Object.keys(budgetSpentByCategory),
      ...Object.keys(budgets),
    ]);
    for (const categoryKey of historicalKeys) {
      if (knownKeys.has(categoryKey)) continue;
      visibleCategories.push({
        value: categoryKey,
        label: getExpenseCategoryLabel(categoryKey, settings),
        color: "hsl(var(--muted-foreground))",
      });
    }
    return visibleCategories.map(category => ({
      cat: category.value,
      name: category.label,
      color: category.color,
      value: budgetSpentByCategory[category.value] ?? 0,
      budget: budgets[category.value] ?? 0,
    }));
  }, [budgetSpentByCategory, budgets, categories, settings]);

  const budgetSummary = useMemo(() => {
    const assigned = budgetRows.reduce((sum, row) => sum + row.budget, 0);
    const spent = budgetRows.reduce((sum, row) => sum + row.value, 0);
    return { assigned, spent, available: assigned - spent };
  }, [budgetRows]);

  const budgetPeriodLabel = useMemo(() => {
    if (!selectedBudgetPeriod) return "Período mensual";
    return new Date(selectedBudgetPeriod.year, selectedBudgetPeriod.month - 1, 1)
      .toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  }, [selectedBudgetPeriod]);

  // Budget alerts: warn once per session when a category hits 80%+
  const alertedCatsKey = `gestiona.expense_budget_alerted.${activeOrg?.id || "default"}`;
  useEffect(() => {
    if (budgetsLoading || budgetsError || !Object.keys(budgets).length) return;
    const alerted = new Set<string>(JSON.parse(sessionStorage.getItem(alertedCatsKey) || "[]"));
    budgetRows.forEach(c => {
      const budget = c.budget;
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
  }, [alertedCatsKey, budgetRows, budgets, budgetsError, budgetsLoading, filterMonth]);

  const monthOptions = useMemo(() => {
    const now = new Date();
    const set = new Set<string>([`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`]);
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

  if (loadError) {
    return (
      <div className="flex min-h-[420px] items-center justify-center px-4">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto mb-4 h-9 w-9 text-destructive" />
          <h1 className="text-lg font-semibold text-foreground">No pudimos abrir Gastos</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-5" variant="outline" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Wallet}
        eyebrow="Finance · Core"
        title="Gastos Operativos"
        description="Egresos por categoría — puente al margen real sin duplicar el Core."
        badge={{ label: formatARS(totals.total), variant: "destructive" }}
        actions={
          <div className="flex flex-wrap gap-2">
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
                  <Button className="font-semibold">
                    <Plus className="w-4 h-4 mr-2" /> Nuevo Gasto
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border/60 max-w-md p-0">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={TrendingDown} label="Total del período" value={formatARS(totals.total)} color="destructive" sub={plural(filtered.length, "gasto")} trend={prevMonthTotal ? { value: ((totals.total - prevMonthTotal) / prevMonthTotal) * 100, label: "vs mes ant." } : undefined} />
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
          <button key={tab.id} onClick={() => selectExpenseTab(tab.id)}
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="bg-card border border-border/60 rounded-[10px] p-4 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Por Categoría</h2>
          {totals.chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={totals.chartData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" stroke="none">
                  {totals.chartData.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatARS(v)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-muted-foreground text-sm py-12 text-center">Sin datos</p>}
          <div className="space-y-3 mt-3">
            {totals.chartData.map(c => {
              return (
                <div key={c.cat} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="truncate font-medium">{c.name}</span>
                  </div>
                  <span className="shrink-0 font-mono font-semibold">{formatARS(c.value)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Table */}
        <div className="lg:col-span-2 bg-card border border-border/60 rounded-[10px] shadow-card overflow-hidden">
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
                              {e.receipt_url && <ExpenseReceiptLink reference={e.receipt_url} compact />}
                            </div>
                            {e.vendor && (
                              <p className="text-[10px] text-amber-400/80 mt-0.5 truncate">{e.vendor}</p>
                            )}
                            {e.recurring && e.recurring_next_date && (
                              <p className="text-[10px] text-yellow-400/70 mt-0.5">
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
                            {e.recurring && <Repeat className="w-3 h-3 text-yellow-400" />}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-muted-foreground truncate">{e.description || 'Sin descripción'}</p>
                            {e.receipt_url && <ExpenseReceiptLink reference={e.receipt_url} compact />}
                          </div>
                          <p className="text-[10px] text-muted-foreground/60">
                            {formatDateAR(e.date)}
                            {e.recurring && e.recurring_next_date && (
                              <span className="ml-2 text-yellow-400/70">
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
                        tarjeta_debito: "text-primary", tarjeta_credito: "text-yellow-400",
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
        <section className="space-y-4" aria-labelledby="expense-budget-title">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-primary">Plan mensual</p>
              <h2 id="expense-budget-title" className="mt-1 text-xl font-semibold">Presupuesto operativo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Compará el límite asignado con los gastos reales de {budgetPeriodLabel}.
              </p>
            </div>
            <Select value={filterMonth} onValueChange={selectBudgetMonth}>
              <SelectTrigger className="h-9 w-full border-border bg-card sm:w-[190px]" aria-label="Período del presupuesto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(month => (
                  <SelectItem key={month} value={month}>
                    {new Date(`${month}-01T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="py-4 sm:pr-5">
              <p className="text-xs text-muted-foreground">Asignado</p>
              <p className="mt-1 font-mono text-xl font-semibold">{formatARS(budgetSummary.assigned)}</p>
            </div>
            <div className="py-4 sm:px-5">
              <p className="text-xs text-muted-foreground">Ejecutado</p>
              <p className="mt-1 font-mono text-xl font-semibold">{formatARS(budgetSummary.spent)}</p>
            </div>
            <div className="py-4 sm:pl-5">
              <p className="text-xs text-muted-foreground">Disponible</p>
              <p className={`mt-1 font-mono text-xl font-semibold ${budgetSummary.available < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                {formatARS(budgetSummary.available)}
              </p>
            </div>
          </div>

          {!canEdit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" />
              Tu rol tiene acceso de consulta. Un responsable de Finance puede modificar los límites.
            </div>
          )}

          {budgetsLoading ? (
            <div className="overflow-hidden rounded-[8px] border border-border bg-card" aria-label="Cargando presupuestos">
              {[0, 1, 2, 3].map(row => (
                <div key={row} className="border-b border-border p-4 last:border-b-0">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="mt-3 h-2 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : budgetsError ? (
            <div className="flex flex-col items-center rounded-[8px] border border-destructive/30 bg-destructive/5 px-4 py-10 text-center">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="mt-2 text-sm font-medium">{budgetsError}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void loadBudgets()}>
                <RefreshCw className="h-3.5 w-3.5" /> Reintentar
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-border bg-card">
              {budgetRows.map(category => {
                const percentage = category.budget > 0
                  ? Math.min(100, (category.value / category.budget) * 100)
                  : 0;
                const isOverBudget = category.budget > 0 && category.value > category.budget;
                const isEditing = editBudget === category.cat;
                return (
                  <div key={category.cat} className="border-b border-border p-4 last:border-b-0 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category.color }} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{category.name}</p>
                          <p className={`mt-0.5 text-xs ${isOverBudget ? "text-destructive" : "text-muted-foreground"}`}>
                            {category.budget === 0
                              ? "Sin límite asignado"
                              : isOverBudget
                                ? `Excedido en ${formatARS(category.value - category.budget)}`
                                : `${formatARS(category.budget - category.value)} disponibles`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <p className="text-right text-xs text-muted-foreground">
                          <span className={`font-mono text-sm font-semibold ${isOverBudget ? "text-destructive" : "text-foreground"}`}>
                            {formatARS(category.value)}
                          </span>
                          <span className="mx-1">de</span>
                          <span className="font-mono">{formatARS(category.budget)}</span>
                        </p>
                        {canEdit && !isEditing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={`Editar presupuesto de ${category.name}`}
                            aria-label={`Editar presupuesto de ${category.name}`}
                            onClick={() => {
                              setEditBudget(category.cat);
                              setBudgetInput(category.budget > 0 ? String(category.budget) : "");
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="mt-3 flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={budgetInput}
                          onChange={event => setBudgetInput(event.target.value)}
                          placeholder="Monto mensual"
                          autoFocus
                          disabled={savingBudget === category.cat}
                          onKeyDown={event => {
                            if (event.key === "Enter" && budgetInput.trim() !== "") {
                              void saveBudget(category.cat, Number(budgetInput));
                            }
                            if (event.key === "Escape") {
                              setEditBudget(null);
                              setBudgetInput("");
                            }
                          }}
                          className="h-9 max-w-xs"
                        />
                        <Button
                          type="button"
                          size="icon"
                          className="h-9 w-9"
                          disabled={savingBudget === category.cat || budgetInput.trim() === ""}
                          onClick={() => void saveBudget(category.cat, Number(budgetInput))}
                          aria-label="Guardar presupuesto"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          disabled={savingBudget === category.cat}
                          onClick={() => {
                            setEditBudget(null);
                            setBudgetInput("");
                          }}
                          aria-label="Cancelar edición"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${isOverBudget ? "bg-destructive" : percentage >= 80 ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
              <div className="space-y-2 pb-12">
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
        <div className="bg-card border border-border/60 rounded-[10px] shadow-card overflow-hidden">
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
          <div className="bg-card border border-border/60 rounded-[10px] p-4 shadow-card">
            <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Tendencia mensual de gastos</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip
                  formatter={(v: number) => [formatARS(v), 'Total']}
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: 'hsl(var(--border))' }}
                />
                <Bar dataKey="total" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={48}
                  label={{ position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : '' }}
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
              <div className="bg-card border border-border/60 rounded-[10px] p-4 shadow-card">
                <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Distribución por categoría</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatARS(v), getExpenseCategoryLabel(name, settings)]}
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend formatter={name => getExpenseCategoryLabel(name, settings)} wrapperStyle={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }} />
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
            <div className="bg-card border border-border/60 rounded-[10px] p-4 shadow-card">
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
                            <div className={`text-[10px] font-medium ${m.delta > 0 ? 'text-destructive' : 'text-emerald-400'}`}>
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
  const [receiptReference, setReceiptReference] = useState<string>(editItem?.receipt_url || '');
  const [pendingReceipt, setPendingReceipt] = useState<Blob | null>(null);
  const [pendingReceiptName, setPendingReceiptName] = useState('');
  const { activeOrg } = useOrg();
  const [locations, setLocations] = useState<Array<{ id: string; name: string; is_main: boolean }>>([]);
  const [locationId, setLocationId] = useState<string>(editItem?.location_id || '');
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const receiptCamRef = useRef<HTMLInputElement>(null);
  const [suggestedCategory, setSuggestedCategory] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Load org locations for the optional location dropdown
  useEffect(() => {
    if (!activeOrg?.id) { setLocations([]); return; }
    supabase
      .from("locations")
      .select("id,name,is_main,active")
      .eq("org_id", activeOrg.id)
      .eq("active", true)
      .order("is_main", { ascending: false })
      .order("name")
      .then(({ data }) => {
        const locs = (data || []) as Array<{ id: string; name: string; is_main: boolean }>;
        setLocations(locs);
        if (!editItem && locs.length > 0) {
          setLocationId((prev) => prev || (locs.find((l) => l.is_main)?.id ?? locs[0].id));
        }
      });
  }, [activeOrg?.id, editItem]);

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

  const handleReceiptFile = (file: File) => {
    if (!file) return;
    const validationError = validateExpenseReceipt(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setPendingReceipt(file);
    setPendingReceiptName(file.name || 'comprobante');
    toast.success('Comprobante listo para guardar');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Monto inválido");
      return;
    }
    setSubmitting(true);
    let uploadedReceipt = '';
    try {
      if (!activeOrg?.id) throw new Error("No hay una organización activa");
      if (pendingReceipt) {
        uploadedReceipt = await uploadExpenseReceipt({
          orgId: activeOrg.id,
          userId,
          file: pendingReceipt,
        });
      }
      const nextReceiptReference = uploadedReceipt || receiptReference;

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
        // El nombre histórico de la columna queda por compatibilidad. Los
        // comprobantes privados persisten el path, nunca una URL firmada.
        receipt_url: nextReceiptReference || null,
        location_id: locationId || null,
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

      const previousReceipt = String(editItem?.receipt_url || '');
      if (previousReceipt && previousReceipt !== nextReceiptReference) {
        void removeExpenseReceipt(previousReceipt).catch((cleanupError) => {
          console.error("El gasto se guardó pero no se pudo retirar el comprobante anterior", cleanupError);
        });
      }
      onSave();
    } catch (err: any) {
      if (uploadedReceipt) {
        try {
          await removeExpenseReceipt(uploadedReceipt);
        } catch (cleanupError) {
          console.error("No se pudo limpiar el comprobante tras fallar el gasto", cleanupError);
        }
      }
      toast.error(err.message || "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      {/* ── AI Receipt Scanner ── */}
      {!editItem && !scannerOpen && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-primary/40 text-xs text-primary/80 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <Camera className="w-3.5 h-3.5" />
            Escanear ticket con IA
          </button>
        </div>
      )}

      {/* El formulario ya vive en un Dialog: el escáner se expande dentro del
          mismo contexto y no crea un segundo focus trap anidado. */}
      {!editItem && scannerOpen && (
        <section
          aria-label="Escanear comprobante"
          className="rounded-xl border border-primary/25 bg-primary/[0.03] p-3 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-sm font-semibold flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />Escanear comprobante
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Cerrar escáner"
              onClick={() => setScannerOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ReceiptScanner
            orgId={activeOrg?.id}
            categorias={categories.map((item) => item.value)}
            onExtracted={data => {
              if (data.amount != null) setAmount(String(data.amount));
              if (data.vendor) setVendor(data.vendor);
              if (data.date) setDate(data.date);
              if (data.category) setCategory(data.category);
              if (data.description) setDescription(data.description);
              if (data.receiptFile) {
                setPendingReceipt(data.receiptFile);
                setPendingReceiptName('ticket-escaneado.jpg');
              }
            }}
            onClose={() => setScannerOpen(false)}
          />
        </section>
      )}

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

      {locations.length > 0 && (
        <div>
          <label className="text-sm text-muted-foreground">Sucursal <span className="text-[10px] opacity-60">(opcional)</span></label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger>
            <SelectContent>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}{l.is_main ? ' (principal)' : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5"><Repeat className="w-4 h-4 text-yellow-400" />Gasto recurrente</p>
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
      <div className="space-y-2 pb-12">
        <label className="text-sm text-muted-foreground flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" />Recibo / Comprobante</label>
        {(receiptReference || pendingReceipt) ? (
          <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg p-2">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium truncate">
                {pendingReceiptName || 'Comprobante guardado'}
              </p>
              {pendingReceipt ? (
                <p className="text-[10px] text-muted-foreground">Se subirá al guardar el gasto</p>
              ) : (
                <ExpenseReceiptLink reference={receiptReference} />
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setReceiptReference('');
                setPendingReceipt(null);
                setPendingReceiptName('');
              }}
              aria-label="Quitar comprobante"
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => receiptInputRef.current?.click()} disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50">
              <Paperclip className="w-3.5 h-3.5" />Adjuntar archivo
            </button>
            <button type="button" onClick={() => receiptCamRef.current?.click()} disabled={submitting}
              className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors sm:hidden disabled:opacity-50">
              <Camera className="w-3.5 h-3.5" />Foto
            </button>
          </div>
        )}
        <input ref={receiptInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); e.target.value = ''; }} className="hidden" />
        <input ref={receiptCamRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); e.target.value = ''; }} className="hidden" />
      </div>

      <Button type="submit" disabled={submitting} className="w-full text-primary-foreground font-semibold">
        {submitting ? 'Guardando...' : editItem ? 'Actualizar' : 'Registrar Gasto'}
      </Button>
    </form>
  );
}
