import { useState, useEffect } from "react";
import { Debt } from "@/lib/types";
import { getDebts, updateDebt, deleteDebt, formatARS } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [payingDebt, setPayingDebt] = useState<Debt | null>(null);
  const reload = () => setDebts(getDebts());
  useEffect(reload, []);

  const pending = debts.filter(d => d.status !== 'paid');
  const paid = debts.filter(d => d.status === 'paid');
  const totalPending = pending.reduce((s, d) => s + d.remainingARS, 0);

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

      <Dialog open={!!payingDebt} onOpenChange={(v) => { if (!v) setPayingDebt(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="font-display">Registrar Pago</DialogTitle></DialogHeader>
          {payingDebt && <PaymentForm debt={payingDebt} onSave={() => { setPayingDebt(null); reload(); }} />}
        </DialogContent>
      </Dialog>

      {/* Pending */}
      <h2 className="text-lg font-display font-semibold mb-3">Pendientes ({pending.length})</h2>
      {!pending.length ? (
        <div className="text-center py-10 text-muted-foreground mb-8 bg-card border border-border rounded-lg">
          <p>🎉 No hay deudas pendientes</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden mb-8">
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
                <th className="text-center p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pending.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(d => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3">{new Date(d.date).toLocaleDateString('es-AR')}</td>
                  <td className="p-3 font-medium">{d.customerName}</td>
                  <td className="p-3 text-muted-foreground">{d.description}</td>
                  <td className="p-3 text-right">{formatARS(d.amountARS)}</td>
                  <td className="p-3 text-right text-success">{formatARS(d.paidARS)}</td>
                  <td className="p-3 text-right font-bold text-destructive">{formatARS(d.remainingARS)}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.status === 'partial' ? 'bg-warning/20 text-warning' : 'bg-destructive/20 text-destructive'}`}>
                      {d.status === 'partial' ? 'Parcial' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="p-3 text-center space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => setPayingDebt(d)} title="Registrar pago">
                      <DollarSign className="w-3.5 h-3.5 text-success" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { deleteDebt(d.id); reload(); toast.success("Deuda eliminada"); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paid */}
      {paid.length > 0 && (
        <>
          <h2 className="text-lg font-display font-semibold mb-3 text-muted-foreground">Pagadas ({paid.length})</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden opacity-60">
            <table className="w-full text-sm">
              <tbody>
                {paid.slice(0, 10).map(d => (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="p-3">{new Date(d.date).toLocaleDateString('es-AR')}</td>
                    <td className="p-3">{d.customerName}</td>
                    <td className="p-3">{d.description}</td>
                    <td className="p-3 text-right">{formatARS(d.amountARS)}</td>
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

function PaymentForm({ debt, onSave }: { debt: Debt; onSave: () => void }) {
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payment = parseFloat(amount) || 0;
    if (payment <= 0) { toast.error("Ingresá un monto válido"); return; }
    if (payment > debt.remainingARS) { toast.error("El pago excede la deuda restante"); return; }

    const newPaid = debt.paidARS + payment;
    const newRemaining = debt.amountARS - newPaid;
    const newStatus = newRemaining <= 0 ? 'paid' : 'partial';

    updateDebt({
      ...debt,
      paidARS: newPaid,
      remainingARS: Math.max(0, newRemaining),
      status: newStatus,
    });
    toast.success(newStatus === 'paid' ? "¡Deuda saldada!" : "Pago parcial registrado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Cliente:</span><span className="font-medium">{debt.customerName}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Deuda total:</span><span>{formatARS(debt.amountARS)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Ya pagó:</span><span className="text-success">{formatARS(debt.paidARS)}</span></div>
        <div className="flex justify-between font-bold border-t border-border pt-1"><span>Resta:</span><span className="text-destructive">{formatARS(debt.remainingARS)}</span></div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Monto del pago (ARS)</label>
        <Input type="number" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Máx: ${debt.remainingARS}`} className="bg-muted border-border" />
      </div>
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Registrar Pago</Button>
    </form>
  );
}
