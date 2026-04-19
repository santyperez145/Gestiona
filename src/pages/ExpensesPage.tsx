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
import { Plus, Edit, Trash2, Wallet, TrendingDown, Repeat, Filter } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export default function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const categories = useMemo(() => buildExpenseCategories(settings), [settings]);

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
      if (filterMonth !== 'all') {
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== filterMonth) return false;
      }
      return true;
    });
  }, [expenses, filterCat, filterMonth]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, e) => s + Number(e.amount_ars), 0);
    const byCat: Record<string, number> = {};
    filtered.forEach(e => {
      byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount_ars);
    });
    const chartData = Object.entries(byCat).map(([cat, value]) => ({
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

  const handleDelete = async (id: string) => {
    await deleteExpenseDB(id);
    if (user) await logAudit(user.id, 'delete', 'expense', id, {});
    toast.success("Gasto eliminado");
    reload();
  };

  if (loading) return <TableSkeleton rows={6} cols={5} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Wallet className="w-7 h-7 text-primary" /> Gastos Operativos
          </h1>
          <p className="text-muted-foreground text-sm">{filtered.length} gastos · Total: {formatARS(totals.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="bg-card border-border w-[140px] h-9 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los meses</SelectItem>
              {monthOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="bg-card border-border w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorías</SelectItem>
              {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
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
                <ExpenseForm
                  userId={user!.id}
                  editItem={editItem}
                  categories={categories}
                  onSave={() => { setOpen(false); setEditItem(null); reload(); }}
                />
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={TrendingDown} label="Total mes" value={formatARS(totals.total)} color="text-destructive" />
        <KpiCard icon={Wallet} label="Gastos" value={String(filtered.length)} color="text-primary" />
        <KpiCard icon={Repeat} label="Recurrentes" value={String(totals.recurring)} color="text-warning" />
        <KpiCard icon={Filter} label="Categorías" value={String(totals.chartData.length)} color="text-accent" />
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
          <div className="space-y-1 mt-2">
            {totals.chartData.map(c => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                  <span>{c.name}</span>
                </div>
                <span className="font-medium">{formatARS(c.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <h2 className="text-sm font-display font-semibold p-4 pb-3 text-muted-foreground uppercase tracking-wider">Listado</h2>
          {filtered.length === 0 ? (
            <EmptyState icon={Wallet} title="Sin gastos en este mes" description="Registrá tus gastos operativos para llevar el control de tu rentabilidad neta." actionLabel="Nuevo Gasto" onAction={() => setOpen(true)} />
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left p-3 font-medium">Fecha</th>
                      <th className="text-left p-3 font-medium">Categoría</th>
                      <th className="text-left p-3 font-medium">Descripción</th>
                      <th className="text-right p-3 font-medium">Monto</th>
                      <th className="text-center p-3 font-medium">Acc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(e => {
                      const catCfg = categories.find(c => c.value === e.category);
                      return (
                        <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="p-3">{formatDateAR(e.date)}</td>
                          <td className="p-3">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: `${catCfg?.color}22`, color: catCfg?.color }}>
                              {getExpenseCategoryLabel(e.category, settings)}
                              {e.recurring && <Repeat className="w-2.5 h-2.5" />}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground truncate max-w-[200px]">{e.description || '—'}</td>
                          <td className="p-3 text-right font-medium text-destructive">-{formatARS(Number(e.amount_ars))}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => { setEditItem(e); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                                title="¿Eliminar gasto?"
                                description={`Se eliminará el gasto de ${formatARS(Number(e.amount_ars))}.`}
                                confirmText="Eliminar"
                                onConfirm={() => handleDelete(e.id)}
                              />
                            </div>
                          </td>
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
                          <p className="text-[10px] text-muted-foreground/60">{formatDateAR(e.date)}</p>
                        </div>
                        <span className="text-sm font-bold text-destructive shrink-0">-{formatARS(Number(e.amount_ars))}</span>
                      </div>
                      <div className="flex justify-end gap-1 mt-2">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(e); setOpen(true); }}><Edit className="w-3 h-3" /></Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                          title="¿Eliminar gasto?"
                          confirmText="Eliminar"
                          onConfirm={() => handleDelete(e.id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 md:p-4 shadow-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${color}`} />
      </div>
      <p className="text-lg md:text-xl font-bold font-display">{value}</p>
    </div>
  );
}

function ExpenseForm({ userId, editItem, categories, onSave }: { userId: string; editItem?: any; categories: { value: string; label: string; color: string }[]; onSave: () => void }) {
  const [amount, setAmount] = useState(editItem ? String(editItem.amount_ars) : '');
  const [category, setCategory] = useState(editItem?.category || categories[0]?.value || 'otros');
  const [description, setDescription] = useState(editItem?.description || '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(editItem?.recurring || false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Monto inválido");
      return;
    }
    setSubmitting(true);
    try {
      const data: any = {
        user_id: userId,
        amount_ars: parseFloat(amount),
        category,
        description: description || null,
        date: dateToNoon(date),
        recurring,
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

      <div className="flex items-center justify-between bg-muted/50 border border-border rounded-lg p-3">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Repeat className="w-4 h-4 text-warning" />Gasto recurrente</p>
          <p className="text-xs text-muted-foreground">Marcalo si se repite cada mes</p>
        </div>
        <Switch checked={recurring} onCheckedChange={setRecurring} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full gradient-gold text-primary-foreground font-semibold">
        {submitting ? 'Guardando...' : editItem ? 'Actualizar' : 'Registrar Gasto'}
      </Button>
    </form>
  );
}
