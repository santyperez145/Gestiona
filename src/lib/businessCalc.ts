// ─────────────────────────────────────────────────────────────────────────
// businessCalc — funciones puras de cálculo de dinero.
//
// Toda la lógica que toca plata (comisiones, ROI de canjes, valuación de
// inventario, márgenes P&L) vive acá como funciones puras y testeadas, en vez
// de estar inlineada dentro de componentes. Regla: si un número que ve el
// usuario sale de una cuenta, la cuenta va acá y tiene un test.
// ─────────────────────────────────────────────────────────────────────────

// ── Comisiones de vendedores ─────────────────────────────────────────────

/** Comisión en ARS = total de ventas × (porcentaje / 100), redondeada. */
export function calcSellerCommission(salesTotalARS: number, commissionPercent: number): number {
  if (!(salesTotalARS > 0) || !(commissionPercent > 0)) return 0;
  return Math.round(salesTotalARS * (commissionPercent / 100));
}

/**
 * Primer y último día (YYYY-MM-DD) de un período "YYYY-MM".
 * periodEnd usa el día 0 del mes siguiente = último día real del mes.
 */
export function calcMonthPeriod(period: string): { periodStart: string; periodEnd: string } {
  const [year, month] = period.split("-").map(Number);
  const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

// ── Atribución de ventas ─────────────────────────────────────────────────

/**
 * Decide la fuente de atribución de una venta según el cupón usado y si ese
 * cupón corresponde al código de descuento de un canje de influencer.
 * - sin cupón            -> null (venta orgánica)
 * - cupón de influencer  -> 'influencer'
 * - cupón común          -> 'coupon'
 */
export function resolveSaleAttribution(
  couponCode: string | null | undefined,
  matchesInfluencerCode: boolean,
): 'influencer' | 'coupon' | null {
  if (!couponCode) return null;
  return matchesInfluencerCode ? 'influencer' : 'coupon';
}

// ── ROI de canjes con influencers ────────────────────────────────────────

/**
 * ROI % = (ventas generadas − inversión) / inversión × 100.
 * Devuelve null cuando falta inversión o ventas (no hay dato suficiente),
 * para mostrar "Sin datos" en vez de un número engañoso.
 */
export function calcInfluencerROI(totalSalesGeneratedARS: number, totalInversionARS: number): number | null {
  if (!(totalInversionARS > 0) || !(totalSalesGeneratedARS > 0)) return null;
  return ((totalSalesGeneratedARS - totalInversionARS) / totalInversionARS) * 100;
}

/**
 * CPM (costo por mil impresiones) = inversión / alcance × 1000.
 * null cuando falta alcance o inversión.
 */
export function calcCPM(totalInversionARS: number, totalReach: number): number | null {
  if (!(totalReach > 0) || !(totalInversionARS > 0)) return null;
  return (totalInversionARS / totalReach) * 1000;
}

/** Tasa de cumplimiento % = posts entregados / posts esperados × 100. */
export function calcFulfillmentRate(totalActualPosts: number, totalExpectedPosts: number): number {
  return totalExpectedPosts > 0 ? (totalActualPosts / totalExpectedPosts) * 100 : 0;
}

// ── Valuación de inventario ──────────────────────────────────────────────

/**
 * Costo unitario en ARS derivado del precio de venta menos la ganancia por
 * unidad. Nunca negativo.
 */
export function calcCostARS(salePriceARS: number, profitPerUnitARS: number): number {
  return Math.max(0, Number(salePriceARS || 0) - Number(profitPerUnitARS || 0));
}

/** Valor de inventario de un producto = stock × costo unitario ARS. */
export function calcInventoryValue(stock: number, costARS: number): number {
  return Number(stock || 0) * costARS;
}

/**
 * Costo unitario de una capa (layer) de compra en ARS. Usa el tipo de cambio
 * de la compra si existe; si no, cae al tipo de cambio de referencia.
 */
export function calcLayerUnitCostARS(unitCostUSD: number, exchangeRateUsed: number, fallbackRate: number): number {
  const rate = Number(exchangeRateUsed || 0) || Number(fallbackRate || 0);
  return Number(unitCostUSD || 0) * rate;
}

// ── Margen de una línea importada de MercadoLibre ────────────────────────

export interface MeliLineMargin {
  totalARS: number;
  costARS: number;
  feeARS: number;
  profitARS: number;
  profitUSD: number;
}

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * Margen de una línea cobrada en MercadoLibre.
 *
 * La comisión es el `sale_fee` informado por MercadoLibre, no una tarifa
 * estimada. `import_meli_order_as_sales()` en SQL es el espejo autoritativo:
 * la base valida el payload y persiste el resultado antes de mover stock.
 */
export function calcMeliLineMargin(
  quantity: number,
  unitPriceARS: number,
  totalCostUSD: number,
  exchangeRate: number,
  saleFeeARS: number,
): MeliLineMargin {
  const qty = Number(quantity);
  const rate = Number(exchangeRate);
  const totalARS = roundMoney(Number(unitPriceARS) * qty);
  const costARS = roundMoney(Number(totalCostUSD) * rate * qty);
  const feeARS = roundMoney(Number(saleFeeARS));
  const profitARS = roundMoney(totalARS - costARS - feeARS);
  const profitUSD = rate !== 0 ? Math.round((profitARS / rate) * 10_000) / 10_000 : 0;
  return { totalARS, costARS, feeARS, profitARS, profitUSD };
}

// ── Márgenes P&L ─────────────────────────────────────────────────────────

export interface PnLMargins {
  net: number;
  grossMargin: number;
  netMargin: number;
}

/**
 * Resultado neto y márgenes de un período.
 * net = ganancia bruta − gastos; márgenes son % sobre ingresos (0 si no hay).
 */
export function calcPnLMargins(revenueARS: number, grossProfitARS: number, totalExpensesARS: number): PnLMargins {
  const net = grossProfitARS - totalExpensesARS;
  const grossMargin = revenueARS > 0 ? (grossProfitARS / revenueARS) * 100 : 0;
  const netMargin = revenueARS > 0 ? (net / revenueARS) * 100 : 0;
  return { net, grossMargin, netMargin };
}
