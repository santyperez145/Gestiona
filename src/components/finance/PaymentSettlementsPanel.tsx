import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { CreditCard, ChevronDown, ChevronRight, Info, Route, Loader2, BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PROVIDER_LABEL, METHOD_LABEL, round2 } from '@/lib/paymentFees';
import { previewPosSettlement } from '@/lib/posPaymentSettlement';
import { useHasPermission } from '@/lib/usePermissions';
import { toast } from 'sonner';

/**
 * Lo que la tienda realmente recibe por cada cobro digital.
 *
 * Cobrar $10.000 con tarjeta no son $10.000: hay arancel del procesador, IVA
 * sobre ese arancel y comisión de la plataforma. Sin este desglose el comercio
 * cree que gana un margen que no gana.
 */

interface PaymentTx {
  id: string;
  source: string;
  provider: string;
  method: string;
  installments: number;
  gross_amount: number;
  provider_fee: number;
  provider_fee_iva: number;
  platform_fee: number;
  net_amount: number;
  currency: string;
  status: string;
  expected_release_at: string | null;
  released_at: string | null;
  correlation_id: string | null;
  external_id: string | null;
  created_at: string;
}

interface PaymentTraceRow {
  record_id: string;
  stage: string;
  stage_order: number;
  status: string;
  provider: string | null;
  provider_reference: string | null;
  occurred_at: string;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  approved:     { label: 'Acreditado',  cls: 'bg-emerald-500/12 text-emerald-400' },
  pending:      { label: 'Pendiente',   cls: 'bg-yellow-500/12 text-yellow-500' },
  rejected:     { label: 'Rechazado',   cls: 'bg-destructive/12 text-destructive' },
  refunded:     { label: 'Devuelto',    cls: 'bg-muted text-muted-foreground' },
  charged_back: { label: 'Contracargo', cls: 'bg-destructive/12 text-destructive' },
};

const SOURCE_LABEL: Record<string, string> = {
  ecommerce: 'Tienda online',
  payment_link: 'Link de pago',
  pos: 'POS',
  subscription: 'Suscripción',
  otro: 'Otro',
};

const TRACE_STAGE: Record<string, string> = {
  intent: 'Operación creada',
  attempt: 'Intento con proveedor',
  event: 'Evento durable',
  settlement: 'Liquidación registrada',
  ledger: 'Asiento contable',
};

