import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getDebtsDB, addDebtPaymentDB, deleteDebtDB, formatARS, formatDateAR } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, DollarSign, AlertCircle } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";

export default function DebtsPage() {
  const { user } = useAuth();
  const [debts, setDebts] = useState<any[]>([]);
  const [payingDebt, setPayingDebt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const reload = async () => { if (user) { setDebts(await getDebtsDB(user.id)); setLoading(false); } };
  useEffect(() => { reload(); }, [user]);

  const dateFiltered = debts.filter(d => {
    if (!dateFrom) return true;
    const dt = new Date(d.date);
    if (dt < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (dt > end) return false; }
    return true;
  });
  const pending = dateFiltered.filter(d => d.status !== 'paid');
  const paid = dateFiltered.filter(d => d.status === 'paid');
  const totalPending = pending.reduce((s, d) => s + Number(d.remaining_ars), 0);

  const handleDelete = async (d: any) => {
    await deleteDebtDB(d.id);
    if (user) await logAudit(user.id, 'delete', 'debt', d.id, { customer: d.customer_name, amount: d.amount_ars });
    reload();
    toast.success("Deuda eliminada");
  };

  if (loading) return <TableSkeleton rows={5} cols={7} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Deudas</h1>
          <p className="text-muted-foreground text-sm">Control de deudas de clientes</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
          <div className="bg-card border border-border rounded-lg px-4 py-2">
            <span className="text-sm text-muted-foreground">Pendiente: </span>
            <span className="font-bold text-destructive">{formatARS(totalPending)}</span>
          </div>
        </div>
      </div>

      <Dialog open={!!payingDebt} onOpenChange={v => { if (!v) setPayingDebt(null); }}>
        <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Registrar Pago</DialogTitle></DialogHeader>
          {payingDebt && <PaymentForm debt={payingDebt} userId={user!.id} onSave={() => { setPayingDebt(null); reload(); }} />}
        </DialogContent>
      </Dialog>

      <h2 className="text-lg font-display font-semibold mb-3">Pendientes ({pending.length})</h2>
      {!pending.length ? (
        <EmptyState icon={AlertCircle} title="🎉 No hay deudas pendientes" description="Todas las deudas están saldadas." />
      ) : (
        <>
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Cliente</th>
                  <th className="text-left p-3 font-medium">Descripción</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-right p-3 font-medium">Pagado</th>
                  <th className="text-right p-3 font-medium">Resta</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-center p-3 font-medium">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(d => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="p-3">{formatDateAR(d.date)}</td>
                    <td className="p-3 font-medium">{d.customer_name}</td>
                    <td className="p-3 text-muted-foreground max-w-[200px] truncate">{d.description}</td>
                    <td className="p-3 text-right">{formatARS(Number(d.amount_ars))}</td>
                    <td className="p-3 text-right text-success">{formatARS(Number(d.paid_ars))}</td>
                    <td className="p-3 text-right font-bold text-destructive">{formatARS(Number(d.remaining_ars))}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.status === 'partial' ? 'bg-warning/20 text-warning' : 'bg-destructive/20 text-destructive'}`}>
                        {d.status === 'partial' ? 'Parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="p-3 text-center space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => setPayingDebt(d)}><DollarSign className="w-3.5 h-3.5 text-success" /></Button>
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                        title="¿Eliminar deuda?"
                        description={`Se eliminará la deuda de ${d.customer_name} por ${formatARS(Number(d.amount_ars))}.`}
                        confirmText="Eliminar"
                        onConfirm={() => handleDelete(d)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3 mb-8">
            {pending.map(d => (
              <div key={d.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{d.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(d.date)} · {d.description}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${d.status === 'partial' ? 'bg-warning/20 text-warning' : 'bg-destructive/20 text-destructive'}`}>
                    {d.status === 'partial' ? 'Parcial' : 'Pendiente'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div><span className="text-muted-foreground block">Total</span><span>{formatARS(Number(d.amount_ars))}</span></div>
                  <div><span className="text-muted-foreground block">Pagado</span><span className="text-success">{formatARS(Number(d.paid_ars))}</span></div>
                  <div><span className="text-muted-foreground block">Resta</span><span className="text-destructive font-bold">{formatARS(Number(d.remaining_ars))}</span></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setPayingDebt(d)}>
                    <DollarSign className="w-3 h-3 mr-1" />Pagar
                  </Button>
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="ghost"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                    title="¿Eliminar deuda?"
                    confirmText="Eliminar"
                    onConfirm={() => handleDelete(d)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {paid.length > 0 && (
        <>
          <h2 className="text-lg font-display font-semibold mb-3 text-muted-foreground">Pagadas ({paid.length})</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden opacity-60">
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <tbody>
                  {paid.slice(0, 10).map(d => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="p-3">{formatDateAR(d.date)}</td>
                      <td className="p-3">{d.customer_name}</td>
                      <td className="p-3">{d.description}</td>
                      <td className="p-3 text-right">{formatARS(Number(d.amount_ars))}</td>
                      <td className="p-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs bg-success/20 text-success">Pagada</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-border">
              {paid.slice(0, 10).map(d => (
                <div key={d.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{d.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(d.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{formatARS(Number(d.amount_ars))}</p>
                    <span className="text-xs text-success">Pagada ✓</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentForm({ debt, userId, onSave }: { debt: any; userId: string; onSave: () => void }) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payment = parseFloat(amount) || 0;
    if (payment <= 0) { toast.error("Ingresá un monto válido"); return; }
    const remaining = Number(debt.remaining_ars);
    if (payment > remaining) { toast.error("El pago excede la deuda"); return; }
    const result = await addDebtPaymentDB(debt.id, payment, { paymentMethod, userId });
    await logAudit(userId, 'update', 'debt', debt.id, {
      customer: debt.customer_name,
      payment,
      paymentMethod,
      newStatus: result.newStatus,
    });
    const newRemaining = result.newRemaining;
    toast.success(result.newRemaining <= 0 ? "Â¡Deuda saldada!" : "Pago parcial registrado");
    toast.success(newRemaining <= 0 ? "¡Deuda saldada!" : "Pago parcial registrado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Cliente:</span><span className="font-medium">{debt.customer_name}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Deuda total:</span><span>{formatARS(Number(debt.amount_ars))}</span></div>
        <div className="flex justify-between font-bold border-t border-border pt-1"><span>Resta:</span><span className="text-destructive">{formatARS(Number(debt.remaining_ars))}</span></div>
      </div>
      <div><label className="text-sm text-muted-foreground">Monto del pago (ARS)</label>
        <Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Máx: ${debt.remaining_ars}`} className="bg-muted border-border" /></div>
      <div>
        <label className="text-sm text-muted-foreground">Medio de cobro</label>
        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="efectivo">Efectivo</SelectItem>
            <SelectItem value="transferencia">Transferencia</SelectItem>
            <SelectItem value="debito">Debito</SelectItem>
            <SelectItem value="credito">Credito</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold">Registrar Pago</Button>
        <Button type="button" variant="outline" onClick={() => { setAmount(String(debt.remaining_ars)); }}>Todo</Button>
      </div>
    </form>
  );
}
