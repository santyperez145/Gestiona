import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Plus, DollarSign, BarChart3,
  Wallet, ArrowUpCircle, ArrowDownCircle, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

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
  investments: "Inversiones", other_in: "Otros ingresos",
};

const OUTFLOW_CATEGORIES: Record<string, string> = {
  purchases: "Compras", payroll: "Sueldos", rent: "Alquiler",
  taxes: "Impuestos", utilities: "Servicios", loan_payment: "Pago préstamo",
  dividends: "Dividendos", other_out: "Otros egresos",
};

const EMPTY_ENTRY = {
  entry_type: "inflow" as string,
  category: "sales" as string,
  description: "",
  amount: 0,
  date: new Date().toISOString().split("T")[0],
  is_recurring: false,
  recurrence_type: "",
  recurrence_end: "",
  is_projected: false,
  bank_account: "",
  notes: "",
};

export default function CashFlowPage() {
  usePageTitle("Cash Flow");
  const { orgId } = useOrganization();

  const [entries, setEntries] = useState<CashflowEntry[]>([]);
  const [summary, setSummary] = useState<CashflowSummary[]>([]);
  const [loading, setLoading] = useState(true);

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
      supabase
        .from("cashflow_entries")
        .select("*")
        .eq("org_id", orgId)
        .order("date", { ascending: false }),
      supabase.rpc("get_cashflow_summary", {
        p_org_id: orgId,
        p_from: fromDate,
        p_to: toDate,
      }),
    ]);
    if (eRes.status === "fulfilled" && eRes.value.data)
      setEntries(eRes.value.data as CashflowEntry[]);
    if (sRes.status === "fulfilled" && sRes.value.data)
      setSummary(sRes.value.data as CashflowSummary[]);
    setLoading(false);
  }, [orgId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  async function saveEntry() {
    if (!orgId || !entryForm.description.trim())
      return toast.error("Ingresá la descripción");
    if (Number(entryForm.amount) <= 0)
      return toast.error("Ingresá el monto");
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

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0 })}`;
  const fmtFull = (n: number) =>
    `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  // KPI calculations (all entries, respecting date range only via summary for running_total)
  const periodInflow = entries
    .filter(e => e.entry_type === "inflow" && !e.is_projected &&
      e.date >= fromDate && e.date <= toDate)
    .reduce((s, e) => s + Number(e.amount), 0);
  const periodOutflow = entries
    .filter(e => e.entry_type === "outflow" && !e.is_projected &&
      e.date >= fromDate && e.date <= toDate)
    .reduce((s, e) => s + Number(e.amount), 0);
  const netBalance = periodInflow - periodOutflow;
  const lastRunning = summary.length > 0
    ? summary[summary.length - 1].running_total
    : 0;

  // Filtered entries for "Movimientos" tab
  const filteredEntries = entries.filter(e => {
    if (typeFilter !== "all" && e.entry_type !== typeFilter) return false;
    if (projFilter === "actual" && e.is_projected) return false;
    if (projFilter === "projected" && !e.is_projected) return false;
    return true;
  });

  // Category breakdown for "Análisis" tab
  const inflowByCategory = Object.keys(INFLOW_CATEGORIES).map(cat => ({
    key: cat,
    label: INFLOW_CATEGORIES[cat],
    total: entries
      .filter(e => e.entry_type === "inflow" && e.category === cat)
      .reduce((s, e) => s + Number(e.amount), 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const outflowByCategory = Object.keys(OUTFLOW_CATEGORIES).map(cat => ({
    key: cat,
    label: OUTFLOW_CATEGORIES[cat],
    total: entries
      .filter(e => e.entry_type === "outflow" && e.category === cat)
      .reduce((s, e) => s + Number(e.amount), 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const maxCatValue = Math.max(
    ...inflowByCategory.map(c => c.total),
    ...outflowByCategory.map(c => c.total),
    1,
  );

  // Summary chart helpers
  const maxAbs = summary.length > 0
    ? Math.max(...summary.map(s => Math.max(Number(s.inflow), Number(s.outflow)))) || 1
    : 1;

  // "Agregar movimiento" dialog — reusable trigger
  const AddMovimientoDialog = (
    <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
      <DialogTrigger asChild>
        <Button onClick={() => setEntryForm({ ...EMPTY_ENTRY })}>
          <Plus className="w-4 h-4 mr-2" /> Nuevo movimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento de caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pb-12">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 pb-12">
              <Label>Tipo</Label>
              <Select
                value={entryForm.entry_type}
                onValueChange={v =>
                  setEntryForm(f => ({
                    ...f,
                    entry_type: v,
                    category: v === "inflow" ? "sales" : "purchases",
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inflow">💚 Ingreso</SelectItem>
                  <SelectItem value="outflow">🔴 Egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 pb-12">
              <Label>Categoría</Label>
              <Select
                value={entryForm.category}
                onValueChange={v => setEntryForm(f => ({ ...f, category: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(
                    entryForm.entry_type === "inflow"
                      ? INFLOW_CATEGORIES
                      : OUTFLOW_CATEGORIES
                  ).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1 pb-12">
            <Label>Descripción *</Label>
            <Input
              value={entryForm.description}
              onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Cobro cliente X, pago alquiler..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 pb-12">
              <Label>Monto *</Label>
              <Input
                type="number"
                min={0}
                value={entryForm.amount}
                onChange={e => setEntryForm(f => ({ ...f, amount: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1 pb-12">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={entryForm.date}
                onChange={e => setEntryForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={entryForm.is_projected}
                onCheckedChange={v => setEntryForm(f => ({ ...f, is_projected: v }))}
              />
              Es una proyección
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={entryForm.is_recurring}
                onCheckedChange={v => setEntryForm(f => ({ ...f, is_recurring: v }))}
              />
              Recurrente
            </label>
          </div>
          {entryForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 pb-12">
                <Label>Frecuencia</Label>
                <Select
                  value={entryForm.recurrence_type}
                  onValueChange={v => setEntryForm(f => ({ ...f, recurrence_type: v }))}
                >
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
              <div className="space-y-1 pb-12">
                <Label>Fin de recurrencia</Label>
                <Input
                  type="date"
                  value={entryForm.recurrence_end}
                  onChange={e => setEntryForm(f => ({ ...f, recurrence_end: e.target.value }))}
                />
              </div>
            </div>
          )}
          <div className="space-y-1 pb-12">
            <Label>Cuenta bancaria</Label>
            <Input
              value={entryForm.bank_account}
              onChange={e => setEntryForm(f => ({ ...f, bank_account: e.target.value }))}
              placeholder="Banco Nación, Mercado Pago..."
            />
          </div>
          <div className="space-y-1 pb-12">
            <Label>Notas</Label>
            <Textarea
              value={entryForm.notes}
              onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
          <Button className="w-full" onClick={saveEntry} disabled={savingEntry}>
            {savingEntry ? "Guardando..." : "Registrar movimiento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Cargando flujo de caja...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ──────────────────────────────────────────── */}
      <PageHeader
        icon={BarChart3}
        title="Cash Flow"
        description="Flujo de caja real y proyectado"
        actions={AddMovimientoDialog}
      />

      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Ingresos del período"
          value={fmt(periodInflow)}
          sub={`${fromDate} — ${toDate}`}
          icon={ArrowUpCircle}
          color="success"
        />
        <KPICard
          label="Egresos del período"
          value={fmt(periodOutflow)}
          sub={`${fromDate} — ${toDate}`}
          icon={ArrowDownCircle}
          color="destructive"
        />
        <KPICard
          label="Balance Neto"
          value={fmt(netBalance)}
          sub={netBalance >= 0 ? "Superávit en el período" : "Déficit en el período"}
          icon={DollarSign}
          color={netBalance >= 0 ? "success" : "destructive"}
        />
        <KPICard
          label="Balance Acumulado"
          value={fmt(lastRunning)}
          sub="Saldo corriente acumulado"
          icon={Wallet}
          color="blue"
        />
      </div>

      {/* ── Date range selector (shared across tabs) ─────────────── */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Período:</span>
        <Input
          type="date"
          className="h-7 w-36 text-xs"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
        />
        <span className="text-muted-foreground text-xs">a</span>
        <Input
          type="date"
          className="h-7 w-36 text-xs"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
        />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load}>
          Actualizar
        </Button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <Tabs defaultValue="movimientos">
        <TabsList>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="proyeccion">Proyección</TabsTrigger>
          <TabsTrigger value="analisis">Análisis</TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════ TAB 1: Movimientos ════ */}
        <TabsContent value="movimientos" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="flex gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="inflow">Ingresos</SelectItem>
                <SelectItem value="outflow">Egresos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={projFilter} onValueChange={setProjFilter}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue placeholder="Real / proyectado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="actual">Reales</SelectItem>
                <SelectItem value="projected">Proyectados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table or empty state */}
          {filteredEntries.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground font-medium mb-4">
                Sin movimientos registrados
              </p>
              <Button
                variant="outline"
                onClick={() => { setEntryForm({ ...EMPTY_ENTRY }); setEntryOpen(true); }}
              >
                <Plus className="w-4 h-4 mr-2" /> Registrar primer movimiento
              </Button>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Fecha</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Tipo</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Categoría</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Descripción</th>
                      <th className="text-right py-3 px-4 text-xs text-muted-foreground font-medium">Monto</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Cuenta</th>
                      <th className="text-center py-3 px-4 text-xs text-muted-foreground font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map(e => {
                      const isIn = e.entry_type === "inflow";
                      const catLabel = isIn
                        ? INFLOW_CATEGORIES[e.category] ?? e.category
                        : OUTFLOW_CATEGORIES[e.category] ?? e.category;
                      return (
                        <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-3 px-4 text-muted-foreground text-xs">
                            {new Date(e.date + "T12:00:00").toLocaleDateString("es-AR")}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isIn ? "text-emerald-400" : "text-destructive"}`}>
                              {isIn
                                ? <TrendingUp className="w-3 h-3" />
                                : <TrendingDown className="w-3 h-3" />}
                              {isIn ? "Ingreso" : "Egreso"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-xs">{catLabel}</td>
                          <td className="py-3 px-4 font-medium">{e.description}</td>
                          <td className={`py-3 px-4 text-right font-semibold ${isIn ? "text-emerald-400" : "text-destructive"}`}>
                            {isIn ? "+" : "-"}{fmtFull(e.amount)}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-xs">
                            {e.bank_account ?? "—"}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {e.is_projected
                              ? <Badge className="text-xs bg-violet-500/15 text-violet-400 border-violet-500/20">Proyección</Badge>
                              : <Badge className="text-xs bg-muted text-muted-foreground">Real</Badge>}
                            {e.is_recurring && (
                              <Badge className="text-xs bg-blue-500/15 text-blue-400 border-blue-500/20 ml-1">
                                Recurrente
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ════════════════════════════════ TAB 2: Proyección ═════ */}
        <TabsContent value="proyeccion" className="space-y-4 mt-4">
          {summary.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground font-medium mb-4">
                Sin movimientos registrados
              </p>
              <Button
                variant="outline"
                onClick={() => { setEntryForm({ ...EMPTY_ENTRY }); setEntryOpen(true); }}
              >
                <Plus className="w-4 h-4 mr-2" /> Registrar primer movimiento
              </Button>
            </div>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Flujo diario — {fromDate} a {toDate}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Barra verde = ingresos · Barra roja = egresos · Número = saldo neto del día
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {summary.map(s => {
                    const inflowPct = Math.min((Number(s.inflow) / maxAbs) * 100, 100);
                    const outflowPct = Math.min((Number(s.outflow) / maxAbs) * 100, 100);
                    const isPos = Number(s.net) >= 0;
                    return (
                      <div key={s.flow_date} className="flex items-center gap-2 text-xs">
                        <span className="w-20 text-muted-foreground text-right flex-shrink-0">
                          {new Date(s.flow_date + "T12:00:00").toLocaleDateString("es-AR", {
                            day: "2-digit", month: "2-digit",
                          })}
                        </span>
                        <div className="flex-1 space-y-0.5">
                          {Number(s.inflow) > 0 && (
                            <div
                              className="h-2 bg-emerald-500/40 rounded"
                              style={{ width: `${inflowPct}%` }}
                              title={`Ingresos: ${fmtFull(Number(s.inflow))}`}
                            />
                          )}
                          {Number(s.outflow) > 0 && (
                            <div
                              className="h-2 bg-destructive/40 rounded"
                              style={{ width: `${outflowPct}%` }}
                              title={`Egresos: ${fmtFull(Number(s.outflow))}`}
                            />
                          )}
                        </div>
                        <span className={`w-24 text-right font-medium flex-shrink-0 ${isPos ? "text-emerald-400" : "text-destructive"}`}>
                          {isPos ? "+" : ""}{fmt(Number(s.net))}
                        </span>
                        <span className="w-28 text-right text-muted-foreground flex-shrink-0">
                          Saldo: {fmt(Number(s.running_total))}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-emerald-500/40 rounded inline-block" /> Ingresos
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-destructive/40 rounded inline-block" /> Egresos
                  </span>
                </div>

                {/* Running total area visualization */}
                {summary.length > 1 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Saldo acumulado
                    </p>
                    <div className="relative h-24 flex items-end gap-px overflow-hidden rounded-lg bg-muted/20 px-2 pb-2 pt-4">
                      {(() => {
                        const vals = summary.map(s => Number(s.running_total));
                        const min = Math.min(...vals);
                        const max = Math.max(...vals);
                        const range = max - min || 1;
                        return summary.map(s => {
                          const pct = ((Number(s.running_total) - min) / range) * 100;
                          const isProj = entries.some(
                            e => e.is_projected && e.date === s.flow_date
                          );
                          return (
                            <div
                              key={s.flow_date}
                              className="flex-1 min-w-[2px] rounded-t transition-all"
                              style={{
                                height: `${Math.max(pct, 2)}%`,
                                backgroundColor: isProj
                                  ? "hsl(var(--violet-500) / 0.5)"
                                  : Number(s.running_total) >= 0
                                    ? "hsl(var(--success) / 0.6)"
                                    : "hsl(var(--destructive) / 0.6)",
                              }}
                              title={`${s.flow_date}: ${fmt(Number(s.running_total))}${isProj ? " (proyectado)" : ""}`}
                            />
                          );
                        });
                      })()}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-2">
                      <span>{summary[0]?.flow_date}</span>
                      <span>{summary[summary.length - 1]?.flow_date}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Projected entries highlight */}
          {entries.filter(e => e.is_projected).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/20 text-xs">
                    Proyectados
                  </Badge>
                  Movimientos futuros estimados
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Fecha</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Descripción</th>
                      <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Categoría</th>
                      <th className="text-right py-3 px-4 text-xs text-muted-foreground font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries
                      .filter(e => e.is_projected)
                      .slice(0, 20)
                      .map(e => {
                        const isIn = e.entry_type === "inflow";
                        const catLabel = isIn
                          ? INFLOW_CATEGORIES[e.category] ?? e.category
                          : OUTFLOW_CATEGORIES[e.category] ?? e.category;
                        return (
                          <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="py-2 px-4 text-muted-foreground text-xs">
                              {new Date(e.date + "T12:00:00").toLocaleDateString("es-AR")}
                            </td>
                            <td className="py-2 px-4">{e.description}</td>
                            <td className="py-2 px-4 text-muted-foreground text-xs">{catLabel}</td>
                            <td className={`py-2 px-4 text-right font-semibold ${isIn ? "text-emerald-400" : "text-destructive"}`}>
                              {isIn ? "+" : "-"}{fmt(e.amount)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ════════════════════════════════ TAB 3: Análisis ═══════ */}
        <TabsContent value="analisis" className="space-y-4 mt-4">
          {entries.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground font-medium mb-4">
                Sin movimientos registrados
              </p>
              <Button
                variant="outline"
                onClick={() => { setEntryForm({ ...EMPTY_ENTRY }); setEntryOpen(true); }}
              >
                <Plus className="w-4 h-4 mr-2" /> Registrar primer movimiento
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ingresos por categoría */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Ingresos por categoría
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pb-12">
                  {inflowByCategory.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Sin ingresos registrados</p>
                  ) : (
                    inflowByCategory.map(c => (
                      <div key={c.key} className="space-y-1 pb-12">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{c.label}</span>
                          <span className="font-semibold text-emerald-400">{fmt(c.total)}</span>
                        </div>
                        <div className="h-2 bg-muted/40 rounded overflow-hidden">
                          <div
                            className="h-full bg-emerald-500/60 rounded transition-all"
                            style={{ width: `${(c.total / maxCatValue) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Egresos por categoría */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-destructive" />
                    Egresos por categoría
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pb-12">
                  {outflowByCategory.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Sin egresos registrados</p>
                  ) : (
                    outflowByCategory.map(c => (
                      <div key={c.key} className="space-y-1 pb-12">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{c.label}</span>
                          <span className="font-semibold text-destructive">{fmt(c.total)}</span>
                        </div>
                        <div className="h-2 bg-muted/40 rounded overflow-hidden">
                          <div
                            className="h-full bg-destructive/60 rounded transition-all"
                            style={{ width: `${(c.total / maxCatValue) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Top expense categories table */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Top categorías de egreso</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  {outflowByCategory.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-6 text-center">Sin egresos registrados</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 border-b">
                        <tr>
                          <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">#</th>
                          <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium">Categoría</th>
                          <th className="text-right py-3 px-4 text-xs text-muted-foreground font-medium">Total</th>
                          <th className="text-right py-3 px-4 text-xs text-muted-foreground font-medium">% del total</th>
                          <th className="text-left py-3 px-4 text-xs text-muted-foreground font-medium w-40">Participación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outflowByCategory.map((c, i) => {
                          const totalOutflow2 = outflowByCategory.reduce((s, x) => s + x.total, 0);
                          const pct = totalOutflow2 > 0 ? (c.total / totalOutflow2) * 100 : 0;
                          return (
                            <tr key={c.key} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{i + 1}</td>
                              <td className="py-3 px-4 font-medium">{c.label}</td>
                              <td className="py-3 px-4 text-right text-destructive font-semibold">{fmt(c.total)}</td>
                              <td className="py-3 px-4 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</td>
                              <td className="py-3 px-4">
                                <div className="h-2 bg-muted/40 rounded overflow-hidden w-32">
                                  <div
                                    className="h-full bg-destructive/50 rounded"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