export default function PaymentSettlementsPanel() {
  const { activeOrg } = useOrg();
  const canReconcile = useHasPermission('payments', 'edit');
  const orgId = activeOrg?.id ?? '';
  const [txs, setTxs] = useState<PaymentTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceTx, setTraceTx] = useState<PaymentTx | null>(null);
  const [traceRows, setTraceRows] = useState<PaymentTraceRow[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementTx, setSettlementTx] = useState<PaymentTx | null>(null);
  const [settlementProvider, setSettlementProvider] = useState('mercadopago');
  const [providerFee, setProviderFee] = useState('');
  const [providerFeeIva, setProviderFeeIva] = useState('');
  const [providerReference, setProviderReference] = useState('');
  const [settling, setSettling] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('payment_transactions:', error);
      setLoadError('No se pudieron leer los costos de cobro. Revisá la conexión o contactá a soporte.');
    } else {
      setTxs((data ?? []) as unknown as PaymentTx[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const showTrace = useCallback(async (tx: PaymentTx) => {
    if (!tx.correlation_id) return;
    setTraceTx(tx);
    setTraceRows([]);
    setTraceError(null);
    setTraceLoading(true);
    setTraceOpen(true);

    const { data, error } = await supabase
      .from('payment_operation_trace')
      .select('record_id, stage, stage_order, status, provider, provider_reference, occurred_at')
      .eq('org_id', orgId)
      .eq('correlation_id', tx.correlation_id)
      .order('occurred_at', { ascending: true })
      .order('stage_order', { ascending: true });

    if (error) {
      const code = String(error.code ?? '');
      setTraceError(
        ['42P01', 'PGRST205'].includes(code)
          ? 'La traza todavía no está disponible en esta instalación.'
          : 'No se pudo reconstruir la operación. El error quedó visible para soporte.',
      );
      console.error('payment_operation_trace:', error);
    } else {
      setTraceRows((data ?? []) as PaymentTraceRow[]);
    }
    setTraceLoading(false);
  }, [orgId]);

  const totals = useMemo(() => {
    const approved = txs.filter(t => t.status === 'approved');
    const gross = approved.reduce((s, t) => s + Number(t.gross_amount), 0);
    const providerCost = approved.reduce(
      (s, t) => s + Number(t.provider_fee) + Number(t.provider_fee_iva), 0);
    const platformCost = approved.reduce((s, t) => s + Number(t.platform_fee), 0);
    const net = approved.reduce((s, t) => s + Number(t.net_amount), 0);
    return {
      count: approved.length,
      gross, providerCost, platformCost, net,
      costPct: gross > 0 ? round2((providerCost + platformCost) * 100 / gross) : 0,
      pendingCount: txs.filter(t => t.status === 'pending').length,
    };
  }, [txs]);

  const settlementPreview = useMemo(() => previewPosSettlement(
    Number(settlementTx?.gross_amount ?? 0),
    providerFee === '' ? 0 : Number(providerFee),
    providerFeeIva === '' ? 0 : Number(providerFeeIva),
    Number(settlementTx?.platform_fee ?? 0),
  ), [providerFee, providerFeeIva, settlementTx]);

  const openSettlement = useCallback((tx: PaymentTx) => {
    setSettlementTx(tx);
    setSettlementProvider(tx.provider === 'otro' ? 'mercadopago' : tx.provider);
    setProviderFee('');
    setProviderFeeIva('');
    setProviderReference('');
    setSettlementOpen(true);
  }, []);

  const confirmSettlement = useCallback(async () => {
    if (!settlementTx || settlementPreview.error) return;
    setSettling(true);
    const { error } = await supabase.rpc('confirm_pos_payment_settlement' as never, {
      p_payment_transaction_id: settlementTx.id,
      p_provider: settlementProvider,
      p_provider_fee: settlementPreview.providerFee,
      p_provider_fee_iva: settlementPreview.providerFeeIva,
      p_provider_reference: providerReference.trim() || null,
      p_released_at: new Date().toISOString(),
    } as never);
    setSettling(false);

    if (error) {
      console.error('confirm_pos_payment_settlement:', error);
      toast.error(error.message || 'No se pudo conciliar el cobro');
      return;
    }

    toast.success('Liquidación conciliada y asentada');
    setSettlementOpen(false);
    await load();
  }, [load, providerReference, settlementPreview, settlementProvider, settlementTx]);

  // Sin cobros digitales todavía: no vale la pena ocupar espacio en la página
  if (loading) return null;
  if (loadError) {
    return (
      <div className="rounded-[10px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }
  if (txs.length === 0) return null;

  return (
    <>
    <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <CreditCard className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Costos de cobro</p>
          <p className="text-[11px] text-muted-foreground">
            {totals.count} cobros acreditados · te quedó {fmt(totals.net)} de {fmt(totals.gross)}
            {' '}({totals.costPct}% de costo)
          </p>
        </div>
        {totals.pendingCount > 0 && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            {totals.pendingCount} pendiente{totals.pendingCount === 1 ? '' : 's'}
          </Badge>
        )}
      </button>

      {open && (
        <div className="border-t border-border/40 p-4 space-y-4">
          {/* Resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Cobrado bruto', value: totals.gross },
              { label: 'Arancel + IVA', value: -totals.providerCost },
              { label: 'Comisión plataforma', value: -totals.platformCost },
              { label: 'Neto para vos', value: totals.net, strong: true },
            ].map((k, i) => (
              <div key={i} className="rounded-[8px] bg-muted/20 border border-border/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className={`text-sm font-mono ${
                  k.strong ? 'font-semibold text-emerald-400' : k.value < 0 ? 'text-muted-foreground' : ''
                }`}>
                  {k.value < 0 ? `−${fmt(Math.abs(k.value))}` : fmt(k.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 text-[11px] text-muted-foreground bg-muted/15 border border-border/30 rounded-[6px] px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <p>
              El IVA sobre el arancel es crédito fiscal si sos responsable inscripto:
              no es costo real, se recupera. Los aranceles de cuotas se pueden trasladar
              al precio desde el Motor de Precios.
            </p>
          </div>

          {/* Detalle */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="text-left py-1.5 pr-2 font-medium">Fecha</th>
                  <th className="text-left py-1.5 pr-2 font-medium">Origen</th>
                  <th className="text-left py-1.5 pr-2 font-medium">Medio</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Bruto</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Arancel</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Plataforma</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Neto</th>
                  <th className="text-right py-1.5 font-medium">Estado</th>
                  <th className="w-10 py-1.5 font-medium"><span className="sr-only">Traza</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {txs.map(t => {
                  const st = STATUS_STYLE[t.status] || STATUS_STYLE.pending;
                  return (
                    <tr key={t.id} className={t.status === 'rejected' ? 'opacity-50' : ''}>
                      <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                        {new Date(t.created_at).toLocaleDateString('es-AR')}
                      </td>
                      <td className="py-1.5 pr-2">{SOURCE_LABEL[t.source] || t.source}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {PROVIDER_LABEL[t.provider as keyof typeof PROVIDER_LABEL] || t.provider}
                        {' · '}
                        {METHOD_LABEL[t.method as keyof typeof METHOD_LABEL] || t.method}
                        {t.installments > 1 && ` ${t.installments}x`}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{fmt(Number(t.gross_amount))}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">
                        {t.status === 'pending' ? 'Pendiente' : fmt(Number(t.provider_fee) + Number(t.provider_fee_iva))}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">
                        {Number(t.platform_fee) > 0 ? fmt(Number(t.platform_fee)) : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono font-medium">
                        {t.status === 'pending' ? '—' : fmt(Number(t.net_amount))}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        {t.status === 'pending' && t.expected_release_at && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            acredita {new Date(t.expected_release_at).toLocaleDateString('es-AR')}
                          </p>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                        {t.status === 'pending' && t.source === 'pos' && canReconcile && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => openSettlement(t)}
                          >
                            <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Conciliar
                          </Button>
                        )}
                        {t.correlation_id && (
                        <button
                          type="button"
                          onClick={() => void showTrace(t)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          aria-label="Ver traza completa del cobro"
                          title="Ver traza completa"
                        >
                          <Route className="h-3.5 w-3.5" />
                        </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>

    <Dialog open={traceOpen} onOpenChange={setTraceOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Traza del cobro</DialogTitle>
          <DialogDescription>
            La misma operación desde el checkout hasta la contabilidad, sin datos del comprador.
          </DialogDescription>
        </DialogHeader>

        {traceTx && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span>{SOURCE_LABEL[traceTx.source] || traceTx.source} · {fmt(Number(traceTx.gross_amount))}</span>
              <span className="font-mono text-[10px] text-muted-foreground" title={traceTx.correlation_id ?? undefined}>
                {traceTx.correlation_id?.slice(0, 8)}…
              </span>
            </div>
          </div>
        )}

        {traceLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reconstruyendo operación…
          </div>
        ) : traceError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {traceError}
          </div>
        ) : (
          <ol className="relative ml-2 space-y-4 border-l border-border/60 py-1 pl-5">
            {traceRows.map((row) => (
              <li key={`${row.stage}-${row.record_id}`} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-background" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{TRACE_STAGE[row.stage] || row.stage}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.status}
                      {row.provider && ` · ${PROVIDER_LABEL[row.provider as keyof typeof PROVIDER_LABEL] || row.provider}`}
                      {row.provider_reference && ` · ref. ${row.provider_reference}`}
                    </p>
                  </div>
                  <time className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(row.occurred_at).toLocaleString('es-AR')}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>

    <Dialog open={settlementOpen} onOpenChange={(open) => !settling && setSettlementOpen(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conciliar cobro del POS</DialogTitle>
          <DialogDescription>
            Copiá los importes de la liquidación del adquirente. La base calcula el neto,
            completa el margen y genera el asiento; el bruto no se puede modificar.
          </DialogDescription>
        </DialogHeader>

        {settlementTx && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Cobrado bruto</p>
                <p className="font-mono font-semibold">{fmt(Number(settlementTx.gross_amount))}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Comisión Nerqia aprobada</p>
                <p className="font-mono">{fmt(Number(settlementTx.platform_fee))}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settlement-provider">Proveedor que liquidó</Label>
              <Select value={settlementProvider} onValueChange={setSettlementProvider}>
                <SelectTrigger id="settlement-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mercadopago">MercadoPago</SelectItem>
                  <SelectItem value="modo">MODO</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                  <SelectItem value="otro">Otro adquirente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="settlement-fee">Arancel sin IVA</Label>
                <Input
                  id="settlement-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={providerFee}
                  onChange={(event) => setProviderFee(event.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settlement-fee-iva">IVA del arancel</Label>
                <Input
                  id="settlement-fee-iva"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={providerFeeIva}
                  onChange={(event) => setProviderFeeIva(event.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settlement-reference">Referencia del proveedor (opcional)</Label>
              <Input
                id="settlement-reference"
                value={providerReference}
                onChange={(event) => setProviderReference(event.target.value)}
                maxLength={250}
                placeholder="ID de liquidación o cupón"
              />
            </div>

            <div className={`rounded-md border px-3 py-2 ${
              settlementPreview.error
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-emerald-500/30 bg-emerald-500/10'
            }`}>
              {settlementPreview.error ? (
                <p className="text-sm">{settlementPreview.error}</p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Neto que entra al banco</span>
                  <span className="font-mono font-semibold text-emerald-400">{fmt(settlementPreview.net)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setSettlementOpen(false)} disabled={settling}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmSettlement()} disabled={settling || !!settlementPreview.error}>
            {settling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar y asentar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
