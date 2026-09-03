import { platformFeeFor, round2, type CommissionRule } from '@/lib/paymentFees';

/**
 * Unit economics de la plataforma, no del comercio.
 *
 * El arancel del procesador se muestra como costo para el merchant, pero no se
 * resta de la contribución de Nerqia: Mercado Pago lo descuenta de la cuenta
 * del vendedor antes de separar la comisión del marketplace. Los únicos COGS
 * de plataforma son los declarados explícitamente abajo.
 */

export interface UnitEconomicsInput {
  monthlyGmv: number;
  transactions: number;
  activeMerchants: number;

  commissionPercent: number;
  commissionFixed: number;
  commissionMin?: number | null;
  commissionMax?: number | null;
  commissionTaxTreatment: 'included' | 'added';
  commissionTaxRatePct: number;
  commissionLeakagePct: number;
  subscriptionRevenuePerMerchant: number;

  providerFeePercent: number;
  providerFeeFixed: number;
  providerFeeTaxRatePct: number;

  variableCostPerTransaction: number;
  variableCostPerMerchant: number;
  riskLossPctOfGmv: number;
  monthlyFixedCosts: number;
}

export interface UnitEconomicsResult {
  isModelUsable: boolean;
  averageTicket: number;
  gmvPerMerchant: number | null;
  transactionsPerMerchant: number | null;

  providerFeeBase: number;
  providerFeeTax: number;
  providerCostToMerchant: number;
  platformChargeToMerchant: number;
  merchantPaymentCost: number;
  merchantPaymentCostPct: number;
  merchantNetAfterPaymentCosts: number;

  commissionTax: number;
  commissionRevenueNet: number;
  subscriptionRevenueNet: number;
  platformRevenueNet: number;
  grossTakeRatePct: number;
  netTakeRatePct: number;

  transactionVariableCost: number;
  merchantVariableCost: number;
  riskLossCost: number;
  totalVariableCosts: number;
  contribution: number;
  contributionMarginPct: number | null;
  contributionPerMerchant: number | null;
  operatingResult: number;

  breakEvenGmv: number | null;
  breakEvenMerchants: number | null;
}

const finiteNonNegative = (value: number): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

const percentage = (value: number): number =>
  Math.min(100, finiteNonNegative(value));

const wholeCount = (value: number): number =>
  Math.floor(finiteNonNegative(value));

/**
 * Calcula un mes representativo. El break-even mantiene el ticket, frecuencia,
 * merchants por GMV y estructura variable del escenario; no es un forecast.
 */
