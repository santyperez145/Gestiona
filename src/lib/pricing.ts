// ── Fuente de verdad del pricing ────────────────────────────────────────────
// Todas las pantallas que calculan precios (form de producto, "Recalcular
// Todo" de Ajustes, "Ajuste masivo" de Productos) deben usar estos helpers
// para que el markup/descuento por categoría se aplique igual en todos lados.
//
// Modelo de precio:
//   costo landeado USD = costo + (costo × pasero%)
//   precio venta ARS   = costo landeado × TC × markup      (markup 2 = ×2)
//   precio c/desc ARS  = precio venta × (1 − descuento%)

export interface CategoryPricingEntry {
  markup?: number;
  discount?: number;
}

export const DEFAULT_MARKUP = 2;
export const DEFAULT_DISCOUNT_PERCENT = 20;

function categoryEntry(settings: any, category?: string | null): CategoryPricingEntry | undefined {
  if (!category) return undefined;
  const cp = settings?.category_pricing as Record<string, CategoryPricingEntry> | undefined;
  return cp?.[category];
}

/** Markup de la categoría (ej. 2 = ×2). Fallback: ×2. */
export function getCategoryMarkup(settings: any, category?: string | null): number {
  const m = Number(categoryEntry(settings, category)?.markup);
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_MARKUP;
}

/**
 * Descuento por defecto de la categoría (%). Si la categoría no define uno,
 * cae al descuento global de settings, y si no, a 20.
 */
export function getCategoryDiscount(settings: any, category?: string | null): number {
  const d = Number(categoryEntry(settings, category)?.discount);
  if (Number.isFinite(d) && d >= 0 && d < 100) return d;
  const global = Number(settings?.default_discount_percent);
  return Number.isFinite(global) && global >= 0 && global < 100 ? global : DEFAULT_DISCOUNT_PERCENT;
}

/** Costo landeado en USD (costo + pasero). */
export function calcLandedCostUSD(costUSD: number, customsPercent: number): number {
  const c = Number(costUSD) || 0;
  const pct = Number(customsPercent) || 0;
  return c + c * (pct / 100);
}

/** Precio de venta sugerido en ARS a partir del costo, pasero, TC y markup. */
export function calcAutoSalePrice(
  costUSD: number,
  customsPercent: number,
  exchangeRate: number,
  markup: number,
): number {
  const cost = Number(costUSD) || 0;
  if (cost <= 0) return 0;
  const rate = Number(exchangeRate) || 0;
  const mk = Number(markup) > 0 ? Number(markup) : DEFAULT_MARKUP;
  return Math.round(calcLandedCostUSD(cost, customsPercent) * rate * mk);
}

/** Precio con descuento a partir del precio de venta y el % de descuento. */
export function calcAutoDiscountPrice(salePriceARS: number, discountPercent: number): number {
  const price = Number(salePriceARS) || 0;
  if (price <= 0) return 0;
  const pct = Number(discountPercent);
  const safePct = Number.isFinite(pct) && pct >= 0 && pct < 100 ? pct : 0;
  return Math.round(price * (1 - safePct / 100));
}

/** Margen % sobre el precio de venta (cuánto del precio es ganancia). */
export function calcMarginPct(salePriceARS: number, totalCostARS: number): number {
  const price = Number(salePriceARS) || 0;
  if (price <= 0) return 0;
  return ((price - (Number(totalCostARS) || 0)) / price) * 100;
}
