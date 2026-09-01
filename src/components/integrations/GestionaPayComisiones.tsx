/**
 * Desglose de comisiones de Gestiona Pay, visible antes y después de conectar.
 *
 * El tarifario (`payment_provider_fees`) y la regla de plataforma se leen de
 * la base. Los importes salen de `computeSettlement`: no se escribe un % a
 * mano. Si no hay tarifa o la regla no está aprobada, se dice — no se inventa.
 *
 * El comprador de la tienda no ve esto: paga el precio publicado. Acá se le
 * muestra al comercio qué se descuenta de cada cobro.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Calculator, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  METHOD_LABEL,
  computeSettlement,
  normalizarAppliesTo,
  resolveLivePlatformRule,
  type CommissionRule,
  type ProviderFee,
} from '@/lib/paymentFees';

interface TarifaFila {
  provider: string;
  method: string;
  installments: number;
  percent_fee: number;
  fixed_fee: number;
  iva_on_fee_pct: number;
  release_days: number;
  currency: string;
  effective_from: string;
  verificada_el: string | null;
}

interface ReglaFila {
  id: string;
  percent: number;
  fixed: number;
  min_per_transaction: number;
  max_per_transaction: number | null;
  tax_rate_pct: number;
  tax_treatment: string | null;
  is_active: boolean;
  approval_status: string;
  applies_to: string;
  org_id: string | null;
  plan_id: string | null;
  notes: string | null;
  effective_from: string | null;
  effective_until: string | null;
}

const FEES_SELECT =
  'provider, method, installments, percent_fee, fixed_fee, iva_on_fee_pct, release_days, currency, effective_from, verificada_el';
const RULES_SELECT =
  'id, percent, fixed, min_per_transaction, max_per_transaction, tax_rate_pct, tax_treatment, is_active, approval_status, applies_to, org_id, plan_id, notes, effective_from, effective_until';

const pct = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;
const ars = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

function medioLabel(method: string, installments: number) {
  const base = METHOD_LABEL[method as keyof typeof METHOD_LABEL] ?? method;
  if (installments > 1) return `${base} · ${installments} cuotas`;
  if (installments === 1) return `${base} · 1 pago`;
  return base;
}

export default function GestionaPayComisiones({
  orgId,
  planId,
}: {
  orgId?: string;
  planId?: string | null;
}) {
  const [tarifas, setTarifas] = useState<TarifaFila[]>([]);
  const [reglas, setReglas] = useState<ReglaFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monto, setMonto] = useState('10000');

  const cargar = useCallback(async () => {
    setCargando(true);
    const [feesRes, rulesRes] = await Promise.all([
      supabase
        .from('payment_provider_fees')
        .select(FEES_SELECT)
        .in('provider', ['mercadopago', 'efectivo', 'transferencia'])
        .order('provider')
        .order('method')
        .order('installments'),
      supabase.from('platform_commission_rules').select(RULES_SELECT),
    ]);

    if (feesRes.error) {
      console.error('GestionaPayComisiones tarifas:', feesRes.error);
      setError(feesRes.error.message);
      setCargando(false);
      return;
    }
    if (rulesRes.error) {
      console.error('GestionaPayComisiones reglas:', rulesRes.error);
      setError(rulesRes.error.message);
      setCargando(false);
      return;
    }

    setTarifas((feesRes.data ?? []) as TarifaFila[]);
    setReglas((rulesRes.data ?? []) as ReglaFila[]);
    setError(null);
    setCargando(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const bruto = useMemo(() => {
    const n = Number(String(monto).replace(/[^0-9.,]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [monto]);

  const platformRule = useMemo((): CommissionRule | null => {
    const mapped: CommissionRule[] = reglas.map(r => ({
      id: r.id,
      percent: r.percent,
      fixed: r.fixed,
      min_per_transaction: r.min_per_transaction,
      max_per_transaction: r.max_per_transaction,
      tax_rate_pct: r.tax_rate_pct,
      tax_treatment: r.tax_treatment === 'added' || r.tax_treatment === 'included'
        ? r.tax_treatment
        : null,
      is_active: r.is_active,
      approval_status: r.approval_status,
      applies_to: normalizarAppliesTo(r.applies_to),
      org_id: r.org_id,
      plan_id: r.plan_id,
      effective_from: r.effective_from,
      effective_until: r.effective_until,
      notes: r.notes,
    }));
    return resolveLivePlatformRule(mapped, {
      orgId: orgId ?? null,
      planId: planId ?? null,
      channel: 'online',
    });
  }, [reglas, orgId, planId]);

  const filas = useMemo(() => {
    if (bruto <= 0) return [];
    return tarifas.map(t => {
      const fee: ProviderFee = {
        provider: t.provider,
        method: t.method,
        installments: t.installments,
        percent_fee: t.percent_fee,
        fixed_fee: t.fixed_fee,
        iva_on_fee_pct: t.iva_on_fee_pct,
        release_days: t.release_days,
        currency: t.currency,
        effective_from: t.effective_from,
      };
      const s = computeSettlement({
        gross: bruto,
        providerFee: fee,
        platformRule,
      });
      return { tarifa: t, settlement: s };
    }).sort((a, b) => a.settlement.effectiveCostPct - b.settlement.effectiveCostPct);
  }, [tarifas, bruto, platformRule]);

  const ejemploPay = filas.find(f => f.tarifa.provider === 'mercadopago' && f.tarifa.method === 'credit')
    ?? filas.find(f => f.tarifa.provider === 'mercadopago')
    ?? filas[0];

  if (cargando) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo comisiones…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs">
        <p className="font-medium text-destructive">No se pudieron leer las comisiones</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }

  const sinVerificar = tarifas.some(t => !t.verificada_el);
  const comisionGestiona = platformRule
    ? platformRule.percent
    : 0;

  return (
    <div className="space-y-3 border-t border-border/50 pt-4">
      <div>
        <h3 className="text-sm font-semibold">Comisiones, explícitas</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          El comprador paga el precio de la tienda. Lo de abajo se descuenta de
          lo que te acreditan: arancel de Mercado Pago, IVA sobre ese arancel y
          comisión de Gestiona si hay una regla aprobada vigente.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
        <p>
          <span className="font-medium text-foreground">Comisión de Gestiona: </span>
          {platformRule
            ? (
              <>
                {pct(comisionGestiona)}
                {platformRule.fixed > 0 && <> + {ars(platformRule.fixed)} fijo</>}
                {platformRule.tax_treatment === 'added' && platformRule.tax_rate_pct
                  ? <> + IVA {pct(platformRule.tax_rate_pct)} sobre la comisión</>
                  : null}
              </>
            )
            : (
              <>0% — no hay regla aprobada y vigente. No se cobra comisión de plataforma.</>
            )}
        </p>
        {platformRule?.notes && (
          <p className="text-muted-foreground">{platformRule.notes}</p>
        )}
        <p className="text-muted-foreground">
          Efectivo y transferencia no pasan por Gestiona Pay: no tienen arancel
          de Mercado Pago. Siguen en la tabla para comparar.
        </p>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
        <label className="text-xs font-medium flex items-center gap-1.5 mb-2">
          <Calculator className="w-3.5 h-3.5 text-primary" />
          Ejemplo: si cobrás
        </label>
        <Input
          value={monto}
          onChange={e => setMonto(e.target.value)}
          inputMode="decimal"
          className="bg-muted border-border max-w-[200px] h-9"
          placeholder="10000"
        />
        {bruto > 0 && ejemploPay && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sobre {ars(bruto)} con {medioLabel(ejemploPay.tarifa.method, ejemploPay.tarifa.installments)}:{' '}
            te quedan <strong className="text-foreground">{ars(ejemploPay.settlement.net)}</strong>
            {' '}después de {ars(ejemploPay.settlement.providerFee)} de arancel,{' '}
            {ars(ejemploPay.settlement.providerFeeIva)} de IVA y{' '}
            {ars(ejemploPay.settlement.platformFee)} de Gestiona.
          </p>
        )}
      </div>

      {sinVerificar && tarifas.length > 0 && (
        <div className="flex items-start gap-2 rounded-[8px] border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-300">
            El arancel de Mercado Pago es una <strong>estimación</strong> del tarifario
            cargado: no está verificado contra la página oficial del proveedor.
            Lo que se cobró de verdad en cada venta está en Ajustes → Finanzas.
          </p>
        </div>
      )}

      {!tarifas.length ? (
        <p className="text-xs text-muted-foreground">
          No hay tarifario cargado. No se muestra un porcentaje inventado.
        </p>
      ) : bruto <= 0 ? (
        <p className="text-xs text-muted-foreground">Ingresá un monto para ver el desglose.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Medio</th>
                <th className="pb-2 px-3 text-right font-medium">Arancel</th>
                <th className="pb-2 px-3 text-right font-medium">IVA</th>
                <th className="pb-2 px-3 text-right font-medium">Gestiona</th>
                <th className="pb-2 px-3 text-right font-medium">Total</th>
                <th className="pb-2 pl-3 text-right font-medium">Te queda</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ tarifa: t, settlement: s }) => (
                <tr key={`${t.provider}-${t.method}-${t.installments}-${t.effective_from}`} className="border-b border-border/40 last:border-0">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{medioLabel(t.method, t.installments)}</span>
                    {t.provider !== 'mercadopago' && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">{t.provider}</Badge>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {pct(t.percent_fee)}
                      {t.fixed_fee > 0 && <> + {ars(t.fixed_fee)}</>}
                      {s.releaseDays != null && s.releaseDays > 0 && (
                        <>
                          {' · '}
                          <Clock className="inline h-3 w-3" /> {s.releaseDays} día
                          {s.releaseDays === 1 ? '' : 's'}
                        </>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{ars(s.providerFee)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{ars(s.providerFeeIva)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {s.platformFee > 0 ? ars(s.platformFee) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                    {ars(s.providerFee + s.providerFeeIva + s.platformFee)}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {pct(s.effectiveCostPct)}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                    {ars(s.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        El mismo desglose, con lo cobrado de verdad por cobro, está en{' '}
        <Link to="/ajustes" className="underline underline-offset-2 hover:text-foreground">
          Ajustes → Finanzas
        </Link>
        .
      </p>
    </div>
  );
}
