import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260826000210_deals_por_cliente.sql");
const clientes = leer("src/pages/CustomersPage.tsx");

/**
 * `deals` era la sexta tabla del CRM, y cruzaba por nombre.
 *
 * CLAUDE.md afirmaba «ya no queda nada del CRM cruzando por nombre… el trigger
 * sirve hoy a cinco tablas». Medido el 2026-08-26: el trigger servía a
 * `sales`, `quotes`, `debts`, `loyalty_points` y `customer_communications`, y
 * `deals` no estaba — tenía `customer_name text` y ni la columna ni el
 * trigger. Es el caso que ya se verificó en las otras: con el mismo cliente
 * escrito de tres formas, la ficha muestra 1 de 3.
 */
describe("la identidad del cliente en deals", () => {
  it("deals tiene customer_id y apunta a customers", () => {
    expect(migracion).toContain("ADD COLUMN IF NOT EXISTS customer_id uuid");
    expect(migracion).toContain("REFERENCES public.customers(id)");
  });

  it("borrar un cliente desvincula la oportunidad, no la borra", () => {
    // Perder la oportunidad al borrar el cliente sería perder plata en curso.
    expect(migracion).toContain("ON DELETE SET NULL");
  });

  it("usa el trigger genérico, no una variante propia", () => {
    // Las otras cinco tablas ya lo usan. Una copia con su propia lógica es
    // exactamente cómo se separan dos verdades.
    expect(migracion).toContain("EXECUTE FUNCTION public.trg_sales_link_customer()");
    expect(migracion).toContain("BEFORE INSERT OR UPDATE ON public.deals");
  });

  it("la migración exige que ahora sean seis tablas", () => {
    expect(migracion).toContain("ASSERT v_n = 6");
  });

  it("los restos se cuentan por nombre exacto, no por prefijo", () => {
    // La base tiene 9 clientes `ZZ ...` de verificaciones anteriores sin
    // limpiar. Contarlos con `LIKE 'ZZ %'` hacía fallar esta migración por la
    // suciedad de otra.
    expect(migracion).toContain("WHERE name = 'ZZ Cliente De Prueba'");
    expect(migracion).not.toContain("WHERE name LIKE 'ZZ %'");
  });
});

describe("la ficha 360 muestra las oportunidades", () => {
  it("hay una tab de oportunidades", () => {
    expect(clientes).toContain('value="oportunidades"');
    expect(clientes).toContain("CustomerDealsTab");
  });

  it("lee por el mismo helper que presupuestos y comunicaciones", () => {
    // Dos consultas en vez de un `.or()`: el `or` de PostgREST se concatena en
    // una cadena y un nombre con coma o paréntesis lo rompe o lo convierte
    // calladamente en otro.
    expect(clientes).toMatch(/crmRowsForCustomer<any>\(\s*"deals"/);
    expect(clientes).toContain('table: "quotes" | "customer_communications" | "deals"');
  });

  it("las etapas se nombran como el CHECK de la base", () => {
    // Una etiqueta inventada muestra una etapa que la base no acepta.
    for (const etapa of ["lead", "contactado", "propuesta", "negociacion", "cerrado", "perdido"]) {
      expect(clientes).toMatch(new RegExp(`\\b${etapa}:`));
    }
  });

  it("una oportunidad perdida no cuenta como ganada", () => {
    expect(clientes).toContain('d.stage !== "cerrado" && d.stage !== "perdido"');
  });
});
