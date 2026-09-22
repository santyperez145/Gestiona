import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useOrg } from '@/lib/orgContext';
import { listInfluencers, listInfluencerSales, listPayouts } from '@/lib/influencersDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
export default function InfluencerPaymentsPage() {
  const { activeOrg } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get('vista') === 'pagos' ? 'pagos' : 'comisiones';
  const query = useQuery({ queryKey: ['influencer-settlements', activeOrg?.id], enabled: Boolean(activeOrg?.id), refetchOnWindowFocus: false,
    queryFn: async () => { const [sales, payouts, creators] = await Promise.all([listInfluencerSales(), listPayouts(), listInfluencers(activeOrg!.id)]); return { sales, payouts, creators }; },
  });
  if (query.isPending) return <WorkspaceState kind="initial-loading" title="Cargando comisiones y pagos" />;
  if (query.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar las comisiones" actionLabel="Reintentar" onAction={() => void query.refetch()} />;
  const { sales, payouts, creators } = query.data;
  const names = new Map(creators.map(item => [item.id, item.name]));
  const paid = payouts.reduce((sum, item) => sum + Number(item.amount_ars ?? 0), 0);
  const pending = sales.filter(item => !item.paid).reduce((sum, item) => sum + Number(item.commission_ars ?? 0), 0);
  return <div className="space-y-5"><PageHeader icon={Wallet} eyebrow="Nerqia · Influencers" title="Comisiones y pagos" />
    <dl className="grid gap-4 border-y border-border py-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Comisiones pendientes</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(pending)}</dd></div><div><dt className="text-sm text-muted-foreground">Pagos registrados</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(paid)}</dd></div></dl>
    <Tabs value={tab} onValueChange={value => setParams({ vista: value }, { replace: true })}><TabsList><TabsTrigger value="comisiones">Ventas con comisión</TabsTrigger><TabsTrigger value="pagos">Historial de pagos</TabsTrigger></TabsList></Tabs>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Fecha</th><th className="p-3 text-right">{tab === 'pagos' ? 'Pago registrado' : 'Comisión'}</th><th className="p-3">{tab === 'pagos' ? 'Medio' : 'Estado'}</th></tr></thead><tbody className="divide-y divide-border">{(tab === 'pagos' ? payouts : sales).map(item => <tr key={item.id}><td className="py-4">{names.get(item.influencer_id) ?? 'Creador no disponible'}</td><td className="p-3">{new Date(item.paid_at || item.created_at).toLocaleDateString('es-AR')}</td><td className="p-3 text-right tabular-nums">{money(Number(tab === 'pagos' ? item.amount_ars : item.commission_ars))}</td><td className="p-3">{tab === 'pagos' ? ({ transferencia: 'Transferencia', transfer: 'Transferencia', efectivo: 'Efectivo', cash: 'Efectivo', mercadopago: 'Mercado Pago' }[item.payment_method] ?? 'Otro medio') : <Badge variant="outline">{item.paid ? 'Liquidada' : 'Pendiente'}</Badge>}</td></tr>)}</tbody></table></div>
    {(tab === 'pagos' ? payouts : sales).length === 0 && <WorkspaceState kind="empty-first-use" title={tab === 'pagos' ? 'Sin pagos registrados' : 'Sin ventas atribuidas'} />}
  </div>;
}
