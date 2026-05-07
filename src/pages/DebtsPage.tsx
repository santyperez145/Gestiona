import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getDebtsDB, addDebtPaymentDB, deleteDebtDB, formatARS, formatDateAR } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, DollarSign, AlertCircle, Clock, CheckCircle2, TrendingDown, Users, Search } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

export default function DebtsPage() {
  const { user } = useAuth();
  const [debts, setDebts] = useState<any[]>([]);
  const [payingDebt, setPayingDebt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "paid">("pending");

  const reload = async () => {
    if (user) { setDebts(await getDebtsDB(user.id)); setLoading(false); }
  };
  useEffect(() => { reload(); }, [user]);

  const filtered = useMemo(() => {
    return debts.filter(d => {
      if (search && !d.customer_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (!dateFrom) return true;
      const dt = new Date(d.date);
      if (dt < dateFrom) return false;
      if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); if (dt > end) return false; }
      return true;
    });
  }, [debts, search, dateFrom, dateTo]);

  const pending = filtered.filter(d => d.status !== "paid");
  const paid = filtered.filter(d => d.status === "paid");
  const totalPending = pending.reduce((s, d) => s + Number(d.remaining_ars), 0);
  const totalPaid = paid.reduce((s, d) => s + Number(d.amount_ars), 0);
  const partialCount = pending.filter(d => d.status === "partial").length;
  const uniqueDebtors = new Set(pending.map(d => d.customer_name)).size;

  const handleDelete = async (d: any) => {
    await deleteDebtDB(d.id);
    if (user) await logAudit(user.id, "delete", "debt", d.id, { customer: d.customer_name, amount: d.amount_ars });
    reload();
    toast.success("Deuda eliminada");
  };

  if (loading) return <TableSkeleton rows={5} cols={7} />;

  const shown = tab === "pending" ? pending : paid;

  return (
    <div>
      <PageHeader
        icon={AlertCircle}
        title="Deudas"
        description="Control de cuentas corrientes de clientes"
        badge={pending.length > 0 ? { label: `${pending.length} pendientes`, variant: "destructive" } : { label: "Al día ✓", variant: "success" }}
        actions={
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Total pendiente" value={formatARS(totalPending)} icon={TrendingDown} color="destructive"
          sub={`${pending.length} deuda${pending.length !== 1 ? "s" : ""}`} />
        <KPICard label="Deudores" value={uniqueDebtors} icon={Users} color="warning"
          sub={`${partialCount} pago${partialCount !== 1 ? "s" : ""} parcial${partialCount !== 1 ? "es" : ""}`} />
        <KPICard label="Cobrado" value={formatARS(totalPaid)} icon={CheckCircle2} color="success"
          sub={`${paid.length} deuda${paid.length !== 1 ? "s" : ""} saldadas`} />
        <KPICard label="Prom. por deudor" value={uniqueDebtors > 0 ? formatARS(totalPending / uniqueDebtors) : "$0"} icon={DollarSign} color="primary"
          sub="deuda promedio" />
      </div>

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1 gap-1 shrink-0">
          {(["pending", "paid"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "pending" ? `Pendientes (${pending.length})` : `Pagadas (${paid.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Payment Dialog */}
      <Dialog open={!!payingDebt} onOpenChange={v => { if (!v) setPayingDebt(null); }}>
        <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Registrar Pago</DialogTitle></DialogHeader>
          {payingDebt && <PaymentForm debt={payingDebt} userId={user!.id} onSave={() => { setPayingDebt(null); reload(); }} />}
        </DialogContent>
      </Dialog>

      {/* Empty state */}
      {!shown.length && (
        tab === "pending"
          ? <EmptyState icon={CheckCircle2} title="¡Sin deudas pendientes!" description="Todos tus clientes están al día." />
          : <EmptyState icon={Clock} title="Sin deudas cobradas" description="Acá aparecerán las deudas que se salden." />
      )}

      {/* Desktop table */}
      {shown.length > 0 && (
        <>
          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Descripción</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                  {tab === "pending" && <>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pagado</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resta</th>
                  </>}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                  {tab === "pending" && <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acc.</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map(d => (
                  <tr key={d.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDateAR(d.date)}</td>
                    <td className="px-4 py-3 font-semibold">{d.customer_name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px] truncate hidden lg:table-cell">{d.description}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatARS(Number(d.amount_ars))}</td>
                    {tab === "pending" && <>
                      <td className="px-4 py-3 text-right text-success font-medium">{formatARS(Number(d.paid_ars))}</td>
                      <td className="px-4 py-3 text-right font-bold text-destructive text-base">{formatARS(Number(d.remaining_ars))}</td>
                    </>}
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        d.status === "paid" ? "bg-success/15 text-success" :
                        d.status === "partial" ? "bg-warning/15 text-warning" :
                        "bg-destructive/15 text-destructive"
                      }`}>
                        {d.status === "paid" ? "✓ Pagada" : d.status === "partial" ? "Parcial" : "Pendiente"}
                      </span>
                    </td>
                    {tab === "pending" && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs border-success/30 text-success hover:bg-success/10" onClick={() => setPayingDebt(d)}>
                            <DollarSign className="w-3.5 h-3.5 mr-1" />Cobrar
                          </Button>
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                            title="¿Eliminar deuda?"
                            description={`Se eliminará la deuda de ${d.customer_name} por ${formatARS(Number(d.amount_ars))}.`}
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(d)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {shown.map(d => (
              <div key={d.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold">{d.customer_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateAR(d.date)} {d.description ? `· ${d.description}` : ""}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                    d.status === "paid" ? "bg-success/15 text-success" :
                    d.status === "partial" ? "bg-warning/15 text-warning" :
                    "bg-destructive/15 text-destructive"
                  }`}>
                    {d.status === "paid" ? "✓ Pagada" : d.status === "partial" ? "Parcial" : "Pendiente"}
                  </span>
                </div>
                {tab === "pending" && (
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3 bg-muted/30 rounded-lg p-2.5">
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Total</p><p className="font-medium">{formatARS(Number(d.amount_ars))}</p></div>
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Pagado</p><p className="font-medium text-success">{formatARS(Number(d.paid_ars))}</p></div>
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Resta</p><p className="font-bold text-destructive">{formatARS(Number(d.remaining_ars))}</p></div>
                  </div>
                )}
                {tab === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-8 text-xs gradient-gold text-primary-foreground" onClick={() => setPayingDebt(d)}>
                      <DollarSign className="w-3.5 h-3.5 mr-1.5" />Registrar pago
                    </Button>
                    <ConfirmDialog
                      trigger={<Button size="sm" variant="outline" className="h-8 w-8 p-0 border-destructive/30"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                      title="¿Eliminar deuda?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(d)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaymentForm({ debt, userId, onSave }: { debt: any; userId: string; onSave: () => void }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payment = parseFloat(amount) || 0;
    if (payment <= 0) { toast.error("Ingresá un monto válido"); return; }
    if (payment > Number(debt.remaining_ars)) { toast.error("El pago excede la deuda restante"); return; }
    setSaving(true);
    const result = await addDebtPaymentDB(debt.id, payment, { paymentMethod, userId });
    await logAudit(userId, "update", "debt", debt.id, { customer: debt.customer_name, payment, paymentMethod, newStatus: result.newStatus });
    toast.success(result.newRemaining <= 0 ? "¡Deuda saldada completamente! 🎉" : `Pago parcial registrado. Resta ${formatARS(result.newRemaining)}`);
    setSaving(false);
    onSave();
  };

  const pct = debt.amount_ars > 0 ? Math.round((Number(debt.paid_ars) / Number(debt.amount_ars)) * 100) : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Summary card */}
      <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold">{debt.customer_name}</span>
          <span className="text-xs text-muted-foreground">{debt.description}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total deuda</span>
          <span>{formatARS(Number(debt.amount_ars))}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Ya pagado</span>
          <span className="text-success">{formatARS(Number(debt.paid_ars))}</span>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-1.5 mt-1">
          <div className="bg-success h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between font-bold pt-1 border-t border-border">
          <span>Resta pagar</span>
          <span className="text-destructive text-lg">{formatARS(Number(debt.remaining_ars))}</span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Monto del pago (ARS)</label>
        <Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder={`Máx: ${formatARS(Number(debt.remaining_ars))}`} className="bg-muted border-border" />
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Medio de cobro</label>
        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="efectivo">💵 Efectivo</SelectItem>
            <SelectItem value="transferencia">🏦 Transferencia</SelectItem>
            <SelectItem value="debito">💳 Débito</SelectItem>
            <SelectItem value="credito">💳 Crédito</SelectItem>
            <SelectItem value="mercadopago">📱 Mercado Pago</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving} className="flex-1 gradient-gold text-primary-foreground font-semibold">
          {saving ? "Guardando..." : "Registrar Pago"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setAmount(String(debt.remaining_ars))} className="shrink-0">
          Todo
        </Button>
      </div>
    </form>
  );
}