export function calculateUnitEconomics(raw: UnitEconomicsInput): UnitEconomicsResult {
  const monthlyGmv = round2(finiteNonNegative(raw.monthlyGmv));
  const transactions = wholeCount(raw.transactions);
  const activeMerchants = wholeCount(raw.activeMerchants);
  const averageTicket = transactions > 0 ? round2(monthlyGmv / transactions) : 0;

  const commissionRule: CommissionRule = {
    percent: percentage(raw.commissionPercent),
    fixed: finiteNonNegative(raw.commissionFixed),
    min_per_transaction: finiteNonNegative(raw.commissionMin || 0),
    max_per_transaction: raw.commissionMax == null
      ? null
      : finiteNonNegative(raw.commissionMax),
    applies_to: 'online',
    // El monto comercial antes de decidir si el impuesto se suma se obtiene
    // con `included`; platformFeeFor aplica piso y techo por transacción.
    tax_treatment: 'included',
    tax_rate_pct: 0,
  };

  const commercialCommission = transactions > 0
    ? round2(platformFeeFor(averageTicket, commissionRule) * transactions)
    : 0;
  const commissionTaxRate = percentage(raw.commissionTaxRatePct) / 100;

  let quotedCommissionTax = 0;
  let quotedCommissionRevenueNet = commercialCommission;
  let quotedPlatformCharge = commercialCommission;
  if (raw.commissionTaxTreatment === 'included' && commissionTaxRate > 0) {
    quotedCommissionRevenueNet = round2(commercialCommission / (1 + commissionTaxRate));
    quotedCommissionTax = round2(commercialCommission - quotedCommissionRevenueNet);
  } else if (raw.commissionTaxTreatment === 'added') {
    quotedCommissionTax = round2(commercialCommission * commissionTaxRate);
    quotedPlatformCharge = round2(commercialCommission + quotedCommissionTax);
  }

  const realizationRate = 1 - percentage(raw.commissionLeakagePct) / 100;
  const commissionRevenueNet = round2(quotedCommissionRevenueNet * realizationRate);
  const commissionTax = round2(quotedCommissionTax * realizationRate);
  const platformChargeToMerchant = round2(quotedPlatformCharge * realizationRate);

  const providerFeePerTransaction = transactions > 0
    ? round2(averageTicket * percentage(raw.providerFeePercent) / 100
      + finiteNonNegative(raw.providerFeeFixed))
    : 0;
  const providerFeeBase = round2(providerFeePerTransaction * transactions);
  const providerFeeTax = round2(providerFeeBase * percentage(raw.providerFeeTaxRatePct) / 100);
  const providerCostToMerchant = round2(providerFeeBase + providerFeeTax);

  const subscriptionRevenueNet = round2(
    activeMerchants * finiteNonNegative(raw.subscriptionRevenuePerMerchant),
  );
  const platformRevenueNet = round2(commissionRevenueNet + subscriptionRevenueNet);

  const transactionVariableCost = round2(
    transactions * finiteNonNegative(raw.variableCostPerTransaction),
  );
  const merchantVariableCost = round2(
    activeMerchants * finiteNonNegative(raw.variableCostPerMerchant),
  );
  const riskLossCost = round2(monthlyGmv * percentage(raw.riskLossPctOfGmv) / 100);
  const totalVariableCosts = round2(
    transactionVariableCost + merchantVariableCost + riskLossCost,
  );
  const contribution = round2(platformRevenueNet - totalVariableCosts);
  const operatingResult = round2(contribution - finiteNonNegative(raw.monthlyFixedCosts));

  const merchantPaymentCost = round2(providerCostToMerchant + platformChargeToMerchant);
  const isModelUsable = monthlyGmv > 0 && transactions > 0 && activeMerchants > 0;
  const contributionRateOnGmv = isModelUsable ? contribution / monthlyGmv : 0;
  const breakEvenGmv = contributionRateOnGmv > 0
    ? round2(finiteNonNegative(raw.monthlyFixedCosts) / contributionRateOnGmv)
    : null;
  const gmvPerMerchant = activeMerchants > 0 ? round2(monthlyGmv / activeMerchants) : null;

  return {
    isModelUsable,
    averageTicket,
    gmvPerMerchant,
    transactionsPerMerchant: activeMerchants > 0
      ? round2(transactions / activeMerchants)
      : null,

    providerFeeBase,
    providerFeeTax,
    providerCostToMerchant,
    platformChargeToMerchant,
    merchantPaymentCost,
    merchantPaymentCostPct: monthlyGmv > 0 ? round2(merchantPaymentCost * 100 / monthlyGmv) : 0,
    merchantNetAfterPaymentCosts: round2(monthlyGmv - merchantPaymentCost),

    commissionTax,
    commissionRevenueNet,
    subscriptionRevenueNet,
    platformRevenueNet,
    grossTakeRatePct: monthlyGmv > 0
      ? round2(platformChargeToMerchant * 100 / monthlyGmv)
      : 0,
    netTakeRatePct: monthlyGmv > 0 ? round2(platformRevenueNet * 100 / monthlyGmv) : 0,

    transactionVariableCost,
    merchantVariableCost,
    riskLossCost,
    totalVariableCosts,
    contribution,
    contributionMarginPct: platformRevenueNet > 0
      ? round2(contribution * 100 / platformRevenueNet)
      : null,
    contributionPerMerchant: activeMerchants > 0
      ? round2(contribution / activeMerchants)
      : null,
    operatingResult,

    breakEvenGmv,
    breakEvenMerchants: breakEvenGmv != null && gmvPerMerchant && gmvPerMerchant > 0
      ? round2(breakEvenGmv / gmvPerMerchant)
      : null,
  };
}
