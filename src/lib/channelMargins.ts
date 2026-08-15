// Hechos de margen por canal. La base conserva los importes; este módulo sólo
// los agrupa para mostrarlos. Un null significa "no medido", nunca cero.

export type MarginChannel = "pos" | "tienda_online" | "mercadolibre";

export interface MarginSaleFact {
  id: string;
  product_id: string | null;
  product_name: string;
  source: string;
  quantity: number;
  total_ars: number;
  cost_of_goods_ars: number;
}

export interface StoreMarginFact {
  sale_id: string;
  payment_fee_ars: number | null;
  carrier_shipping_cost_ars: number | null;
  tax_ars: number | null;
}

export interface MeliMarginFact {
  sale_id: string;
  sale_fee_ars: number | null;
  seller_shipping_cost_ars: number | null;
}

export interface ChannelMarginLine {
  saleId: string;
  productId: string;
  productName: string;
  channel: MarginChannel;
  quantity: number;
  revenueARS: number;
  cogsARS: number;
  paymentFeeARS: number | null;
  carrierShippingCostARS: number | null;
  taxARS: number | null;
  marginAfterMeasuredCostsARS: number | null;
}

export interface ChannelMarginSummary {
  productId: string;
  productName: string;
  channel: MarginChannel;
  lines: number;
  units: number;
  revenueARS: number;
  cogsARS: number;
  paymentFeeARS: number | null;
  carrierShippingCostARS: number | null;
  taxARS: number | null;
  marginAfterMeasuredCostsARS: number | null;
  pending: string[];
}

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

function knownMargin(
  revenue: number,
  cogs: number,
  paymentFee: number | null,
  shipping: number | null,
  tax: number | null,
) {
  if (paymentFee === null || shipping === null || tax === null) return null;
  return roundMoney(revenue - cogs - paymentFee - shipping - tax);
}

/** Convierte ventas por línea a hechos comparables sin completar datos ausentes. */
export function buildChannelMarginLines(
  sales: MarginSaleFact[],
  storeFacts: StoreMarginFact[],
  meliFacts: MeliMarginFact[],
): ChannelMarginLine[] {
  const storeBySale = new Map(storeFacts.map(fact => [fact.sale_id, fact]));
  const meliBySale = new Map(meliFacts.map(fact => [fact.sale_id, fact]));

  return sales.flatMap((sale): ChannelMarginLine[] => {
    if (!sale.product_id) return [];
    if (sale.source !== "pos" && sale.source !== "tienda_online" && sale.source !== "mercadolibre") return [];

    const revenueARS = Number(sale.total_ars || 0);
    const cogsARS = Number(sale.cost_of_goods_ars || 0);
    const base = {
      saleId: sale.id,
      productId: sale.product_id,
      productName: sale.product_name || "Sin nombre",
      channel: sale.source as MarginChannel,
      quantity: Number(sale.quantity || 0),
      revenueARS,
      cogsARS,
    };

    if (sale.source === "tienda_online") {
      const fact = storeBySale.get(sale.id);
      const paymentFeeARS = fact?.payment_fee_ars ?? null;
      const carrierShippingCostARS = fact?.carrier_shipping_cost_ars ?? null;
      return [{
        ...base,
        paymentFeeARS,
        carrierShippingCostARS,
        taxARS: fact?.tax_ars ?? null,
        marginAfterMeasuredCostsARS: knownMargin(revenueARS, cogsARS, paymentFeeARS, carrierShippingCostARS, fact?.tax_ars ?? null),
      }];
    }

    if (sale.source === "mercadolibre") {
      const fact = meliBySale.get(sale.id);
      const paymentFeeARS = fact?.sale_fee_ars ?? null;
      const carrierShippingCostARS = fact?.seller_shipping_cost_ars ?? null;
      return [{
        ...base,
        paymentFeeARS,
        carrierShippingCostARS,
        taxARS: null,
        marginAfterMeasuredCostsARS: knownMargin(revenueARS, cogsARS, paymentFeeARS, carrierShippingCostARS, null),
      }];
    }

    // En mostrador no hay despacho: su costo de envío es cero conocido. POS
    // todavía no vincula cada línea a la liquidación de su medio de pago.
    return [{
      ...base,
      paymentFeeARS: null,
      carrierShippingCostARS: 0,
      taxARS: null,
      marginAfterMeasuredCostsARS: null,
    }];
  });
}

function sumIfAllKnown(lines: ChannelMarginLine[], field: keyof Pick<ChannelMarginLine, "paymentFeeARS" | "carrierShippingCostARS" | "taxARS">) {
  if (lines.some(line => line[field] === null)) return null;
  return roundMoney(lines.reduce((sum, line) => sum + Number(line[field]), 0));
}

/** Agrupa por producto/canal y declara explícitamente qué término falta. */
export function summarizeChannelMargins(lines: ChannelMarginLine[]): ChannelMarginSummary[] {
  const groups = new Map<string, ChannelMarginLine[]>();
  for (const line of lines) {
    const key = `${line.productId}::${line.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  return [...groups.values()].map(group => {
    const first = group[0];
    const paymentFeeARS = sumIfAllKnown(group, "paymentFeeARS");
    const carrierShippingCostARS = sumIfAllKnown(group, "carrierShippingCostARS");
    const taxARS = sumIfAllKnown(group, "taxARS");
    const revenueARS = roundMoney(group.reduce((sum, line) => sum + line.revenueARS, 0));
    const cogsARS = roundMoney(group.reduce((sum, line) => sum + line.cogsARS, 0));
    const pending: string[] = [];
    if (paymentFeeARS === null) pending.push("comisión de cobro");
    if (carrierShippingCostARS === null) pending.push("costo real de envío");
    if (taxARS === null) pending.push("IVA por línea");

    return {
      productId: first.productId,
      productName: first.productName,
      channel: first.channel,
      lines: group.length,
      units: group.reduce((sum, line) => sum + line.quantity, 0),
      revenueARS,
      cogsARS,
      paymentFeeARS,
      carrierShippingCostARS,
      taxARS,
      marginAfterMeasuredCostsARS: pending.length === 0
        ? roundMoney(revenueARS - cogsARS - paymentFeeARS - carrierShippingCostARS - taxARS)
        : null,
      pending,
    };
  }).sort((a, b) => b.revenueARS - a.revenueARS || a.productName.localeCompare(b.productName));
}
