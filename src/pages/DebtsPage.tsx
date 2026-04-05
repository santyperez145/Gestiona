import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getDebtsDB, updateDebtDB, deleteDebtDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";

export default function DebtsPage() {
  const { user } = useAuth();
  const [debts, setDebts] = useState<any[]>([]);
  const [payingDebt, setPayingDebt] = useState<any>(null);
  const reload = async () => { if (user) setDebts(await getDebtsDB(user.id)); };
  useEffect(() => { reload(); }, [user]);

  const pending = debts.filter(d => d.status !== 'paid');
  const paid = debts.filter(d => d.status === 'paid');
  const totalPending = pending.reduce((s, d) => s + Number(d.remaining_ars), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Deudas</h1>
          <p className="text-muted-foreground">Control de deudas de clientes</p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-2">
          <span className="text-sm text-muted-foreground">Total pendiente: </span>
          <span className="font-bold text-destructive">{formatARS(totalPending)}</span>
        </div>
      </div>

      <Dialog open={!!payingDebt} onOpenChange={v => { if (!v) setPayingDebt(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="font-display">Registrar Pago</DialogTitle></DialogHeader>
          {payingDebt && <PaymentForm debt={payingDebt} onSave={() => { setPayingDebt(null); reload(); }} />}
        </DialogContent>
      </Dialog>

      <h2 className="text-lg font-display font-semibold mb-3">Pendientes ({pending.length})</h2>
      {!pending.length ? (
        <div className="text-center py-10 text-muted-foreground mb-8 bg-card border border-border rounded-lg"><p>🎉 No hay deudas pendientes</p></div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto mb-8">
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
                  <td className="p-3">{new Date(d.date).toLocaleDateString('es-AR')}</td>
                  <td className="p-3 font-medium">{d.customer_name}</td>
                  <td className="p-3 text-muted-foreground">{d.description}</td>
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
                    <Button variant="ghost" size="sm" onClick={async () => { await deleteDebtDB(d.id); reload(); toast.success("Eliminada"); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paid.length > 0 && (
        <>
          <h2 className="text-lg font-display font-semibold mb-3 text-muted-foreground">Pagadas ({paid.length})</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden opacity-60">
            <table className="w-full text-sm">
              <tbody>
                {paid.slice(0, 10).map(d => (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="p-3">{new Date(d.date).toLocaleDateString('es-AR')}</td>
                    <td className="p-3">{d.customer_name}</td>
                    <td className="p-3">{d.description}</td>
                    <td className="p-3 text-right">{formatARS(Number(d.amount_ars))}</td>
                    <td className="p-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs bg-success/20 text-success">Pagada</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentForm({ debt, onSave }: { debt: any; onSave: () => void }) {
  const [amount, setAmount] = useState('');
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payment = parseFloat(amount) || 0;
    if (payment <= 0) { toast.error("Ingresá un monto válido"); return; }
    const remaining = Number(debt.remaining_ars);
    if (payment > remaining) { toast.error("El pago excede la deuda"); return; }
    const newPaid = Number(debt.paid_ars) + payment;
    const newRemaining = Number(debt.amount_ars) - newPaid;
    await updateDebtDB(debt.id, { paid_ars: newPaid, remaining_ars: Math.max(0, newRemaining), status: newRemaining <= 0 ? 'paid' : 'partial' });
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
        <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Máx: ${debt.remaining_ars}`} className="bg-muted border-border" /></div>
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Registrar Pago</Button>
    </form>
  );
}
