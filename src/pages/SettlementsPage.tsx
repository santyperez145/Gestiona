import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { listInfluencers, listPayouts, createPayout, type Influencer } from "@/lib/influencersDB";
import { listInfluencerSalesByPeriod } from "@/lib/marketingExtraDB";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Wallet, Download, Calendar, CheckCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import KPICard from "@/components/shared/KPICard";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

function startOfMonthISO(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
function endOfMonthISO(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString(); }
function toDateInput(d: Date) { return d.toISOString().slice(0, 10); }

export default function SettlementsPage() {
  usePageTitle("Liquidaciones");
  const { user } = useAuth();
  const today = new Date();
  const [from, setFrom] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [filterInf, setFilterInf] = useState<string>('all');
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [infs, ps, ss] = await Promise.all([
        listInfluencers(),
        listPayouts(),
        listInfluencerSalesByPeriod({
          from: new Date(from + 'T00:00:00').toISOString(),
          to: new Date(to + 'T23:59:59').toISOString(),
          influencerId: filterInf !== 'all' ? filterInf : undefined,
          onlyUnpaid,
        }),
      ]);
      setInfluencers(infs);
      setPayouts(ps);
      setSales(ss);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (user) reload(); /* eslint-disable-next-line */ }, [user, from, to, filterInf, onlyUnpaid]);

  const grouped = useMemo(() => {
    const m = new Map<string, { influencer_id: string; sales: any[]; total_commission: number; total_sales: number; count: number }>();
    sales.forEach(s => {
      const k = s.influencer_id;
      if (!m.has(k)) m.set(k, { influencer_id: k, sales: [], total_commission: 0, total_sales: 0, count: 0 });
      const e = m.get(k)!;
      e.sales.push(s);
      e.total_commission += Number(s.commission_ars || 0);
      e.total_sales += Number(s.sale_total_ars || 0);
      e.count += 1;
    });
    return Array.from(m.values()).sort((a, b) => b.total_commission - a.total_commission);
  }, [sales]);

  const totals = useMemo(() => ({
    sales: sales.reduce((s, x) => s + Number(x.sale_total_ars || 0), 0),
    commissions: sales.reduce((s, x) => s + Number(x.commission_ars || 0), 0),
    count: sales.length,
    influencers: grouped.length,
  }), [sales, grouped]);

  const exportCSV = (group: any) => {
    const inf = influencers.find(i => i.id === group.influencer_id);
    const rows = [
      ['Liquidación', inf?.name || ''],
      ['Período', `${from} a ${to}`],
      ['Total ventas', String(group.total_sales)],
      ['Total comisión', String(group.total_commission)],
      [],
      ['Fecha', 'Código', 'Total venta ARS', 'Comisión ARS', 'Pagado'],
      ...group.sales.map((s: any) => [
        new Date(s.created_at).toLocaleString('es-AR'),
        s.referral_code, s.sale_total_ars, s.commission_ars, s.paid ? 'sí' : 'no',
      ]),
    ];
    const csv = rows.map(r => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liquidacion-${inf?.name || 'influencer'}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePay = async (group: any, method: string, notes: string) => {
    if (!user) return;
    try {
      await createPayout(group.influencer_id, group.total_commission, group.sales.map((s: any) => s.id), user.id, {
        period_start: new Date(from + 'T00:00:00').toISOString(),
        period_end: new Date(to + 'T23:59:59').toISOString(),
        payment_method: method,
        notes,
      });
      toast.success("Liquidación registrada");
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Wallet}
        title="Liquidaciones de Influencers"
        description="Calculá comisiones por período y registrá los pagos"
        badge={totals.commissions > 0 ? { label: `${formatARS(totals.commissions)} a liquidar`, variant: "warning" } : undefined}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Ventas referidas" value={formatARS(totals.sales)} icon={Calendar} sub={`${totals.count} ventas`} />
        <KPICard label="Comisiones" value={formatARS(totals.commissions)} icon={Wallet} sub="A liquidar" />
        <KPICard label="Influencers" value={totals.influencers} icon={CheckCircle} sub="Con ventas" />
        <KPICard label="Pagos hechos" value={payouts.length} icon={FileText} sub="Histórico" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Desde</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Hasta</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Influencer</label>
          <Select value={filterInf} onValueChange={setFilterInf}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {influencers.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Estado</label>
          <Select value={onlyUnpaid ? 'unpaid' : 'all'} onValueChange={v => setOnlyUnpaid(v === 'unpaid')}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">Sólo no pagadas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>No hay ventas referidas en este período</p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {grouped.map(g => {
            const inf = influencers.find(i => i.id === g.influencer_id);
            return (
              <div key={g.influencer_id} className="bg-card border border-border/60 rounded-lg p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{inf?.name || 'Influencer'}</p>
                    <p className="text-xs text-muted-foreground">@{inf?.instagram} · Código: {inf?.referral_code} · {g.count} ventas</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Ventas</p>
                      <p className="font-medium">{formatARS(g.total_sales)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Comisión</p>
                      <p className="font-bold text-primary">{formatARS(g.total_commission)}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => exportCSV(g)}><Download className="w-3 h-3 mr-1" />CSV</Button>
                    <PayDialog group={g} onPay={(m, n) => handlePay(g, m, n)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {payouts.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-lg mb-3">Historial de pagos</h2>
          <div className="bg-card border border-border/60 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3">Fecha</th>
                  <th className="text-left p-3">Influencer</th>
                  <th className="text-left p-3">Período</th>
                  <th className="text-center p-3">Ventas</th>
                  <th className="text-right p-3">Monto</th>
                  <th className="text-left p-3">Método</th>
                </tr>
              </thead>
              <tbody>
                {payouts.slice(0, 50).map(p => {
                  const inf = influencers.find(i => i.id === p.influencer_id);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="p-3">{new Date(p.paid_at).toLocaleDateString('es-AR')}</td>
                      <td className="p-3">{inf?.name || '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {p.period_start ? `${new Date(p.period_start).toLocaleDateString('es-AR')} → ${new Date(p.period_end).toLocaleDateString('es-AR')}` : '—'}
                      </td>
                      <td className="p-3 text-center">{p.sales_count}</td>
                      <td className="p-3 text-right font-medium">{formatARS(Number(p.amount_ars))}</td>
                      <td className="p-3">{p.payment_method || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PayDialog({ group, onPay }: { group: any; onPay: (method: string, notes: string) => void }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('transferencia');
  const [notes, setNotes] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gradient-gold text-primary-foreground"><CheckCircle className="w-3 h-3 mr-1" />Liquidar</Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border/60">
        <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
        <div className="space-y-3 pb-12">
          <p className="text-sm text-muted-foreground">Vas a registrar el pago de <strong>{formatARS(group.total_commission)}</strong> por {group.count} ventas. Las ventas quedarán marcadas como pagadas.</p>
          <div>
            <label className="text-xs text-muted-foreground">Método de pago</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="transferencia">Transferencia</SelectItem>
                <SelectItem value="efectivo">Efectivo</SelectItem>
                <SelectItem value="mercadopago">MercadoPago</SelectItem>
                <SelectItem value="usd">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notas (opcional)</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comprobante, referencia..." className="bg-muted border-border" />
          </div>
          <Button className="w-full gradient-gold text-primary-foreground" onClick={() => { onPay(method, notes); setOpen(false); }}>
            Confirmar liquidación
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}