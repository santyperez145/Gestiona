import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { CreditCard, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PROVIDER_LABEL, METHOD_LABEL, round2 } from '@/lib/paymentFees';

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
  created_at: string;
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

export default function PaymentSettlementsPanel() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? '';
  const [txs, setTxs] = useState<PaymentTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    setTxs((data || []) as unknown as PaymentTx[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

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

  // Sin cobros digitales todavía: no vale la pena ocupar espacio en la página
  if (loading || txs.length === 0) return null;

  return (
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
                        {fmt(Number(t.provider_fee) + Number(t.provider_fee_iva))}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">
                        {Number(t.platform_fee) > 0 ? fmt(Number(t.platform_fee)) : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono font-medium">{fmt(Number(t.net_amount))}</td>
                      <td className="py-1.5 text-right">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        {t.status === 'pending' && t.expected_release_at && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            acredita {new Date(t.expected_release_at).toLocaleDateString('es-AR')}
                          </p>
                        )}
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
  );
}
