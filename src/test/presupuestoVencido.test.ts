import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparacionConHoy, planDePresupuesto, precioDeHoy } from "@/lib/presupuestoACaja";

const productos = [
  { id: "p1", name: "Pintura 20 L", sale_price_ars: 118000, discount_price_ars: null },
  { id: "p2", name: "Rodillo", sale_price_ars: 9000, discount_price_ars: 8500 },
];

describe("presupuesto vencido en la caja", () => {
  it("el precio de hoy respeta la oferta, la variante y el descuento del renglón", () => {
    expect(precioDeHoy({ sale_price_ars: 1000, discount_price_ars: null }, null, 0)).toBe(1000);
    expect(precioDeHoy({ sale_price_ars: 1000, discount_price_ars: 900 }, null, 0)).toBe(900);
    expect(precioDeHoy({ sale_price_ars: 1000, discount_price_ars: 900 }, { price_override: 1200 }, 10)).toBe(1080);
  });

  it("compara lo presupuestado con lo que vale hoy, con el mismo descuento", () => {
    const plan = planDePresupuesto([
      { description: "Pintura 20 L", qty: 2, unitPrice: 100000, discountPct: 10, productId: "p1" },
      { description: "Rodillo", qty: 3, unitPrice: 8500, productId: "p2" },
    ], productos, {});
    expect(plan.lineas.map(l => l.descuentoPct)).toEqual([10, 0]);
    const c = comparacionConHoy(plan.lineas, l => precioDeHoy(l.producto, null, l.descuentoPct));
    // Presupuestado: 2 × 90.000 + 3 × 8.500 = 205.500. Hoy: 2 × 106.200 + 3 × 8.500 = 237.900.
    expect(c).toEqual({ presupuestado: 205500, hoy: 237900, subieron: 1 });
  });

  it("la caja pregunta antes de cobrar un presupuesto vencido a precios viejos", () => {
    const caja = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(caja).toContain('confirmText: "Cobrar a precios de hoy"');
    expect(caja).toContain('cancelText: "Respetar el presupuesto"');
  });
});
