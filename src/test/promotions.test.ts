import { describe, it, expect } from "vitest";
import { bestPromoPrice, type Promotion } from "@/lib/promotions";

// bestPromoPrice es la fuente de verdad de cómo el POS y el catálogo interno
// aplican las promociones por categoría/producto al cobrar.

const promo = (over: Partial<Promotion>): Promotion => ({
  id: over.id ?? "p1",
  name: over.name ?? "Promo",
  type: over.type ?? "percentage",
  status: "active",
  discount_value: over.discount_value ?? 20,
  applies_to: over.applies_to ?? "all",
  product_ids: over.product_ids ?? null,
  category_names: over.category_names ?? null,
  coupon_code: null,
  min_order_value: 0,
  starts_at: "2020-01-01T00:00:00Z",
  ends_at: null,
  banner_text: null,
  banner_color: null,
});

const prod = { id: "prodA", category: "perfume_arabe", sale_price_ars: 100_000, discount_price_ars: null };

describe("bestPromoPrice", () => {
  it("aplica una promo de categoría al producto de esa categoría", () => {
    const r = bestPromoPrice(prod, [promo({ applies_to: "categories", category_names: ["perfume_arabe"], discount_value: 20 })]);
    expect(r?.price).toBe(80_000);
  });

  it("NO aplica una promo de categoría a otra categoría", () => {
    const r = bestPromoPrice(prod, [promo({ applies_to: "categories", category_names: ["vaper"], discount_value: 20 })]);
    expect(r).toBeNull();
  });

  it("aplica promo 'all' a cualquier producto", () => {
    const r = bestPromoPrice(prod, [promo({ applies_to: "all", discount_value: 10 })]);
    expect(r?.price).toBe(90_000);
  });

  it("aplica promo 'products' solo si el id está en la lista", () => {
    expect(bestPromoPrice(prod, [promo({ applies_to: "products", product_ids: ["prodA"], discount_value: 15 })])?.price).toBe(85_000);
    expect(bestPromoPrice(prod, [promo({ applies_to: "products", product_ids: ["otro"], discount_value: 15 })])).toBeNull();
  });

  it("ignora promos de tipo 'customers' (son a nivel orden)", () => {
    expect(bestPromoPrice(prod, [promo({ applies_to: "customers", discount_value: 50 })])).toBeNull();
  });

  it("promo de monto fijo resta del precio de lista", () => {
    const r = bestPromoPrice(prod, [promo({ type: "fixed", discount_value: 30_000, applies_to: "all" })]);
    expect(r?.price).toBe(70_000);
  });

  it("elige la mejor (menor precio) entre varias promos aplicables", () => {
    const r = bestPromoPrice(prod, [
      promo({ id: "a", applies_to: "all", discount_value: 10 }),
      promo({ id: "b", applies_to: "categories", category_names: ["perfume_arabe"], discount_value: 30 }),
    ]);
    expect(r?.price).toBe(70_000);
    expect(r?.promo.id).toBe("b");
  });

  it("solo aplica la promo si mejora el descuento manual del producto", () => {
    const conDesc = { ...prod, discount_price_ars: 75_000 }; // manual 25% off
    // promo 10% (90k) NO mejora los 75k manuales
    expect(bestPromoPrice(conDesc, [promo({ applies_to: "all", discount_value: 10 })])).toBeNull();
    // promo 40% (60k) SÍ mejora
    expect(bestPromoPrice(conDesc, [promo({ applies_to: "all", discount_value: 40 })])?.price).toBe(60_000);
  });

  it("devuelve null si el producto no tiene precio de lista", () => {
    expect(bestPromoPrice({ id: "x", category: "vaper", sale_price_ars: 0 }, [promo({ applies_to: "all" })])).toBeNull();
  });
});
