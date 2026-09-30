import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Loader2, RefreshCw, RotateCcw, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/lib/orgContext';
import { approveAndPayCreatorWithdrawal, createAutomaticCreatorPayout, getCreatorPayoutCapability, heldPaymentLabel, listCreatorPayoutBatches, listInfluencers, listInfluencerSales, listPaymentsWithRelease, listPayouts, listWithdrawalRequests, resolveWithdrawalRequest, retryAutomaticCreatorPayout, reverseWithdrawalRequest, settleWithdrawalRequest, syncAutomaticCreatorPayout, withdrawalSettlementDetails, type WithdrawalRequest, type WithdrawalSettlementDetails } from '@/lib/influencersDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import SocialMetricReportsInbox from '@/components/influencers/SocialMetricReportsInbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
const WITHDRAWAL_STATES: Record<string, string> = { pending: 'En revisión', approved: 'Aprobado', paid: 'Pagado', rejected: 'Rechazado', reversed: 'Revertido' };

export default function InfluencerPaymentsPage() {
  const { activeOrg } = useOrg();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('vista') === 'pagos' ? 'pagos' : params.get('vista') === 'retiros' ? 'retiros' : params.get('vista') === 'retenidos' ? 'retenidos' : params.get('vista') === 'metricas' ? 'metricas' : 'comisiones';
  const query = useQuery({ queryKey: ['influencer-settlements', activeOrg?.id], enabled: Boolean(activeOrg?.id), refetchOnWindowFocus: false,
    queryFn: async () => { const [sales, payouts, creators] = await Promise.all([listInfluencerSales(), listPayouts(), listInfluencers(activeOrg!.id)]); return { sales, payouts, creators }; },
  });
  // Pagos retenidos hasta publicación verificada (Go-Marz parity).
  const held = useQuery({ queryKey: ['influencer-held-payments', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retenidos', refetchOnWindowFocus: false,
    queryFn: () => listPaymentsWithRelease(),
  });
  const withdrawals = useQuery({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retiros', refetchOnWindowFocus: false,
    queryFn: () => listWithdrawalRequests(),
  });
  const payoutCapability = useQuery({ queryKey: ['creator-payout-capability', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retiros', staleTime: 5 * 60_000,
    queryFn: getCreatorPayoutCapability,
  });
  const payoutBatches = useQuery({ queryKey: ['creator-payout-batches', activeOrg?.id], enabled: Boolean(activeOrg?.id) && tab === 'retiros', refetchOnWindowFocus: false,
    queryFn: listCreatorPayoutBatches,
  });
  const [liquidando, setLiquidando] = useState<WithdrawalRequest | null>(null);
  const [detalleDestino, setDetalleDestino] = useState<WithdrawalSettlementDetails | null>(null);
  const [referencia, setReferencia] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [operandoLote, setOperandoLote] = useState<string | null>(null);
  const [revirtiendo, setRevirtiendo] = useState<WithdrawalRequest | null>(null);
  const [referenciaReversa, setReferenciaReversa] = useState('');
  const [motivoReversa, setMotivoReversa] = useState('');
  const [guardandoReversa, setGuardandoReversa] = useState(false);

  const confirmarReversa = async () => {
    if (!revirtiendo || referenciaReversa.trim().length < 3 || motivoReversa.trim().length < 5) return;
    setGuardandoReversa(true);
    try {
      await reverseWithdrawalRequest(revirtiendo.id, referenciaReversa.trim(), motivoReversa.trim());
      toast.success('Reversa registrada; saldo, gasto y asiento fueron corregidos');
      setRevirtiendo(null);
      setReferenciaReversa('');
      setMotivoReversa('');
      await refreshPayoutData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No pudimos registrar la reversa');
    } finally {
      setGuardandoReversa(false);
    }
  };

  const refreshPayoutData = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] }),
      client.invalidateQueries({ queryKey: ['influencer-settlements', activeOrg?.id] }),
      client.invalidateQueries({ queryKey: ['creator-payout-batches', activeOrg?.id] }),
    ]);
  };

  const ejecutarPagoAutomatico = async (withdrawalId: string) => {
    setOperandoLote(withdrawalId);
    try {
      const result = await createAutomaticCreatorPayout([withdrawalId]);
      if (result.code === 'payout_confirmation_pending') toast.warning(result.error ?? 'El proveedor todavía no confirmó el lote.');
      else toast.success('Lote enviado a Mercado Pago. Se liquidará cuando el proveedor confirme la transferencia.');
      await refreshPayoutData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No pudimos enviar el pago');
    } finally {
      setOperandoLote(null);
    }
  };

  const aprobarYPagar = async (withdrawalId: string) => {
    setOperandoLote(withdrawalId);
    try {
      const result = await approveAndPayCreatorWithdrawal(withdrawalId);
      if (result.code === 'payout_confirmation_pending') {
        toast.warning(result.error ?? 'El proveedor todavía no confirmó el lote.');
      } else {
        toast.success('Retiro aprobado y enviado. Se liquidará cuando Mercado Pago confirme el pago.');
      }
      await refreshPayoutData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No pudimos aprobar y enviar el pago');
      await refreshPayoutData();
    } finally {
      setOperandoLote(null);
    }
  };

  const actualizarLote = async (batchId: string, retry: boolean) => {
    setOperandoLote(batchId);
    try {
      const result = retry
        ? await retryAutomaticCreatorPayout(batchId)
        : await syncAutomaticCreatorPayout(batchId);
      if (result.code === 'payout_confirmation_pending') toast.warning(result.error ?? 'El proveedor todavía no confirmó el lote.');
      else toast.success(result.status === 'completed' ? 'Pago confirmado y conciliado' : 'Estado del lote actualizado');
      await refreshPayoutData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No pudimos actualizar el lote');
    } finally {
      setOperandoLote(null);
    }
  };

  const abrirLiquidacion = async (withdrawal: WithdrawalRequest) => {
    setLiquidando(withdrawal);
    setDetalleDestino(null);
    setReferencia('');
    try {
      setDetalleDestino(await withdrawalSettlementDetails(withdrawal.id));
    } catch {
      toast.error('No pudimos abrir el destino de cobro. Revisá tus permisos.');
      setLiquidando(null);
    }
  };

  const confirmarLiquidacion = async () => {
    if (!liquidando || referencia.trim().length < 3) return;
    setGuardandoPago(true);
    try {
      await settleWithdrawalRequest(liquidando.id, referencia.trim(), liquidando.payout_provider === 'mercadopago' ? 'mercadopago' : 'transferencia');
      toast.success('Transferencia registrada y comisión liquidada');
      setLiquidando(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] }),
        client.invalidateQueries({ queryKey: ['influencer-settlements', activeOrg?.id] }),
      ]);
    } catch (cause: any) {
      toast.error(cause.message || 'No pudimos registrar la transferencia');
    } finally {
      setGuardandoPago(false);
    }
  };
  if (query.isPending) return <WorkspaceState kind="initial-loading" title="Cargando comisiones y pagos" />;
    if (query.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar las comisiones" actionLabel="Reintentar" onAction={() => void query.refetch()} />;
  const { sales, payouts, creators } = query.data;
  const names = new Map(creators.map(item => [item.id, item.name]));
  const paid = payouts.reduce((sum, item) => sum + Number(item.amount_ars ?? 0), 0);
  const pending = sales.filter(item => !item.paid).reduce((sum, item) => sum + Number(item.commission_ars ?? 0), 0);
  const resolve = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await resolveWithdrawalRequest(id, status);
      toast.success(status === 'rejected' ? 'Solicitud rechazada' : 'Solicitud aprobada');
      await client.invalidateQueries({ queryKey: ['influencer-withdrawal-requests', activeOrg?.id] });
    } catch { toast.error('No pudimos actualizar la solicitud. Intentá nuevamente.'); }
  };
  return <div className="space-y-5"><PageHeader icon={Wallet} eyebrow="Nerqia · Influencers" title="Comisiones y pagos" />
    <dl className="grid gap-4 border-y border-border py-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Comisiones pendientes</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(pending)}</dd></div><div><dt className="text-sm text-muted-foreground">Pagos registrados</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(paid)}</dd></div></dl>
    <Tabs value={tab} onValueChange={value => setParams({ vista: value }, { replace: true })}><TabsList className="h-auto w-full justify-start overflow-x-auto"><TabsTrigger className="shrink-0" value="comisiones">Ventas con comisión</TabsTrigger><TabsTrigger className="shrink-0" value="pagos">Historial de pagos</TabsTrigger><TabsTrigger className="shrink-0" value="retenidos">Retenidos hasta publicar</TabsTrigger><TabsTrigger className="shrink-0" value="retiros">Solicitudes de retiro</TabsTrigger><TabsTrigger className="shrink-0" value="metricas">Métricas de creadores</TabsTrigger></TabsList></Tabs>
    {tab === 'retiros' ? (
      withdrawals.isPending ? <WorkspaceState kind="initial-loading" title="Cargando solicitudes de retiro" />
        : withdrawals.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar las solicitudes" actionLabel="Reintentar" onAction={() => void withdrawals.refetch()} />
        : !(withdrawals.data ?? []).length ? <WorkspaceState kind="empty-first-use" title="Sin solicitudes de retiro" description="Cuando un creador pida retirar su saldo, la solicitud aparece acá." />
        : <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm font-medium">Liquidación por destino elegido</p>
            <p className="mt-1 text-xs text-muted-foreground">Mercado Pago puede transferir y conciliar automáticamente cuando la cuenta tiene Payouts habilitado. Banco u otra billetera requieren ejecutar la transferencia en ese proveedor y registrar su comprobante.</p>
            {payoutCapability.isError && (
              <p className="mt-2 text-xs font-medium text-amber-700">No pudimos verificar la disponibilidad del pago automático. Reintentá antes de enviar dinero.</p>
            )}
            {!payoutCapability.isPending && !payoutCapability.isError && !payoutCapability.data?.enabled && (
              <p className="mt-2 text-xs font-medium text-amber-700">Pago masivo de Mercado Pago pendiente de habilitación comercial. La liquidación manual comprobable sigue disponible.</p>
            )}
            {payoutCapability.data?.enabled && !payoutCapability.data.provider_connected && (
              <p className="mt-2 text-xs font-medium text-amber-700">Conectá la cuenta Mercado Pago del comercio en Configuración → Cobros para habilitar los envíos.</p>
            )}
            {payoutCapability.data?.enabled && !payoutCapability.data.notification_configured && (
              <p className="mt-2 text-xs font-medium text-amber-700">Configurá el webhook de Payouts para recibir confirmaciones automáticas; mientras tanto podés sincronizar cada lote.</p>
            )}
          </div>
          {(payoutBatches.data ?? []).some(batch => ['processing', 'awaiting_confirmation', 'partially_completed'].includes(batch.status)) && (
            <div className="space-y-2 border-y border-border py-3">
              <p className="text-sm font-medium">Lotes en curso</p>
              {(payoutBatches.data ?? []).filter(batch => ['processing', 'awaiting_confirmation', 'partially_completed'].includes(batch.status)).map(batch => (
                <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{money(Number(batch.total_ars))} · {batch.items_count} {batch.items_count === 1 ? 'retiro' : 'retiros'}</p>
                    <p className="text-xs text-muted-foreground">{batch.status === 'awaiting_confirmation' ? 'Confirmación pendiente' : batch.status === 'partially_completed' ? 'Parcialmente conciliado' : 'En procesamiento'}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={operandoLote === batch.id} onClick={() => void actualizarLote(batch.id, batch.status === 'awaiting_confirmation')}>
                    {operandoLote === batch.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                    {batch.status === 'awaiting_confirmation' ? 'Reintentar sin duplicar' : 'Sincronizar'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Destino</th><th className="p-3">Fecha</th><th className="p-3 text-right">Monto</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">
          {(withdrawals.data ?? []).map(w => <tr key={w.id}>
            <td className="py-4 font-medium">{names.get(w.influencer_id) ?? 'Creador'}</td>
            <td className="p-3 text-xs text-muted-foreground max-w-[220px] break-words">
              {w.payout_provider_label ? `${w.payout_provider_label} · ${w.payout_identifier_masked}` : 'Solicitud anterior sin destino estructurado'}
              {w.payout_holder_name && <span className="block">Titular: {w.payout_holder_name}</span>}
              {w.payment_reference && <span className="block">Ref. {w.payment_reference}</span>}
              {w.reversal_reference && <span className="block">Reversa {w.reversal_reference}</span>}
            </td>
            <td className="p-3 text-xs">{new Date(w.created_at).toLocaleDateString('es-AR')}</td>
            <td className="p-3 text-right tabular-nums font-semibold">{money(Number(w.amount_ars))}</td>
            <td className="p-3"><Badge variant="outline">{WITHDRAWAL_STATES[w.status] ?? w.status}</Badge></td>
            <td className="p-3"><div className="flex justify-end gap-1">{w.status === 'pending' && <>
              <Button size="icon" variant="ghost" title="Rechazar solicitud" aria-label={`Rechazar solicitud de ${names.get(w.influencer_id) ?? 'creador'}`} onClick={() => void resolve(w.id, 'rejected')}><X className="h-4 w-4 text-destructive" /></Button>
              <Button size="icon" variant="ghost" title="Aprobar sin enviar" aria-label={`Aprobar solicitud de ${names.get(w.influencer_id)}`} disabled={operandoLote === w.id} onClick={() => void resolve(w.id, 'approved')}><Check className="h-4 w-4 text-emerald-600" /></Button>
              {w.payout_provider === 'mercadopago' && w.payout_destination_type === 'email' && payoutCapability.data?.automatic_available && (
                <Button size="sm" disabled={operandoLote === w.id} onClick={() => void aprobarYPagar(w.id)}>
                  {operandoLote === w.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                  Aprobar y pagar
                </Button>
              )}
            </>}
            {w.status === 'approved' && w.payout_provider === 'mercadopago' && payoutCapability.data?.enabled && payoutCapability.data.provider_connected && (
              <Button size="sm" disabled={operandoLote === w.id} onClick={() => void ejecutarPagoAutomatico(w.id)}>
                {operandoLote === w.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                Pagar con Mercado Pago
              </Button>
            )}
            {w.status === 'approved' && <Button size="sm" variant="outline" onClick={() => void abrirLiquidacion(w)}>Registrar transferencia</Button>}
            {w.status === 'paid' && <Button size="icon" variant="ghost" title="Registrar reversa confirmada" aria-label={`Registrar reversa de ${names.get(w.influencer_id) ?? 'creador'}`} onClick={() => { setRevirtiendo(w); setReferenciaReversa(''); setMotivoReversa(''); }}><RotateCcw className="h-4 w-4" /></Button>}
            </div></td>
          </tr>)}
        </tbody></table></div>
        </div>
    ) : tab === 'metricas' ? (
      <SocialMetricReportsInbox activeOrgId={activeOrg?.id ?? null} />
    ) : tab === 'retenidos' ? (
      held.isPending ? <WorkspaceState kind="initial-loading" title="Cargando pagos retenidos" />
        : held.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar los pagos retenidos" actionLabel="Reintentar" onAction={() => void held.refetch()} />
        : !(held.data ?? []).length ? <WorkspaceState kind="empty-first-use" title="Sin pagos retenidos" description="Los pagos sujetos a publicación aparecen acá y se liberan cuando la marca verifica la evidencia." />
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Fecha</th><th className="p-3 text-right">Monto</th><th className="p-3">Estado</th></tr></thead><tbody className="divide-y divide-border">{(held.data ?? []).map(p => <tr key={p.id}><td className="py-4 font-medium">{p.influencer_name}</td><td className="p-3">{new Date(p.created_at).toLocaleDateString('es-AR')}</td><td className="p-3 text-right tabular-nums">{money(Number(p.amount))}</td><td className="p-3"><Badge variant={p.is_payable && p.status !== 'completed' ? 'default' : 'outline'}>{heldPaymentLabel(p)}</Badge></td></tr>)}</tbody></table></div>
    ) : <>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Fecha</th><th className="p-3 text-right">{tab === 'pagos' ? 'Pago registrado' : 'Comisión'}</th><th className="p-3">{tab === 'pagos' ? 'Medio' : 'Estado'}</th></tr></thead><tbody className="divide-y divide-border">{(tab === 'pagos' ? payouts : sales).map(item => <tr key={item.id}><td className="py-4">{names.get(item.influencer_id) ?? 'Creador no disponible'}</td><td className="p-3">{new Date(item.paid_at || item.created_at).toLocaleDateString('es-AR')}</td><td className="p-3 text-right tabular-nums">{money(Number(tab === 'pagos' ? item.amount_ars : item.commission_ars))}</td><td className="p-3">{tab === 'pagos' ? ({ transferencia: 'Transferencia', transfer: 'Transferencia', efectivo: 'Efectivo', cash: 'Efectivo', mercadopago: 'Mercado Pago' }[item.payment_method] ?? 'Otro medio') : <Badge variant="outline">{item.paid ? 'Liquidada' : 'Pendiente'}</Badge>}</td></tr>)}</tbody></table></div>
    {(tab === 'pagos' ? payouts : sales).length === 0 && <WorkspaceState kind="empty-first-use" title={tab === 'pagos' ? 'Sin pagos registrados' : 'Sin ventas atribuidas'} />}
    </>}
    <Dialog open={Boolean(liquidando)} onOpenChange={open => { if (!open && !guardandoPago) setLiquidando(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Liquidar comisión</DialogTitle>
          <DialogDescription>Transferí desde el proveedor correspondiente y guardá la referencia. Nerqia no marca el retiro como pagado antes de esta confirmación.</DialogDescription>
        </DialogHeader>
        {!detalleDestino ? <div className="grid min-h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{detalleDestino.provider_label ?? 'Destino de cobro'}</p>
            <p className="mt-1 text-muted-foreground">Titular: {detalleDestino.holder_name ?? 'No informado'}</p>
            <p className="mt-1 break-all font-mono text-xs">{detalleDestino.identifier ?? 'Destino anterior: coordiná los datos con el creador'}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="referencia-liquidacion">Referencia o comprobante</Label>
            <Input id="referencia-liquidacion" value={referencia} onChange={event => setReferencia(event.target.value)} placeholder="ID de operación o número de comprobante" maxLength={160} />
          </div>
        </div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setLiquidando(null)} disabled={guardandoPago}>Cancelar</Button>
          <Button onClick={() => void confirmarLiquidacion()} disabled={guardandoPago || !detalleDestino || referencia.trim().length < 3}>
            {guardandoPago && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Confirmar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(revirtiendo)} onOpenChange={open => { if (!open && !guardandoReversa) setRevirtiendo(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar reversa</DialogTitle>
          <DialogDescription>Usá esta acción sólo cuando el proveedor haya devuelto o rechazado un pago previamente confirmado. Nerqia conservará el pago original y agregará los ajustes contables.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="referencia-reversa">Referencia del proveedor</Label>
            <Input id="referencia-reversa" value={referenciaReversa} onChange={event => setReferenciaReversa(event.target.value)} placeholder="ID de devolución o contracargo" maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-reversa">Motivo</Label>
            <Input id="motivo-reversa" value={motivoReversa} onChange={event => setMotivoReversa(event.target.value)} placeholder="Por qué el proveedor revirtió el pago" maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRevirtiendo(null)} disabled={guardandoReversa}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void confirmarReversa()} disabled={guardandoReversa || referenciaReversa.trim().length < 3 || motivoReversa.trim().length < 5}>
            {guardandoReversa && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Confirmar reversa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
