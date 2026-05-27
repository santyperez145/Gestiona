import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Plus, DollarSign, BarChart3, Calendar } from "lucide-react";

interface CashflowEntry {
  id: string;
  entry_type: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  is_recurring: boolean;
  recurrence_type: string | null;
  is_projected: boolean;
  bank_account: string | null;
  notes: string | null;
  created_at: string;
}

interface CashflowSummary {
  flow_date: string;
  inflow: number;
  outflow: number;
  net: number;
  running_total: number;
}

const INFLOW_CATEGORIES: Record<string, string> = {
  sales: "Ventas", collections: "Cobros", loans: "Préstamos",
  investments: "Inversiones", other_in: "Otros ingresos"
};

const OUTFLOW_CATEGORIES: Record<string, string> = {
  purchases: "Compras", payroll: "Sueldos", rent: "Alquiler",
  taxes: "Impuestos", utilities: "Servicios", loan_payment: "Pago préstamo",
  dividends: "Dividendos", other_out: "Otros egresos"
};

const EMPTY_ENTRY = {
  entry_type: "inflow" as string, category: "sales" as string,
  description: "", amount: 0, date: new Date().toISOString().split("T")[0],
  is_recurring: false, recurrence_type: "", recurrence_end: "",
  is_projected: false, bank_account: "", notes: ""
};

