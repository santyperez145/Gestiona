import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const page = leer("src/pages/EcommerceStorePage.tsx");
const migracion = leer("supabase/migrations/20260901000060_la_tienda_no_nace_adivinada.sql");

const soloCodigo = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Commerce no adivina la vitrina.
 *
 * El formulario arrancaba con «Mi Tienda Online», dorado `#f59e0b`, envío
 * $2.500 y envío gratis desde $50.000. La tabla repetía el oro y «Mi Tienda».
 * Un Guardar sin tocar esos campos publicaba tarifas que nadie eligió.
 */
describe("la tienda no nace adivinada", () => {
  it("el formulario no siembra nombre, oro ni tarifas de Exentry", () => {
    const codigo = soloCodigo(page);
    expect(codigo).toContain("storeDraftInicial");
    expect(codigo).toContain("costoEnvioAlGuardar");
    expect(codigo).toContain("envioGratisAlGuardar");
    expect(codigo).not.toContain("Mi Tienda Online");
    expect(codigo).not.toContain("#f59e0b");
    expect(codigo).not.toMatch(/free_shipping_above:\s*"50000"/);
    expect(codigo).not.toMatch(/shipping_cost:\s*"2500"/);
  });

  it("la base deja de sembrar oro, «Mi Tienda» y Mercado Pago por default", () => {
    expect(migracion).toContain("SET DEFAULT '#6E4DEE'");
    expect(migracion).toMatch(/ALTER COLUMN name[\s\S]{0,80}SET DEFAULT ''/);
    expect(migracion).toContain("ARRAY['transferencia']");
  });

  it("y no reescribe las vitrinas que ya existen", () => {
    expect(migracion).not.toMatch(/UPDATE\s+public\.ecommerce_stores/i);
  });
});
