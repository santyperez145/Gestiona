import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { planDePresupuesto } from "@/lib/presupuestoACaja";

// 2026-10-14: «Convertir en venta» insertaba una única venta con las
// descripciones unidas y ganancia 0, sin stock, caja ni factura, y se podía
// convertir dos veces. Ahora el presupuesto se cobra en la caja: cada renglón
// lleva `quote_id` y la base lo marca vendido una sola vez (20261014000900).
const productos = [
  { id: "p1", name: "Tornillo 6 mm" },
  { id: "p2", name: "Tarugo Fischer" },
  { id: "p3", name: "Mecha" },
  { id: "p4", name: "Mecha" },
  { id: "p5", name: "Pintura látex" },
];

describe("presupuesto → caja: qué se carga", () => {
  it("usa el producto elegido y congela el precio del presupuesto", () => {
    const plan = planDePresupuesto([{ description: "Tornillo 6 mm", qty: 10, unitPrice: 25, productId: "p1" }], productos, {});
    expect(plan.lineas.map(l => [l.producto.id, l.cantidad, l.precio])).toEqual([["p1", 10, 25]]);
    expect(plan.faltantes).toEqual([]);
  });

  it("un ítem viejo sin producto se reconoce por nombre exacto (sin tildes ni mayúsculas)", () => {
    const plan = planDePresupuesto([{ description: "  PINTURA LATEX ", qty: 2, unitPrice: 9000 }], productos, {});
    expect(plan.lineas[0].producto.id).toBe("p5");
  });

  it("no adivina: nombre repetido, inexistente o producto borrado quedan afuera con el motivo", () => {
    const plan = planDePresupuesto([
      { description: "Mecha", qty: 1, unitPrice: 100 },
      { description: "Flete a domicilio", qty: 1, unitPrice: 5000 },
      { description: "Tornillo", qty: 1, unitPrice: 10, productId: "borrado" },
      { description: "Tarugo Fischer", qty: 0, unitPrice: 10, productId: "p2" },
    ], productos, {});
    expect(plan.lineas).toEqual([]);
    expect(plan.faltantes.map(f => f.motivo)).toEqual([
      "hay más de un producto con ese nombre",
      "no está en el catálogo",
      "el producto ya no está en el catálogo",
      "no tiene cantidad",
    ]);
  });

  it("un producto con variantes se carga con la variante elegida; sin elegir, se elige en la caja", () => {
    const sinVariante = planDePresupuesto([{ description: "Tarugo Fischer", qty: 3, unitPrice: 50, productId: "p2" }], productos, { p2: [{ id: "v1" }] });
    expect(sinVariante.lineas).toEqual([]);
    expect(sinVariante.faltantes[0].motivo).toBe("tiene variantes: elegila en la caja");
    const conVariante = planDePresupuesto([{ description: "Tarugo Fischer · 8 mm", qty: 3, unitPrice: 50, productId: "p2", variantId: "v1" }], productos, { p2: [{ id: "v1" }] });
    expect(conVariante.lineas.map(l => [l.producto.id, l.variante?.id, l.cantidad])).toEqual([["p2", "v1", 3]]);
    const borrada = planDePresupuesto([{ description: "Tarugo", qty: 1, unitPrice: 50, productId: "p2", variantId: "vieja" }], productos, { p2: [{ id: "v1" }] });
    expect(borrada.faltantes[0].motivo).toBe("la variante ya no está disponible");
  });

  it("el descuento del renglón llega a la caja como precio ya descontado", () => {
    const plan = planDePresupuesto([{ description: "Tornillo 6 mm", qty: 10, unitPrice: 25, discountPct: 10, productId: "p1" }], productos, {});
    expect(plan.lineas[0].precio).toBe(22.5);
  });

  it("el mismo producto en dos renglones se suma", () => {
    const plan = planDePresupuesto([
      { description: "Tornillo 6 mm", qty: 10, unitPrice: 25, productId: "p1" },
      { description: "Tornillo 6 mm", qty: 5, unitPrice: 25, productId: "p1" },
    ], productos, {});
    expect(plan.lineas.map(l => l.cantidad)).toEqual([15]);
  });
});

describe("presupuesto → caja: el circuito", () => {
  const pagina = fs.readFileSync("src/pages/PresupuestosPage.tsx", "utf8");
  const pos = fs.readFileSync("src/pages/POSPage.tsx", "utf8");
  const sql = fs.readFileSync("supabase/migrations/20261014000900_presupuesto_a_venta.sql", "utf8");

  it("Presupuestos ya no inserta ventas: manda a la caja y oculta el botón si está vendido", () => {
    expect(pagina).not.toContain("addSaleDB");
    expect(pagina).toContain("navigate(`/caja?presupuesto=${q.id}`)");
    expect(pagina).toContain("{!q.converted_at && (q.status === \"draft\"");
    const editor = fs.readFileSync("src/components/presupuestos/EditorDePresupuesto.tsx", "utf8");
    expect(editor).toContain("productId: p.id, variantId: variante?.id ?? null");
  });

  it("la caja manda el presupuesto en cada renglón y lo suelta al vaciar el carrito", () => {
    expect(pos).toContain("...(presupuestoCaja ? { quote_id: presupuestoCaja.id } : {}),");
    expect(pos).toContain("if (cart.length === 0 && presupuestoCaja) soltarPresupuesto();");
    expect(pos).toContain("if (presupuesto.converted_at) { toast.error(");
  });

  it("la base: mismo negocio, una sola conversión y presupuesto vendido congelado", () => {
    expect(sql).toContain("q.org_id IS DISTINCT FROM NEW.org_id");
    expect(sql).toContain("q.converted_transaction_id <> NEW.sale_transaction_id");
    expect(sql).toContain("USING ERRCODE = '23505'");
    expect(sql).toContain("BEFORE UPDATE ON public.quotes");
    expect(sql).toContain("Un presupuesto se marca como vendido sólo al cobrarlo en la caja");
  });
});
