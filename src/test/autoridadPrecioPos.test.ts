import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260821000010_autoridad_precio_pos.sql");
const verif = leer("supabase/verificaciones/20260821_autoridad_precio_pos.sql");
const store = leer("src/lib/supabaseStore.ts");

/**
 * C12 — guarda de la autoridad de precio del POS.
 *
 * ── El agujero que tapó, medido ───────────────────────────────────────────
 *
 * `create_sales_transaction` tomaba precio, costo y ganancia del payload del
 * navegador y sólo los `COALESCE` a cero. Verificado contra producción con un
 * producto de USD 20 que se vende a $100.000:
 *
 *     el navegador dijo:  precio 1 · costo 0 · ganancia 999999
 *     la base guardó:     precio 1 · costo 0 · ganancia 999999
 *
 * Era el último lugar del sistema donde el cliente decidía plata.
 */
describe("autoridad de precio del POS", () => {
  it("el costo y la ganancia se pisan SIEMPRE", () => {
    // No existe operación legítima que necesite decidirlos desde el navegador.
    expect(migracion).toContain("'cost_per_unit_usd', (v_precios->>'costo_usd')::numeric");
    expect(migracion).toContain("'cost_of_goods_ars'");
    expect(migracion).toContain("'profit_ars'");
  });

  it("el precio admite override, pero queda registrado", () => {
    // El mostrador necesita que el cajero pueda descontar. Bloquearlo sería
    // romper el POS; aceptarlo sin registro sería no saber nunca por qué una
    // venta salió distinta.
    expect(migracion).toContain("override_de_precio");
    expect(migracion).toContain("precio_autoritativo");
  });

  it("el costo sale del producto, no del payload", () => {
    expect(migracion).toContain("v_costo_usd := COALESCE(NULLIF(v_p.total_cost_usd, 0), v_p.cost_usd, 0)");
  });

  it("usa la MISMA función de promociones que la tienda", () => {
    // Dos motores de promoción distintos terminan cobrando distinto en el
    // mostrador y online, que es de los bugs más caros de encontrar.
    expect(migracion).toContain("public.store_promo_price(");
  });

  it("una oferta más cara que la lista no se aplica", () => {
    // Es un dato mal cargado, no una oferta.
    expect(migracion).toContain("v_p.discount_price_ars < v_lista");
  });

  it("sin tipo de cambio la ganancia en dólares es 0, no una división por cero", () => {
    expect(migracion).toMatch(/tipo_cambio'\)::numeric, 0\) > 0/);
    expect(migracion).toContain("'profit_usd', 0");
  });

  it("verifica la organización y no se puede vender un producto ajeno", () => {
    expect(migracion).toContain("is_org_member(p_org_id, auth.uid())");
    expect(migracion).toContain("p.org_id = p_org");
  });

  it("no es llamable por anon", () => {
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.create_sales_transaction_v2");
    expect(migracion).not.toMatch(/GRANT EXECUTE[\s\S]{0,120}create_sales_transaction_v2[\s\S]{0,60}anon/);
  });

  it("envuelve la función original en vez de reimplementarla", () => {
    expect(migracion).toContain("RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)");
    expect(migracion).not.toContain("INSERT INTO public.sales");
  });

  it("el cliente llama a la v2 y cae a la anterior sólo si no existe", () => {
    expect(store).toContain("create_sales_transaction_v2");
    expect(store).toContain("'42883', 'PGRST202'");
  });

  it("la verificación prueba que la ganancia inventada no entra", () => {
    expect(verif).toContain("ganancia_pedida");
    expect(verif).toContain("v_v.profit_ars <> 999999");
    expect(verif.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});
