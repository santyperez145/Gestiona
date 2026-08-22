// La base resuelve procedencia, asignaciones y cobertura. Este módulo sólo
// agrupa los hechos canónicos para presentarlos; null significa "no medido".

export interface CanonicalMarginFact {
  sale_id: string | null;
  product_id: string | null;
  product_name: string | null;
  channel: string | null;
  quantity: number | null;
  revenue_ars: number | null;
  cogs_ars: number | null;
  payment_fee_ars: number | null;
  shipping_cost_ars: number | null;
  tax_ars: number | null;
  contribution_margin_ars: number | null;
  coverage_pct: number | null;
  is_explainable: boolean | null;
  missing_components: string[] | null;
  margin_blockers: string[] | null;
}

export interface ChannelMarginSummary {
  productId: string;
  productName: string;
  channel: string;
  lines: number;
  units: number;
  revenueARS: number;
  cogsARS: number | null;
  paymentFeeARS: number | null;
  shippingCostARS: number | null;
  taxARS: number | null;
  contributionMarginARS: number | null;
  coveragePct: number;
  pending: string[];
}

export interface MarginCoverageSummary {
  lines: number;
  explainableLines: number;
  revenueARS: number;
  explainableRevenueARS: number;
  explainableRevenuePct: number;
  averageCoveragePct: number;
  cogsKnownLines: number;
  paymentFeeKnownLines: number;
  shippingKnownLines: number;
  taxKnownLines: number;
}

const MISSING_LABELS: Record<string, string> = {
  costo_mercaderia: "costo de mercadería",
  comision_cobro: "comisión de cobro",
  costo_envio_real: "costo real de envío",
  iva: "IVA",
  devolucion_neta: "neteo de devolución",
};

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const roundOne = (amount: number) => Math.round((amount + Number.EPSILON) * 10) / 10;

function sumIfAllKnown(
  lines: CanonicalMarginFact[],
  field: keyof Pick<CanonicalMarginFact, "cogs_ars" | "payment_fee_ars" | "shipping_cost_ars" | "tax_ars" | "contribution_margin_ars">,
) {
  if (lines.some(line => line[field] === null || line[field] === undefined)) return null;
  return roundMoney(lines.reduce((sum, line) => sum + Number(line[field]), 0));
}

/** Agrupa sin recalcular la autoridad financiera que ya resolvió SQL. */
export function summarizeChannelMargins(facts: CanonicalMarginFact[]): ChannelMarginSummary[] {
  const groups = new Map<string, CanonicalMarginFact[]>();
  for (const fact of facts) {
    const productId = fact.product_id || `line:${fact.sale_id || "unknown"}`;
    const channel = fact.channel || "sin_atribuir";
    const key = `${productId}::${channel}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }

  return [...groups.values()].map(group => {
    const first = group[0];
    const revenueARS = roundMoney(group.reduce((sum, line) => sum + Number(line.revenue_ars || 0), 0));
    const pendingCodes = [...new Set(group.flatMap(line => [
      ...(line.missing_components ?? []),
      ...(line.margin_blockers ?? []),
    ]))];

    return {
      productId: first.product_id || `line:${first.sale_id || "unknown"}`,
      productName: first.product_name || "Producto sin nombre",
      channel: first.channel || "sin_atribuir",
      lines: group.length,
      units: group.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      revenueARS,
      cogsARS: sumIfAllKnown(group, "cogs_ars"),
      paymentFeeARS: sumIfAllKnown(group, "payment_fee_ars"),
      shippingCostARS: sumIfAllKnown(group, "shipping_cost_ars"),
      taxARS: sumIfAllKnown(group, "tax_ars"),
      contributionMarginARS: sumIfAllKnown(group, "contribution_margin_ars"),
      coveragePct: roundOne(group.reduce((sum, line) => sum + Number(line.coverage_pct || 0), 0) / group.length),
      pending: pendingCodes.map(code => MISSING_LABELS[code] || code),
    };
  }).sort((a, b) => b.revenueARS - a.revenueARS || a.productName.localeCompare(b.productName));
}

/** Cobertura de la selección actual. El porcentaje principal pondera ingresos. */
export function summarizeMarginCoverage(facts: CanonicalMarginFact[]): MarginCoverageSummary {
  const revenueARS = roundMoney(facts.reduce((sum, fact) => sum + Number(fact.revenue_ars || 0), 0));
  const explainable = facts.filter(fact => fact.is_explainable === true);
  const explainableRevenueARS = roundMoney(explainable.reduce((sum, fact) => sum + Number(fact.revenue_ars || 0), 0));

  return {
    lines: facts.length,
    explainableLines: explainable.length,
    revenueARS,
    explainableRevenueARS,
    explainableRevenuePct: revenueARS > 0 ? roundOne(explainableRevenueARS * 100 / revenueARS) : 0,
    averageCoveragePct: facts.length > 0
      ? roundOne(facts.reduce((sum, fact) => sum + Number(fact.coverage_pct || 0), 0) / facts.length)
      : 0,
    cogsKnownLines: facts.filter(fact => fact.cogs_ars !== null && fact.cogs_ars !== undefined).length,
    paymentFeeKnownLines: facts.filter(fact => fact.payment_fee_ars !== null && fact.payment_fee_ars !== undefined).length,
    shippingKnownLines: facts.filter(fact => fact.shipping_cost_ars !== null && fact.shipping_cost_ars !== undefined).length,
    taxKnownLines: facts.filter(fact => fact.tax_ars !== null && fact.tax_ars !== undefined).length,
  };
}
