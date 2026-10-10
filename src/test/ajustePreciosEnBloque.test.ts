import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { errorDelAjuste, marcasDelCatalogo, type AjusteEnBloque } from "@/lib/ajustePreciosEnBloque";

const base: AjusteEnBloque = { porcentaje: 8, que: "costo_y_precio", categoria: null, marca: null, proveedor: null, redondeo: 10 };
const migracion = readFileSync("supabase/migrations/20261010001700_ajuste_de_precios_en_bloque.sql", "utf8");
const pagina = readFileSync("src/pages/ProductsPage.tsx", "utf8");

describe("ajuste de precios en bloque", () => {
  it("valida igual que la base", () => {
    expect(errorDelAjuste(base)).toBeNull();
    expect(errorDelAjuste({ ...base, porcentaje: 0 })).toMatch(/distinto de 0/);
    expect(errorDelAjuste({ ...base, porcentaje: Number.NaN })).toMatch(/distinto de 0/);
    expect(errorDelAjuste({ ...base, porcentaje: -90 })).toMatch(/entre -90% y 500%/);
    expect(errorDelAjuste({ ...base, porcentaje: 501 })).toMatch(/entre -90% y 500%/);
    expect(errorDelAjuste({ ...base, redondeo: 7 })).toMatch(/redondeo/);
    expect(migracion).toContain("p_porcentaje <= -90 OR p_porcentaje > 500");
    expect(migracion).toContain("p_redondeo NOT IN (1, 10, 50, 100)");
  });

  it("las marcas van tal cual las guarda la base, sin vacíos ni repetidas", () => {
    expect(marcasDelCatalogo([{ brand: "Stanley" }, { brand: "  " }, { brand: null }, { brand: "Bahco" }, { brand: "Stanley" }]))
      .toEqual(["Bahco", "Stanley"]);
  });

  it("la base hace el trabajo en una transacción, con permiso y vista previa", () => {
    expect(migracion).toContain("has_permission(p_org, 'products', 'edit')");
    expect(migracion).toContain("IF p_aplicar AND v_afectados > 0 THEN");
    expect(migracion).toContain("p.supplier_id = p_proveedor");
    // Costo en pesos: la ganancia no pasa por el dólar.
    expect(migracion).toContain("WHEN a.moneda = 'ARS' AND a.costo_despues IS NOT NULL THEN a.precio_despues - a.costo_despues");
  });

  it("Productos ya no ajusta fila por fila desde el navegador", () => {
    expect(pagina).not.toContain("const handleApply = async");
    expect(pagina).toContain("<AjustePreciosEnBloque");
  });
});
