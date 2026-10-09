import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorPresentacion, etiquetaPresentacion, presentacionPorCodigo } from "@/lib/productPresentations";

describe("presentaciones de producto", () => {
  const cajas = [
    { id: "a", product_id: "p", name: "Pack x6", factor: 6, barcode: "7790001" },
    { id: "b", product_id: "p", name: "Caja x24", factor: 24, barcode: null },
  ];

  it("encuentra la caja por su código y nunca por un código vacío", () => {
    expect(presentacionPorCodigo(cajas, " 7790001 ")?.id).toBe("a");
    expect(presentacionPorCodigo(cajas, "")).toBeNull();
    expect(presentacionPorCodigo(cajas, "999")).toBeNull();
  });

  it("valida cantidades según la unidad del producto", () => {
    expect(errorPresentacion("Caja", 12, "unidad")).toBeNull();
    expect(errorPresentacion("Medio", 0.5, "unidad")).toMatch(/unidades enteras/);
    expect(errorPresentacion("Horma", 4.5, "kg")).toBeNull();
    expect(errorPresentacion("", 4, "kg")).toMatch(/nombre/);
    expect(errorPresentacion("Caja", 0, "unidad")).toMatch(/mayor a cero/);
    expect(errorPresentacion("Rollo", 1.2345, "metro")).toMatch(/tres decimales/);
    expect(etiquetaPresentacion({ name: "Horma", factor: 4.5 }, "kg")).toBe("Horma (4,5 kg)");
    expect(etiquetaPresentacion({ name: "Caja", factor: 12 })).toBe("Caja (12 u.)");
  });

  it("el POS suma las unidades de la caja escaneada", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("addToCart(prodDeCaja, undefined, Number(presentacion.factor));");
    expect(pos).toContain("quantity: cantidad,");
    const sql = readFileSync("supabase/migrations/20261009001200_presentaciones_producto.sql", "utf8");
    expect(sql).toContain("ON public.product_presentations(org_id, barcode) WHERE barcode IS NOT NULL");
  });
});
