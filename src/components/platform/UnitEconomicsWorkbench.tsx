import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Building2, Calculator, ExternalLink,
  Landmark, ReceiptText, RotateCcw, Store,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  calculateUnitEconomics,
  type UnitEconomicsInput,
} from '@/lib/unitEconomics';
import type { CommissionRule, ProviderFee } from '@/lib/paymentFees';

interface UnitEconomicsWorkbenchProps {
  actualGmv: number;
  actualTransactions: number;
  actualMerchants: number;
  actualPeriodLabel?: string | null;
  proposedRule?: CommissionRule | null;
  providerFee?: ProviderFee | null;
}

const money = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(value);

const decimal = (value: number | null, digits = 2) =>
  value == null ? '—' : value.toLocaleString('es-AR', { maximumFractionDigits: digits });

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
}

function NumberField({ label, value, onChange, step = 1, suffix }: NumberFieldProps) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          min="0"
          step={step}
          className="h-8 text-xs pr-9"
          value={value}
          onChange={event => onChange(Number(event.target.value))}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, detail, tone = 'default' }: {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div className="rounded-[9px] border border-border/60 bg-card px-3 py-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold font-mono ${
        tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-red-400' : ''
      }`}>
        {value}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function UnitEconomicsWorkbench({
  actualGmv,
  actualTransactions,
  actualMerchants,
  actualPeriodLabel,
  proposedRule,
  providerFee,
}: UnitEconomicsWorkbenchProps) {
  const initialInput = (): UnitEconomicsInput => ({
    monthlyGmv: Number(actualGmv || 0),
    transactions: Number(actualTransactions || 0),
    activeMerchants: Number(actualMerchants || 0),
    commissionPercent: Number(proposedRule?.percent || 0),
    commissionFixed: Number(proposedRule?.fixed || 0),
    commissionMin: Number(proposedRule?.min_per_transaction || 0),
    commissionMax: proposedRule?.max_per_transaction ?? null,
    commissionTaxTreatment: proposedRule?.tax_treatment || 'included',
    commissionTaxRatePct: Number(proposedRule?.tax_rate_pct ?? 21),
    commissionLeakagePct: 0,
    subscriptionRevenuePerMerchant: 0,
    providerFeePercent: Number(providerFee?.percent_fee || 0),
    providerFeeFixed: Number(providerFee?.fixed_fee || 0),
    providerFeeTaxRatePct: Number(providerFee?.iva_on_fee_pct || 0),
    variableCostPerTransaction: 0,
    variableCostPerMerchant: 0,
    riskLossPctOfGmv: 0,
    monthlyFixedCosts: 0,
  });

  const [input, setInput] = useState<UnitEconomicsInput>(initialInput);
  const result = useMemo(() => calculateUnitEconomics(input), [input]);
  const hasCostAssumptions = input.variableCostPerTransaction > 0
    || input.variableCostPerMerchant > 0
    || input.riskLossPctOfGmv > 0
    || input.monthlyFixedCosts > 0;

  const setNumber = (field: keyof UnitEconomicsInput) => (value: number) =>
    setInput(previous => ({ ...previous, [field]: value }));

  const resultTone = result.operatingResult > 0
    ? 'positive' as const
    : result.operatingResult < 0 ? 'negative' as const : 'default' as const;

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-violet-500/25 bg-violet-500/5 px-4 py-3 flex gap-3">
        <Calculator className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">Workbench de unit economics</p>
            <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">
              simulación · no activa pricing
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Parte del último mes medido y de la propuesta visible. Cambiar estos campos no escribe la base.
            El break-even conserva el ticket, la frecuencia y el mix del escenario; no es un forecast.
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => setInput(initialInput())}>
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Base real
        </Button>
      </div>

      {(!result.isModelUsable || !hasCostAssumptions) && (
        <div className="rounded-[8px] border border-amber-500/25 bg-amber-500/5 px-3 py-2 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {!result.isModelUsable
              ? 'La base actual no tiene volumen suficiente para inferir unit economics. Cargá un escenario comparable.'
              : 'Los costos de servir están en cero. Los ingresos se calculan, pero contribución y break-even no son defendibles hasta cargar soporte, infraestructura, operación y riesgo.'}
          </p>
        </div>
      )}

      <div className="grid xl:grid-cols-4 gap-3">
        <section className="rounded-[10px] border border-border/60 bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold">Volumen mensual</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {actualPeriodLabel ? `Base observada: ${actualPeriodLabel}.` : 'Sin período observado.'}
          </p>
          <NumberField label="GMV procesado" value={input.monthlyGmv} onChange={setNumber('monthlyGmv')} />
          <NumberField label="Transacciones" value={input.transactions} onChange={setNumber('transactions')} />
          <NumberField label="Merchants activos" value={input.activeMerchants} onChange={setNumber('activeMerchants')} />
        </section>

        <section className="rounded-[10px] border border-border/60 bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold">Monetización</h3>
          </div>
          <NumberField label="Comisión" value={input.commissionPercent} onChange={setNumber('commissionPercent')} step={0.05} suffix="%" />
          <NumberField label="Fijo por transacción" value={input.commissionFixed} onChange={setNumber('commissionFixed')} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Piso / transacción" value={Number(input.commissionMin || 0)} onChange={setNumber('commissionMin')} />
            <NumberField label="Tope (0 = sin)" value={Number(input.commissionMax || 0)}
              onChange={value => setInput(previous => ({ ...previous, commissionMax: value > 0 ? value : null }))} />
          </div>
          <NumberField label="Suscripción neta / merchant" value={input.subscriptionRevenuePerMerchant} onChange={setNumber('subscriptionRevenuePerMerchant')} />
          <NumberField label="Leakage / créditos / refunds" value={input.commissionLeakagePct} onChange={setNumber('commissionLeakagePct')} step={0.1} suffix="%" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Impuesto comisión</Label>
              <Select
                value={input.commissionTaxTreatment}
                onValueChange={value => setInput(previous => ({
                  ...previous,
                  commissionTaxTreatment: value as 'included' | 'added',
                }))}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="included">Incluido</SelectItem>
                  <SelectItem value="added">Adicionado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumberField label="Tasa fiscal" value={input.commissionTaxRatePct} onChange={setNumber('commissionTaxRatePct')} step={0.5} suffix="%" />
          </div>
        </section>

        <section className="rounded-[10px] border border-border/60 bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-semibold">Costo del merchant</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">Arancel estimado del procesador; no es COGS de Nerqia.</p>
          <NumberField label="Arancel proveedor" value={input.providerFeePercent} onChange={setNumber('providerFeePercent')} step={0.01} suffix="%" />
          <NumberField label="Fijo proveedor / transacción" value={input.providerFeeFixed} onChange={setNumber('providerFeeFixed')} />
          <NumberField label="Impuesto sobre arancel" value={input.providerFeeTaxRatePct} onChange={setNumber('providerFeeTaxRatePct')} step={0.5} suffix="%" />
          <div className="rounded-[7px] bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            Ticket promedio <span className="text-foreground font-mono">{money(result.averageTicket)}</span>
            <br />Costo efectivo de cobro <span className="text-foreground font-mono">{decimal(result.merchantPaymentCostPct)}%</span>
          </div>
        </section>

        <section className="rounded-[10px] border border-border/60 bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold">Costo de servir Nerqia</h3>
          </div>
          <NumberField label="Variable / transacción" value={input.variableCostPerTransaction} onChange={setNumber('variableCostPerTransaction')} />
          <NumberField label="Variable / merchant" value={input.variableCostPerMerchant} onChange={setNumber('variableCostPerMerchant')} />
          <NumberField label="Pérdida por riesgo sobre GMV" value={input.riskLossPctOfGmv} onChange={setNumber('riskLossPctOfGmv')} step={0.01} suffix="%" />
          <NumberField label="Costos fijos mensuales" value={input.monthlyFixedCosts} onChange={setNumber('monthlyFixedCosts')} />
        </section>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Net take rate" value={`${decimal(result.netTakeRatePct)}%`} detail="ingreso neto / GMV" />
        <Metric
          label="Contribución"
          value={money(result.contribution)}
          detail="ingreso neto − costos variables"
          tone={result.contribution > 0 ? 'positive' : result.contribution < 0 ? 'negative' : 'default'}
        />
        <Metric
          label="Contribution margin"
          value={result.contributionMarginPct == null ? '—' : `${decimal(result.contributionMarginPct)}%`}
          detail="contribución / ingreso neto"
          tone={result.contribution > 0 ? 'positive' : result.contribution < 0 ? 'negative' : 'default'}
        />
        <Metric label="Resultado operativo" value={money(result.operatingResult)} detail="contribución − costos fijos" tone={resultTone} />
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <section className="rounded-[10px] border border-border/60 bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
            <Store className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-semibold">Economía del merchant</h3>
          </div>
          <div className="divide-y divide-border/30 text-xs">
            {[
              ['GMV cobrado', result.isModelUsable ? input.monthlyGmv : 0],
              ['Arancel + impuesto del proveedor', -result.providerCostToMerchant],
              ['Cargo realizado de Nerqia', -result.platformChargeToMerchant],
              ['Neto tras costos de cobro', result.merchantNetAfterPaymentCosts],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono">{money(Number(value))}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-border/60 bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold">Economía de Nerqia</h3>
          </div>
          <div className="divide-y divide-border/30 text-xs">
            {[
              ['Comisión neta de impuesto', result.commissionRevenueNet],
              ['Suscripción neta', result.subscriptionRevenueNet],
              ['Costos variables', -result.totalVariableCosts],
              ['Contribución', result.contribution],
              ['Costos fijos', -input.monthlyFixedCosts],
              ['Resultado operativo', result.operatingResult],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono">{money(Number(value))}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-border/60 bg-card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-violet-400" />
            <h3 className="text-xs font-semibold">Break-even al mix actual</h3>
          </div>
          {result.breakEvenGmv == null ? (
            <p className="text-xs text-muted-foreground">
              No existe con estos supuestos: la contribución antes de costos fijos es cero o negativa.
              Subir volumen manteniendo el mismo mix agranda la pérdida.
            </p>
          ) : (
            <div>
              <p className="text-2xl font-semibold font-mono">{money(result.breakEvenGmv)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ≈ {Math.ceil(result.breakEvenMerchants || 0)} merchants con {money(result.gmvPerMerchant || 0)} de GMV por merchant.
              </p>
            </div>
          )}
          <div className="rounded-[7px] bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
            No extrapola retención, CAC, crecimiento ni cambios de mix. Sirve para decidir qué hipótesis falta medir.
          </div>
        </section>
      </div>

      <section className="rounded-[10px] border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-semibold">Benchmark de costo transaccional — no de producto completo</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-4 text-xs text-muted-foreground">
          <p>
            <span className="text-foreground font-medium">Tiendanube, fuente oficial al 25/03/2026:</span>{' '}
            0% de costo por transacción con Pago Nube; con proveedor externo publica 2% en Esencial,
            1% en Impulso y 0,7% en Escala, más el arancel del proveedor. Evolución es negociable.
            {' '}<a className="text-primary hover:underline inline-flex items-center gap-1" target="_blank" rel="noreferrer"
              href="https://ayuda.tiendanube.com/es_AR/123484-costos-por-transaccion/que-son-los-costos-por-transaccion-de-tiendanube">
              Ver fuente <ExternalLink className="w-3 h-3" />
            </a>
          </p>
          <p>
            <span className="text-foreground font-medium">Mercado Pago, mecánica oficial:</span>{' '}
            el procesador descuenta primero su costo al vendedor y luego separa la comisión del marketplace.
            Por eso ese arancel afecta el neto del merchant, no la contribución de Nerqia.
            {' '}<a className="text-primary hover:underline inline-flex items-center gap-1" target="_blank" rel="noreferrer"
              href="https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/how-tos/integrate-marketplace">
              Ver fuente <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
