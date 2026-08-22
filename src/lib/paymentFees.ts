/**
 * Comisiones de cobro — lógica pura, sin red ni base de datos.
 *
 * Cuando una tienda cobra $10.000 no le entran $10.000. Este módulo parte ese
 * número en: arancel del procesador, IVA sobre ese arancel, comisión de la
 * plataforma y neto para la tienda.
 *
 * Lo usan el checkout (para mostrarle al comercio cuánto le queda), el webhook
 * de MercadoPago (para registrar el cobro) y el panel de revenue de plataforma.
 * Los tres tienen que dar exactamente el mismo número, así que vive acá y está
 * testeado.
 */

export type ProviderCode = 'mercadopago' | 'stripe' | 'modo' | 'transferencia' | 'efectivo' | 'otro';
export type MethodCode = 'default' | 'credit' | 'debit' | 'cash' | 'transfer' | 'wallet';
export type Channel = 'online' | 'pos';

export const PROVIDER_LABEL: Record<ProviderCode, string> = {
  mercadopago: 'MercadoPago',
  stripe: 'Stripe',
  modo: 'MODO',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

export const METHOD_LABEL: Record<MethodCode, string> = {
  default: 'Cualquier medio',
  credit: 'Tarjeta de crédito',
  debit: 'Tarjeta de débito',
  cash: 'Efectivo',
  transfer: 'Transferencia',
  wallet: 'Dinero en cuenta',
};

export interface ProviderFee {
  provider: ProviderCode | string;
  method: MethodCode | string;
  installments: number;
  percent_fee: number;
  fixed_fee: number;
  iva_on_fee_pct?: number;
  release_days?: number;
  currency?: string;
  effective_from?: string;
}

export interface CommissionRule {
  id?: string;
  /** null = cualquier plan */
  plan_id?: string | null;
  /** null = cualquier org del plan; con valor es un acuerdo puntual */
  org_id?: string | null;
  percent: number;
  fixed: number;
  max_per_transaction?: number | null;
  min_per_transaction?: number;
  applies_to: 'online' | 'pos' | 'all';
  is_active?: boolean;
  /** included = el impuesto ya está dentro de la comisión; added = se suma. */
  tax_treatment?: 'included' | 'added' | null;
  tax_rate_pct?: number | null;
}

export interface Settlement {
  /** Lo que pagó el comprador */
  gross: number;
  /** Arancel del procesador, sin IVA */
  providerFee: number;
  /** IVA sobre el arancel (crédito fiscal para un responsable inscripto) */
  providerFeeIva: number;
  /** Comisión de la plataforma */
  platformFee: number;
  /** Lo que le queda a la tienda */
  net: number;
  /** Costo total de cobrar, como % del bruto */
  effectiveCostPct: number;
  /** Cuándo se acredita, si el procesador lo declara */
  releaseDays: number | null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Resolución de arancel ───────────────────────────────────────────────────

/**
 * Busca el arancel aplicable, de más específico a más general:
 *   1. provider + method + installments exactos
 *   2. provider + method, contado (installments = 0)
 *   3. provider + method 'default'
 *
 * Con varias filas vigentes para la misma combinación gana la de
 * `effective_from` más reciente que no sea futura — así se puede cargar un
 * cambio de arancel con fecha antes de que entre en vigencia.
 */
export function resolveProviderFee(
  schedule: ProviderFee[],
  query: { provider: string; method?: string; installments?: number; currency?: string; asOf?: Date },
): ProviderFee | null {
  const method = query.method || 'default';
  const installments = query.installments ?? 0;
  const currency = query.currency || 'ARS';
  const asOf = query.asOf ?? null;

  const inForce = schedule.filter(f => {
    if (f.provider !== query.provider) return false;
    if ((f.currency || 'ARS') !== currency) return false;
    if (asOf && f.effective_from && new Date(f.effective_from) > asOf) return false;
    return true;
  });
  if (inForce.length === 0) return null;

  const newest = (rows: ProviderFee[]) =>
    rows.slice().sort((a, b) =>
      (b.effective_from || '').localeCompare(a.effective_from || ''))[0];

  const exact = inForce.filter(f => f.method === method && f.installments === installments);
  if (exact.length) return newest(exact);

  const sameMethodCash = inForce.filter(f => f.method === method && f.installments === 0);
  if (sameMethodCash.length) return newest(sameMethodCash);

  const fallback = inForce.filter(f => f.method === 'default');
  if (fallback.length) return newest(fallback);

  return null;
}

// ── Resolución de comisión de plataforma ────────────────────────────────────

/**
 * Regla de comisión aplicable. Gana la más específica:
 *   org_id + plan_id  >  org_id  >  plan_id  >  default (ambos null)
 *
 * Una regla `applies_to: 'all'` sirve para cualquier canal, pero si hay una
 * regla del canal exacto con la misma especificidad, gana la específica.
 */
export function resolvePlatformRule(
  rules: CommissionRule[],
  query: { orgId?: string | null; planId?: string | null; channel: Channel },
): CommissionRule | null {
  const candidates = rules.filter(r => {
    if (r.is_active === false) return false;
    if (r.applies_to !== 'all' && r.applies_to !== query.channel) return false;
    if (r.org_id && r.org_id !== query.orgId) return false;
    if (r.plan_id && r.plan_id !== query.planId) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const score = (r: CommissionRule) =>
    (r.org_id ? 4 : 0) + (r.plan_id ? 2 : 0) + (r.applies_to !== 'all' ? 1 : 0);

  return candidates.reduce((best, r) => (score(r) > score(best) ? r : best), candidates[0]);
}

/**
 * Comisión de plataforma para un bruto dado, respetando piso y techo.
 *
 * Piso y techo pertenecen a la tarifa comercial antes de impuestos. Cuando el
 * tratamiento aprobado es `added`, el impuesto se suma después. Esta función
 * es espejo de `public.platform_commission_amount` en la base.
 */
export function platformFeeFor(gross: number, rule: CommissionRule | null): number {
  if (!rule || gross <= 0) return 0;
  let fee = gross * (rule.percent || 0) / 100 + (rule.fixed || 0);
  if (rule.max_per_transaction != null) fee = Math.min(fee, rule.max_per_transaction);
  // El piso se aplica después del techo a propósito: si alguien configura
  // min > max, el piso manda — cobrar menos del mínimo no tiene sentido.
  if (rule.min_per_transaction) fee = Math.max(fee, rule.min_per_transaction);
  if (rule.tax_treatment === 'added') {
    fee *= 1 + Math.max(0, rule.tax_rate_pct || 0) / 100;
  }
  return round2(Math.min(fee, gross));
}

// ── Liquidación ─────────────────────────────────────────────────────────────

export interface SettlementInput {
  gross: number;
  providerFee?: ProviderFee | null;
  platformRule?: CommissionRule | null;
  /**
   * Arancel real informado por el procesador, cuando lo sabemos (el webhook de
   * MercadoPago manda `fee_details`). Si viene, se usa este número en vez del
   * tarifario: es el que efectivamente cobraron.
   */
  actualProviderFee?: number | null;
}

/**
 * Parte un cobro en sus componentes. Nunca devuelve un neto negativo: si los
 * costos superan el bruto, el neto queda en 0 — un neto negativo sería un dato
 * inventado que después descuadra la contabilidad.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const gross = round2(Math.max(0, input.gross));
  const fee = input.providerFee || null;

  const providerFee = input.actualProviderFee != null
    ? round2(Math.max(0, input.actualProviderFee))
    : fee
      ? round2(gross * (fee.percent_fee || 0) / 100 + (fee.fixed_fee || 0))
      : 0;

  const ivaPct = fee?.iva_on_fee_pct ?? 0;
  const providerFeeIva = round2(providerFee * ivaPct / 100);
  const platformFee = platformFeeFor(gross, input.platformRule || null);

  const totalCost = providerFee + providerFeeIva + platformFee;
  const net = round2(Math.max(0, gross - totalCost));

  return {
    gross,
    providerFee,
    providerFeeIva,
    platformFee,
    net,
    effectiveCostPct: gross > 0 ? round2(totalCost * 100 / gross) : 0,
    releaseDays: fee?.release_days ?? null,
  };
}

/**
 * Cuánto hay que cobrar para que a la tienda le queden `desiredNet`.
 *
 * Sirve para el clásico "quiero recibir $50.000 limpios": se despeja el bruto
 * de la ecuación de arriba. Con comisiones porcentuales que sumen 100% o más el
 * problema no tiene solución y devuelve null en vez de un número absurdo.
 */
export function grossUpForNet(
  desiredNet: number,
  fee: ProviderFee | null,
  rule: CommissionRule | null,
): number | null {
  if (desiredNet <= 0) return 0;

  const ivaMult = 1 + (fee?.iva_on_fee_pct ?? 0) / 100;
  const providerPct = (fee?.percent_fee || 0) / 100 * ivaMult;
  const providerFixed = (fee?.fixed_fee || 0) * ivaMult;
  const ruleTaxMult = rule?.tax_treatment === 'added'
    ? 1 + Math.max(0, rule.tax_rate_pct || 0) / 100
    : 1;
  const rulePct = (rule?.percent || 0) / 100 * ruleTaxMult;
  const ruleFixed = (rule?.fixed || 0) * ruleTaxMult;

  const totalPct = providerPct + rulePct;
  if (totalPct >= 1) return null;

  const gross = (desiredNet + providerFixed + ruleFixed) / (1 - totalPct);

  // Con tope por transacción el despeje lineal se pasa de largo: se verifica y
  // se corrige usando el cálculo real.
  if (rule?.max_per_transaction != null || rule?.min_per_transaction) {
    const check = computeSettlement({ gross, providerFee: fee, platformRule: rule });
    const diff = desiredNet - check.net;
    if (Math.abs(diff) > 0.01) {
      const corrected = gross + diff / (1 - providerPct);
      return round2(Math.max(0, corrected));
    }
  }

  return round2(gross);
}

/**
 * Recargo por cuotas a trasladar al comprador. Devuelve el precio final y el
 * valor de cada cuota, que es lo que el comprador realmente mira.
 */
export function installmentPricing(
  amount: number,
  fee: ProviderFee | null,
  installments: number,
): { total: number; perInstallment: number; surcharge: number; surchargePct: number } {
  const n = Math.max(1, installments || 1);
  const pct = fee?.percent_fee || 0;
  const total = round2(amount * (1 + pct / 100) + (fee?.fixed_fee || 0));
  const surcharge = round2(total - amount);
  return {
    total,
    perInstallment: round2(total / n),
    surcharge,
    surchargePct: amount > 0 ? round2(surcharge * 100 / amount) : 0,
  };
}
