// ── Motor de promociones auto-aplicables ────────────────────────────────────
// Aplica al cobrar (POS) y en el catálogo interno las promociones persistentes
// de la tabla `promotions` que apuntan a productos / categorías / todo.
// Las promos con coupon_code se manejan por el flujo de cupones (no acá).
import { supabase } from "@/integrations/supabase/client";

export interface Promotion {
  id: string;
  name: string;
  type: string;              // 'percentage' | 'fixed' | otros (ignorados en v1)
  status: string;
  discount_value: number;
  applies_to: string;        // 'all' | 'products' | 'categories' | 'customers'
  product_ids: string[] | null;
  category_names: string[] | null;
  coupon_code: string | null;
  min_order_value: number;
  starts_at: string;
  ends_at: string | null;
  banner_text: string | null;
  banner_color: string | null;
}

interface PricedProduct {
  id: string;
  category?: string | null;
  sale_price_ars?: number | null;
  discount_price_ars?: number | null;
}

/**
 * Promociones activas auto-aplicables (sin coupon_code) para la org.
 * Filtra por status/ventana de fechas y tipos soportados (percentage/fixed).
 */
export async function loadActivePromotions(orgId: string): Promise<Promotion[]> {
  if (!orgId) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("promotions")
    .select("id,name,type,status,discount_value,applies_to,product_ids,category_names,coupon_code,min_order_value,starts_at,ends_at,banner_text,banner_color")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("coupon_code", null)
    .in("type", ["percentage", "fixed"])
    .lte("starts_at", nowIso);
  if (error || !data) return [];
  // Ventana de fin en cliente (ends_at null = sin fin)
  return (data as Promotion[]).filter(p => !p.ends_at || p.ends_at > nowIso);
}

/** ¿La promo aplica a este producto según applies_to? */
function promoMatches(promo: Promotion, product: PricedProduct): boolean {
  switch (promo.applies_to) {
    case "all": return true;
    case "products": return !!promo.product_ids && promo.product_ids.includes(product.id);
    case "categories": return !!promo.category_names && !!product.category && promo.category_names.includes(product.category);
    case "customers": return false; // order-level, no line pricing
    default: return false;
  }
}

/** Precio unitario que deja la promo sobre un precio base. */
function promoPrice(promo: Promotion, basePrice: number): number {
  if (promo.type === "percentage") return Math.max(0, Math.round(basePrice * (1 - promo.discount_value / 100)));
  if (promo.type === "fixed") return Math.max(0, Math.round(basePrice - promo.discount_value));
  return basePrice;
}

export interface BestPromo {
  price: number;       // precio unitario final para el cliente
  promo: Promotion;    // promo ganadora
  basePrice: number;   // precio de lista (sale_price_ars)
}

/**
 * Mejor precio auto-aplicable para un producto: compara todas las promos que
 * matchean + el descuento manual del producto, y devuelve el menor precio.
 * Devuelve null si ninguna promo mejora el precio ya vigente.
 */
export function bestPromoPrice(product: PricedProduct, promos: Promotion[]): BestPromo | null {
  const base = Number(product.sale_price_ars) || 0;
  if (base <= 0) return null;
  const manual = product.discount_price_ars && Number(product.discount_price_ars) < base
    ? Number(product.discount_price_ars) : base;
  let best: BestPromo | null = null;
  for (const promo of promos) {
    if (!promoMatches(promo, product)) continue;
    const price = promoPrice(promo, base);
    if (price < manual && (!best || price < best.price)) {
      best = { price, promo, basePrice: base };
    }
  }
  return best;
}