export default function CashFlowPage() {
  const { orgId } = useOrganization();

  const [entries, setEntries]   = useState<CashflowEntry[]>([]);
  const [summary, setSummary]   = useState<CashflowSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [projFilter, setProjFilter] = useState("all");

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 3);
    return d.toISOString().split("T")[0];
  });

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ ...EMPTY_ENTRY });
  const [savingEntry, setSavingEntry] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [eRes, sRes] = await Promise.allSettled([
      supabase.from("cashflow_entries").select("*").eq("org_id", orgId).order("date", { ascending: false }),
      supabase.rpc("get_cashflow_summary", { p_org_id: orgId, p_from: fromDate, p_to: toDate }),
    ]);
    if (eRes.status === "fulfilled" && eRes.value.data) setEntries(eRes.value.data as CashflowEntry[]);
    if (sRes.status === "fulfilled" && sRes.value.data) setSummary(sRes.value.data as CashflowSummary[]);
    setLoading(false);
  }, [orgId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  async function saveEntry() {
    if (!orgId || !entryForm.description.trim()) return toast.error("Ingresá la descripción");
    if (Number(entryForm.amount) <= 0) return toast.error("Ingresá el monto");
    setSavingEntry(true);
    const { error } = await supabase.from("cashflow_entries").insert({
      org_id: orgId,
      entry_type: entryForm.entry_type,
      category: entryForm.category,
      description: entryForm.description.trim(),
      amount: Number(entryForm.amount),
      date: entryForm.date,
      is_recurring: entryForm.is_recurring,
      recurrence_type: entryForm.is_recurring ? entryForm.recurrence_type || null : null,
      recurrence_end: entryForm.recurrence_end || null,
      is_projected: entryForm.is_projected,
      bank_account: entryForm.bank_account || null,
      notes: entryForm.notes || null,
    });
    setSavingEntry(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${entryForm.entry_type === "inflow" ? "Ingreso" : "Egreso"} registrado`);
    setEntryOpen(false);
    setEntryForm({ ...EMPTY_ENTRY });
    load();
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0 })}`;
  const fmtFull = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredEntries = entries.filter(e => {
    if (typeFilter !== "all" && e.entry_type !== typeFilter) return false;
    if (projFilter === "actual" && e.is_projected) return false;
    if (projFilter === "projected" && !e.is_projected) return false;
    return true;
  });

  const totalInflow  = entries.filter(e => e.entry_type === "inflow" && !e.is_projected).reduce((s, e) => s + Number(e.amount), 0);
  const totalOutflow = entries.filter(e => e.entry_type === "outflow" && !e.is_projected).reduce((s, e) => s + Number(e.amount), 0);
  const projected    = entries.filter(e => e.is_projected).reduce((s, e) => s + (e.entry_type === "inflow" ? Number(e.amount) : -Number(e.amount)), 0);
  const lastRunning  = summary.length > 0 ? summary[summary.length - 1].running_total : 0;

  const maxAbs = summary.length > 0
    ? Math.max(...summary.map(s => Math.max(Number(s.inflow), Number(s.outflow)))) || 1
    : 1;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cash Flow</h1>
            <p className="text-sm text-gray-500">Ingresos, egresos y proyección de liquidez</p>
          </div>
        </div>
        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEntryForm({ ...EMPTY_ENTRY })}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo movimiento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nuevo movimiento de caja</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select value={entryForm.entry_type} onValueChange={v => setEntryForm(f => ({ ...f, entry_type: v, category: v === "inflow" ? "sales" : "purchases" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inflow">💚 Ingreso</SelectItem>
                      <SelectItem value="outflow">🔴 Egreso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Categoría</Label>
                  <Select value={entryForm.category} onValueChange={v => setEntryForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(entryForm.entry_type === "inflow" ? INFLOW_CATEGORIES : OUTFLOW_CATEGORIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Descripción *</Label>
                <Input value={entryForm.description} onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))} placeholder="Cobro cliente X, pago alquiler..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Monto *</Label>
                  <Input type="number" min={0} value={entryForm.amount} onChange={e => setEntryForm(f => ({ ...f, amount: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <Label>Fecha</Label>
                  <Input type="date" value={entryForm.date} onChange={e => setEntryForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch checked={entryForm.is_projected} onCheckedChange={v => setEntryForm(f => ({ ...f, is_projected: v }))} />
                  Es una proyección
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch checked={entryForm.is_recurring} onCheckedChange={v => setEntryForm(f => ({ ...f, is_recurring: v }))} />
                  Recurrente
                </label>
              </div>
              {entryForm.is_recurring && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Frecuencia</Label>
                    <Select value={entryForm.recurrence_type} onValueChange={v => setEntryForm(f => ({ ...f, recurrence_type: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Diario</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="biweekly">Quincenal</SelectItem>
                        <SelectItem value="monthly">Mensual</SelectItem>
                        <SelectItem value="quarterly">Trimestral</SelectItem>
                        <SelectItem value="annual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Fin de recurrencia</Label>
                    <Input type="date" value={entryForm.recurrence_end} onChange={e => setEntryForm(f => ({ ...f, recurrence_end: e.target.value }))} />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label>Cuenta bancaria</Label>
                <Input value={entryForm.bank_account} onChange={e => setEntryForm(f => ({ ...f, bank_account: e.target.value }))} placeholder="Banco Nación, Mercado Pago..." />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Textarea value={entryForm.notes} onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
              <Button className="w-full" onClick={saveEntry} disabled={savingEntry}>
                {savingEntry ? "Guardando..." : "Registrar movimiento"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-green-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Ingresos reales</p></div>
          <p className="text-3xl font-bold text-green-600">{fmt(totalInflow)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><TrendingDown className="w-4 h-4 text-red-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Egresos reales</p></div>
          <p className="text-3xl font-bold text-red-600">{fmt(totalOutflow)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-blue-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Saldo neto</p></div>
          <p className={`text-3xl font-bold ${totalInflow - totalOutflow >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(totalInflow - totalOutflow)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><Calendar className="w-4 h-4 text-purple-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Proyectado neto</p></div>
          <p className={`text-3xl font-bold ${projected >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(projected)}</p>
        </CardContent></Card>
      </div>

      {/* Chart: daily inflow/outflow bars */}
      {summary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Flujo de caja — {fromDate} a {toDate}</CardTitle>
              <div className="flex gap-2 items-center">
                <Input type="date" className="h-7 w-32 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                <span className="text-xs text-gray-400">a</span>
                <Input type="date" className="h-7 w-32 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load}>Actualizar</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {summary.map(s => {
                const inflowPct = Math.min((Number(s.inflow) / maxAbs) * 100, 100);
                const outflowPct = Math.min((Number(s.outflow) / maxAbs) * 100, 100);
                const isPos = Number(s.net) >= 0;
                return (
                  <div key={s.flow_date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-gray-400 text-right flex-shrink-0">
                      {new Date(s.flow_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                    </span>
                    <div className="flex-1 space-y-0.5">
                      {Number(s.inflow) > 0 && (
                        <div className="h-2 bg-green-200 rounded" style={{ width: `${inflowPct}%` }} title={`Ingresos: ${fmtFull(Number(s.inflow))}`} />
                      )}
                      {Number(s.outflow) > 0 && (
                        <div className="h-2 bg-red-200 rounded" style={{ width: `${outflowPct}%` }} title={`Egresos: ${fmtFull(Number(s.outflow))}`} />
                      )}
                    </div>
                    <span className={`w-24 text-right font-medium flex-shrink-0 ${isPos ? "text-green-700" : "text-red-700"}`}>
                      {isPos ? "+" : ""}{fmt(Number(s.net))}
                    </span>
                    <span className="w-28 text-right text-gray-500 flex-shrink-0">
                      Saldo: {fmt(Number(s.running_total))}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex gap-4 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-200 rounded inline-block" /> Ingresos</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-200 rounded inline-block" /> Egresos</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + table */}
      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="inflow">Ingresos</SelectItem>
            <SelectItem value="outflow">Egresos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={projFilter} onValueChange={setProjFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Real / proyectado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="actual">Reales</SelectItem>
            <SelectItem value="projected">Proyectados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay movimientos registrados</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Fecha</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Tipo</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Categoría</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Descripción</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Monto</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Cuenta</th>
                <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(e => {
                const isIn = e.entry_type === "inflow";
                const catLabel = isIn ? INFLOW_CATEGORIES[e.category] ?? e.category : OUTFLOW_CATEGORIES[e.category] ?? e.category;
                return (
                  <tr key={e.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-600">{new Date(e.date).toLocaleDateString("es-AR")}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${isIn ? "text-green-700" : "text-red-700"}`}>
                        {isIn ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isIn ? "Ingreso" : "Egreso"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-600 text-xs">{catLabel}</td>
                    <td className="py-2 px-3 text-gray-900">{e.description}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${isIn ? "text-green-700" : "text-red-700"}`}>
                      {isIn ? "+" : "-"}{fmtFull(e.amount)}
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{e.bank_account ?? "—"}</td>
                    <td className="py-2 px-3 text-center">
                      {e.is_projected
                        ? <Badge className="text-xs bg-purple-100 text-purple-800">Proyección</Badge>
                        : <Badge className="text-xs bg-gray-100 text-gray-700">Real</Badge>}
                      {e.is_recurring && <Badge className="text-xs bg-blue-100 text-blue-800 ml-1">Recurrente</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
