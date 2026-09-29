import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Go-Marz × Mendel: la liquidación del influencer es un gasto real.
 *
 * ── Por qué existe este test ─────────────────────────────────────────────
 * Dos defectos medidos, uno por superficie:
 *   · P0 — `resolve_creator_withdrawal` exigía auth.uid(), pero el webhook
 *     firmado de Mercado Pago y el sync la llaman con service role (auth.uid
 *     NULL). El pago quedaba 'pending' para siempre: cobro y comisión mentían.
 *   · Finance — el pago al creador no existía como gasto: el P&L y el
 *     presupuesto lo ignoraban. Mendel cierra el circuito con asiento real.
 */

const ROOT = resolve(__dirname, "../..");

function leer(nombre: string): string {
  // Las migraciones se citan por nombre; el resto, ruta completa.
  return readFileSync(
    resolve(ROOT, nombre.endsWith(".sql") ? "supabase/migrations" : "", ...nombre.split("/")),
    "utf8",
  );
}

const MIGRACION = "20260925001600_influencer_settlement_finance_link.sql";
const SYNC = leer("supabase/functions/_shared/mpPayoutsSync.ts");

describe("liquidación de influencers enlazada a Finance", () => {
  it("la migración existe y repara la autoridad del webhook", () => {
    expect(existsSync(resolve(ROOT, "supabase", "migrations", MIGRACION))).toBe(true);
    const sql = leer(MIGRACION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal");
    // Service role puede confirmar pagos; sin JWT y sin service role no entra.
    expect(sql).toContain("v_is_service");
    expect(sql).toContain("TO authenticated, service_role");
    // El servicio sólo confirma: aprobar/rechazar sigue siendo humano.
    expect(sql).toContain("service_role_only_confirms_payments");
  });

  it("cada liquidación escribe el gasto real con trazabilidad idempotente", () => {
    const sql = leer(MIGRACION);
    expect(sql).toContain("INSERT INTO public.expenses");
    expect(sql).toContain("influencer_withdrawal:");
    expect(sql).toContain("WHERE NOT EXISTS");
  });

  it("el gasto entra al libro por el trigger existente (sin ETL extra)", () => {
    // trg_expense_ledger asienta todo gasto nuevo; el enlace usa expenses,
    // así que P&L, presupuesto y libro mayor ven el costo del creador.
    const trigger = leer("20260826000290_toda_venta_nueva_se_asienta.sql");
    expect(trigger).toContain("trg_expense_ledger");
    expect(trigger).toContain("AFTER INSERT ON public.expenses");
  });

  it("el sync de Mercado Pago liquida con la referencia externa", () => {
    expect(SYNC).toContain('rpc("settle_creator_withdrawal"');
    expect(SYNC).toContain('p_payment_reference');
    expect(SYNC).toContain('p_payment_method: "mercadopago"');
  });

  it("service role nunca decide aprobaciones: sólo confirma pagos", () => {
    const sql = leer(MIGRACION);
    expect(sql).toContain("v_is_service AND p_status <> 'paid'");
    expect(sql).toContain("v_row.status NOT IN ('pending', 'approved')");
    expect(sql).toContain("DROP POLICY IF EXISTS withdrawals_org_read");
  });
});
