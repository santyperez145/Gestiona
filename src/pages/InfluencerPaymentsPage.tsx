import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw, Wallet, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { mensajeDeEdgeFunction } from '@/lib/edgeErrors';
import { useOrg } from '@/lib/orgContext';
import { listInfluencers, listInfluencerSales, listPayouts, listWithdrawalRequests, resolveWithdrawalRequest } from '@/lib/influencersDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface PayoutBatchRow {
  id: string;
  status: string;
  total_ars: number;
  items_count: number;
  created_at: string;
  mp_payout_id: string | null;
  last_error: string | null;
}

const BATCH_STATES: Record<string, string> = {
  processing: 'Procesándose en Mercado Pago', completed: 'Completado',
  failed: 'Fallido', partially_completed: 'Parcialmente completado',
};

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
  const batches = useQuery({ queryKey: ['influencer-payout-batches', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retiros', refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('influencer_payout_batches' as never).select('*').order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []) as PayoutBatchRow[];
    },
  });
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [pagando, setPagando] = useState(false);
  const [syncId, setSyncId] = useState<string | null>(null);
  const aprobados = useMemo(() => (withdrawals.data ?? []).filter(w => w.status === 'approved'), [withdrawals.data]);
  const totalSeleccion = useMemo(() => aprobados.filter(w => seleccion.has(w.id)).reduce((s, w) => s + Number(w.amount_ars), 0), [aprobados, seleccion]);

  const toggleSeleccion = (id: string) => setSeleccion(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Pago automático: la marca arma el lote y Mercado Pago transfiere a la
  // cuenta MP de cada creador (paridad Go-Marz). El servidor valida permisos
  // y el asiento de liquidación queda en la RPC, no acá.
  const pagarConMercadoPago = async () => {
    const ids = [...seleccion];
    if (!ids.length) { toast.error('Elegí al menos un retiro aprobado'); return; }
    setPagando(true);
    try {
      const { data, error } = await supabase.functions.invoke('mp-payouts', { body: { action: 'create', withdrawalIds: ids } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast.success(`Lote enviado a Mercado Pago: ${data.enviados} transferencia${Number(data.enviados) === 1 ? '' : 's'} en proceso`);
      setSeleccion(new Set());
      await Promise.all([
        client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] }),
        client.invalidateQueries({ queryKey: ['influencer-payout-batches', activeOrg?.id] }),
      ]);
    } catch (cause) {
      toast.error(await mensajeDeEdgeFunction(cause, 'No se pudo enviar el lote a Mercado Pago'));
    } finally {
      setPagando(false);
    }
  };

  const sincronizarLote = async (batchId: string) => {
    setSyncId(batchId);
    try {
      const { data, error } = await supabase.functions.invoke('mp-payouts', { body: { action: 'sync', batchId } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast[data.status === 'completed' ? 'success' : 'info'](
        data.status === 'completed' ? 'Lote completado: retiros marcados como pagados' : `Lote ${BATCH_STATES[data.status] ?? data.status}`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] }),
        client.invalidateQueries({ queryKey: ['influencer-payout-batches', activeOrg?.id] }),
      ]);
    } catch (cause) {
      toast.error(await mensajeDeEdgeFunction(cause, 'No se pudo sincronizar el lote'));
    } finally {
      setSyncId(null);
    }
  };
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
        : <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                aria-label="Seleccionar todos los retiros aprobados"
                checked={aprobados.length > 0 && aprobados.every(w => seleccion.has(w.id))}
                onChange={e => setSeleccion(e.target.checked ? new Set(aprobados.map(w => w.id)) : new Set())}
              />
              Todos ({aprobados.length})
            </label>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={pagando || seleccion.size === 0}
              onClick={() => void pagarConMercadoPago()}
            >
              {pagando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Pagar con Mercado Pago{seleccion.size > 0 ? ` (${seleccion.size} · ${money(totalSeleccion)})` : ''}
            </Button>
            <p className="text-xs text-muted-foreground">
              Transfiere automáticamente a la cuenta Mercado Pago de cada creador. Sin destino email, el ítem queda excluido.
            </p>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3 w-8"></th><th className="py-3">Creador</th><th className="p-3">Datos de cobro</th><th className="p-3">Fecha</th><th className="p-3 text-right">Monto</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">
          {(withdrawals.data ?? []).map(w => <tr key={w.id} className={seleccion.has(w.id) ? 'bg-primary/5' : undefined}>
            <td className="p-3">{w.status === 'approved' && (
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                aria-label={`Seleccionar retiro de ${names.get(w.influencer_id) ?? 'creador'}`}
                checked={seleccion.has(w.id)}
                onChange={() => toggleSeleccion(w.id)}
              />
            )}</td>
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

          {/* Lotes de pago automático enviados a Mercado Pago */}
          {(batches.data ?? []).length > 0 && (
            <section aria-label="Lotes de pago automático" className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Lotes enviados a Mercado Pago</p>
                <Button size="sm" variant="ghost" onClick={() => void batches.refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="divide-y divide-border">
                {(batches.data ?? []).map(b => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm tabular-nums">
                        {money(Number(b.total_ars))} · {b.items_count} retiro{Number(b.items_count) === 1 ? '' : 's'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(b.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        {b.mp_payout_id && ` · MP ${b.mp_payout_id.slice(0, 12)}`}
                        {b.last_error && ` · ${b.last_error}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={b.status === 'completed' ? 'default' : b.status === 'failed' ? 'destructive' : 'outline'}>
                        {BATCH_STATES[b.status] ?? b.status}
                      </Badge>
                      {b.status !== 'completed' && b.status !== 'failed' && (
                        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={syncId === b.id} onClick={() => void sincronizarLote(b.id)}>
                          {syncId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sincronizar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
    ) : <>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Fecha</th><th className="p-3 text-right">{tab === 'pagos' ? 'Pago registrado' : 'Comisión'}</th><th className="p-3">{tab === 'pagos' ? 'Medio' : 'Estado'}</th></tr></thead><tbody className="divide-y divide-border">{(tab === 'pagos' ? payouts : sales).map(item => <tr key={item.id}><td className="py-4">{names.get(item.influencer_id) ?? 'Creador no disponible'}</td><td className="p-3">{new Date(item.paid_at || item.created_at).toLocaleDateString('es-AR')}</td><td className="p-3 text-right tabular-nums">{money(Number(tab === 'pagos' ? item.amount_ars : item.commission_ars))}</td><td className="p-3">{tab === 'pagos' ? ({ transferencia: 'Transferencia', transfer: 'Transferencia', efectivo: 'Efectivo', cash: 'Efectivo', mercadopago: 'Mercado Pago' }[item.payment_method] ?? 'Otro medio') : <Badge variant="outline">{item.paid ? 'Liquidada' : 'Pendiente'}</Badge>}</td></tr>)}</tbody></table></div>
    {(tab === 'pagos' ? payouts : sales).length === 0 && <WorkspaceState kind="empty-first-use" title={tab === 'pagos' ? 'Sin pagos registrados' : 'Sin ventas atribuidas'} />}
    </>}
  </div>;
}
