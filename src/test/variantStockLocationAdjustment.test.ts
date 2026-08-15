import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260815000007_variant_stock_location_adjustment.sql"),
  "utf8",
);
const store = readFileSync(resolve(ROOT, "src/lib/supabaseStore.ts"), "utf8");
const locations = readFileSync(resolve(ROOT, "src/pages/LocationsPage.tsx"), "utf8");
const products = readFileSync(resolve(ROOT, "src/pages/ProductsPage.tsx"), "utf8");

describe("ajuste de variante por depósito", () => {
  it("exige ubicación para variantes cuando hay más de una sucursal y calcula el delta desde ese saldo", () => {
    expect(migration).toContain("p_location_id uuid DEFAULT NULL");
    expect(migration).toContain("Elegí el depósito para ajustar esta variante");
    expect(migration).toContain("FROM public.location_variant_stock");
    expect(migration).toContain("p_location_id => v_location_id");
    expect(migration).toContain("El ajuste localizado no cerró");
  });

  it("pasa la ubicación por el helper y da una operación explícita en Sucursales", () => {
    expect(store).toContain("locationId = null");
    expect(store).toContain("p_location_id: locationId");
    expect(locations).toContain("Ajustar stock de variante");
    expect(locations).toContain("locationId,");
    expect(locations).toContain("El número es el saldo final de esta presentación");
  });

  it("la ficha no deja fingir un ajuste global de variante con múltiples depósitos", () => {
    expect(products).toContain("variantsNeedLocation");
    expect(products).toContain("Ajustá este stock por depósito desde Sucursales");
    expect(products).toContain("Con más de un depósito, ajustá o transferí el stock");
  });
});
