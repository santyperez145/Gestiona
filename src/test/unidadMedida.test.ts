import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cantidadMedida, cantidadStockValida, etiquetaUnidad, formatoCantidad, unidadControlador } from "@/lib/unidadMedida";
import { documentoDesdeLineas } from "@/lib/fiscalPrinter/service";
import { validateProductDraft } from "@/lib/productDraft";

describe("unidad de medida", () => {
  it("lee cantidades con coma o punto y hasta tres decimales", () => {
    expect(cantidadMedida("12,75")).toBe(12.75);
    expect(cantidadMedida("1.250")).toBe(1.25);
    expect(cantidadMedida(" 3 ")).toBe(3);
    for (const malo of ["0", "-1", "1,2345", "abc", ""]) expect(cantidadMedida(malo)).toBeNull();
  });

  it("valida stock con hasta tres decimales sin decidir por el producto", () => {
    expect(cantidadStockValida(0)).toBe(true);
    expect(cantidadStockValida(87.75)).toBe(true);
    expect(cantidadStockValida(1.2345)).toBe(false);
    expect(cantidadStockValida(-1)).toBe(false);
    expect(cantidadStockValida(0, { permitirCero: false })).toBe(false);
  });

  it("muestra la cantidad con su unidad", () => {
    expect(formatoCantidad(12.75, "metro")).toBe("12,75 m");
    expect(formatoCantidad(3, "unidad")).toBe("3 u.");
    expect(etiquetaUnidad("zz")).toBe("u.");
  });

  it("el controlador fiscal recibe la unidad del producto", () => {
    expect(unidadControlador("m2")).toBe("metro2");
    const doc = documentoDesdeLineas([{ product_name: "Cable", quantity: 12.75, total_ars: 10837.5, fiscal_tax_rate: 21, payment_method: "efectivo", split_payments: null, product_id: "p", products: { sku: "CAB", tax_rate: 21, unidad_medida: "metro" } }], { emisorSinIva: false, tasaPorDefecto: 21 });
    expect(doc.items[0]).toMatchObject({ cantidad: 12.75, precioUnitario: 850, unidad: "metro" });
  });

  it("el alta de producto acepta stock fraccionado", () => {
    expect(validateProductDraft({ name: "Cable", salePrice: 850, manejaStock: true, stockRaw: "100,5", firstUse: false } as never).ok).toBe(true);
  });

  it("la autoridad SQL sólo acepta fracciones para productos por medida", () => {
    const sql = readFileSync("supabase/migrations/20261009000800_cantidades_fraccionadas.sql", "utf8");
    expect(sql).toContain("p_quantity numeric");
    expect(sql).toContain("Este producto se vende por unidad: la cantidad debe ser entera");
    expect(sql).not.toMatch(/DROP VIEW [^;]*CASCADE/i);
  });
});
