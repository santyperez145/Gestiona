import { useState, useEffect, useMemo } from "react";
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
import { Plus, Edit, Trash2, Wallet, TrendingDown, Repeat, Filter, Search, Pencil, Check, X, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePermissions } from "@/lib/usePermissions";

function exportExpensesCSV(expenses: any[], getCategoryLabel: (c: string) => string) {
  const header = ['Fecha', 'Descripción', 'Categoría', 'Monto (ARS)', 'Recurrente'];
  const rows = expenses.map(e => [
    e.date,
    `"${(e.description || '').replace(/"/g, '""')}"`,
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
  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
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

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      if (filterCat !== 'all' && e.category !== filterCat) return false;
      if (search && !e.description?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMonth !== 'all') {
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== filterMonth) return false;
      }
      return true;
    });
  }, [expenses, filterCat, filterMonth, search]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, e) => s + Number(e.amount_ars), 0);
    const byCat: Record<string, number> = {};
    filtered.forEach(e => {
      byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount_ars);
    });
    const chartData = Object.entries(byCat).map(([cat, value]) => ({
      cat,
      name: getExpenseCategoryLabel(cat, settings),
      value,
      color: categories.find(c => c.value === cat)?.color || 'hsl(220,10%,55%)',
    }));
    return { total, chartData, recurring: filtered.filter(e => e.recurring).length };
  }, [filtered, settings, categories]);

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

  const handleDelete = async (id: string) => {
    await deleteExpenseDB(id);
    if (user) await logAudit(user.id, 'delete', 'expense', id, {});
    toast.success("Gasto eliminado");
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
                <DialogContent className="bg-card border-border max-w-md p-0">
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

      {/* Filters row */}
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Chart */}
        <div className="bg-card border border-border rounded-lg p-4 shadow-card">
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
        <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-card overflow-hidden">
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
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categoría</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descripción</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monto</th>
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
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                              {getExpenseCategoryLabel(e.category, settings)}
                              {e.recurring && <Repeat className="w-2.5 h-2.5" />}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                            <p className="truncate">{e.description || '—'}</p>
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
                    <div key={e.id} className="bg-muted/30 border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                              {getExpenseCategoryLabel(e.category, settings)}
                            </span>
                            {e.recurring && <Repeat className="w-3 h-3 text-warning" />}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{e.description || 'Sin descripción'}</p>
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
            </>
          )}
        </div>
      </div>

      {/* Monthly trend chart */}
      {monthlyTrend.length > 1 && (
        <div className="bg-card border border-border rounded-xl shadow-card p-4 mb-6">
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
      )}
    </div>
  );
}

function ExpenseForm({ userId, editItem, categories, onSave }: { userId: string; editItem?: any; categories: { value: string; label: string; color: string }[]; onSave: () => void }) {
  const [amount, setAmount] = useState(editItem ? String(editItem.amount_ars) : '');
  const [category, setCategory] = useState(editItem?.category || categories[0]?.value || 'otros');
  const [description, setDescription] = useState(editItem?.description || '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(editItem?.recurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState<string>(editItem?.recurring_frequency || 'monthly');
  const [submitting, setSubmitting] = useState(false);

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
        date: dateToNoon(date),
        recurring,
        recurring_frequency: recurring ? recurringFrequency : null,
        recurring_next_date: nextDate ? nextDate.toISOString().slice(0, 10) : null,
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
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-sm text-muted-foreground">Descripción</label>
        <Input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Ej: Alquiler local — abril" className="bg-muted border-border" />
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

      <Button type="submit" disabled={submitting} className="w-full gradient-gold text-primary-foreground font-semibold">
        {submitting ? 'Guardando...' : editItem ? 'Actualizar' : 'Registrar Gasto'}
      </Button>
    </form>
  );
}
