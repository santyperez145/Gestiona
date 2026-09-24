import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/lib/orgContext';
import { listInfluencers, listInfluencerSales, listPayouts, listWithdrawalRequests, resolveWithdrawalRequest } from '@/lib/influencersDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
const WITHDRAWAL_STATES: Record<string, string> = { pending: 'En revisión', approved: 'Aprobado', paid: 'Pagado', rejected: 'Rechazado' };

export default function InfluencerPaymentsPage() {
  const { activeOrg } = useOrg();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('vista') === 'pagos' ? 'pagos' : params.get('vista') === 'retiros' ? 'retiros' : 'comisiones';
  const query = useQuery({ queryKey: ['influencer-settlements', activeOrg?.id], enabled: Boolean(activeOrg?.id), refetchOnWindowFocus: false,
    queryFn: async () => { const [sales, payouts, creators] = await Promise.all([listInfluencerSales(), listPayouts(), listInfluencers(activeOrg!.id)]); return { sales, payouts, creators }; },
  });
  const withdrawals = useQuery({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retiros', refetchOnWindowFocus: false,
    queryFn: () => listWithdrawalRequests(),
  });
  if (query.isPending) return <WorkspaceState kind="initial-loading" title="Cargando comisiones y pagos" />;
    if (query.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar las comisiones" actionLabel="Reintentar" onAction={() => void query.refetch()} />;
  const { sales, payouts, creators } = query.data;
  const names = new Map(creators.map(item => [item.id, item.name]));
  const paid = payouts.reduce((sum, item) => sum + Number(item.amount_ars ?? 0), 0);
  const pending = sales.filter(item => !item.paid).reduce((sum, item) => sum + Number(item.commission_ars ?? 0), 0);
  const resolve = async (id: string, status: 'approved' | 'rejected' | 'paid') => {
    try {
      await resolveWithdrawalRequest(id, status);
      toast.success(status === 'rejected' ? 'Solicitud rechazada' : 'Solicitud aprobada');
      await client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] });
    } catch { toast.error('No pudimos actualizar la solicitud. Intentá nuevamente.'); }
  };
  return <div className="space-y-5"><PageHeader icon={Wallet} eyebrow="Nerqia · Influencers" title="Comisiones y pagos" />
    <dl className="grid gap-4 border-y border-border py-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Comisiones pendientes</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(pending)}</dd></div><div><dt className="text-sm text-muted-foreground">Pagos registrados</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(paid)}</dd></div></dl>
    <Tabs value={tab} onValueChange={value => setParams({ vista: value }, { replace: true })}><TabsList><TabsTrigger value="comisiones">Ventas con comisión</TabsTrigger><TabsTrigger value="pagos">Historial de pagos</TabsTrigger><TabsTrigger value="retiros">Solicitudes de retiro</TabsTrigger></TabsList></Tabs>
    {tab === 'retiros' ? (
      withdrawals.isPending ? <WorkspaceState kind="initial-loading" title="Cargando solicitudes de retiro" />
        : withdrawals.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar las solicitudes" actionLabel="Reintentar" onAction={() => void withdrawals.refetch()} />
        : !(withdrawals.data ?? []).length ? <WorkspaceState kind="empty-first-use" title="Sin solicitudes de retiro" description="Cuando un creador pida retirar su saldo, la solicitud aparece acá." />
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Datos de cobro</th><th className="p-3">Fecha</th><th className="p-3 text-right">Monto</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">
          {(withdrawals.data ?? []).map(w => <tr key={w.id}>
            <td className="py-4 font-medium">{names.get(w.influencer_id) ?? 'Creador'}</td>
            <td className="p-3 text-xs text-muted-foreground max-w-[220px] break-words">{w.notes || 'Sin datos cargados'}</td>
            <td className="p-3 text-xs">{new Date(w.created_at).toLocaleDateString('es-AR')}</td>
            <td className="p-3 text-right tabular-nums font-semibold">{money(Number(w.amount_ars))}</td>
            <td className="p-3"><Badge variant="outline">{WITHDRAWAL_STATES[w.status] ?? w.status}</Badge></td>
            <td className="p-3"><div className="flex justify-end gap-1">{w.status === 'pending' && <>
              <Button size="icon" variant="ghost" title="Rechazar solicitud" aria-label={`Rechazar solicitud de ${names.get(w.influencer_id) ?? 'creador'}`} onClick={() => void resolve(w.id, 'rejected')}><X className="h-4 w-4 text-destructive" /></Button>
              <Button size="icon" variant="ghost" title="Marcar como pagada" aria-label={`Marcar pagada la solicitud de ${names.get(w.influencer_id)}`} onClick={() => void resolve(w.id, 'paid')}><Check className="h-4 w-4 text-emerald-600" /></Button>
            </>}</div></td>
          </tr>)}
        </tbody></table></div>
    ) : <>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Fecha</th><th className="p-3 text-right">{tab === 'pagos' ? 'Pago registrado' : 'Comisión'}</th><th className="p-3">{tab === 'pagos' ? 'Medio' : 'Estado'}</th></tr></thead><tbody className="divide-y divide-border">{(tab === 'pagos' ? payouts : sales).map(item => <tr key={item.id}><td className="py-4">{names.get(item.influencer_id) ?? 'Creador no disponible'}</td><td className="p-3">{new Date(item.paid_at || item.created_at).toLocaleDateString('es-AR')}</td><td className="p-3 text-right tabular-nums">{money(Number(tab === 'pagos' ? item.amount_ars : item.commission_ars))}</td><td className="p-3">{tab === 'pagos' ? ({ transferencia: 'Transferencia', transfer: 'Transferencia', efectivo: 'Efectivo', cash: 'Efectivo', mercadopago: 'Mercado Pago' }[item.payment_method] ?? 'Otro medio') : <Badge variant="outline">{item.paid ? 'Liquidada' : 'Pendiente'}</Badge>}</td></tr>)}</tbody></table></div>
    {(tab === 'pagos' ? payouts : sales).length === 0 && <WorkspaceState kind="empty-first-use" title={tab === 'pagos' ? 'Sin pagos registrados' : 'Sin ventas atribuidas'} />}
    </>}
  </div>;
}
