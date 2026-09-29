import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260929000800_finance_advances.sql", "utf8");
const page = readFileSync("src/pages/FinanceSolicitudesPage.tsx", "utf8");

describe("anticipos Finance", () => {
  it("desembolsa como activo y no como gasto", () => {
    expect(migration).toContain("'1.2.02', 'Anticipos a rendir'");
    expect(migration).toContain("'anticipo_desembolso'");
    expect(migration).toContain("finance_disburse_advance");
  });

  it("rinde comprobantes y devuelve sobrantes de forma idempotente", () => {
    expect(migration).toContain("finance_render_advance_expense");
    expect(migration).toContain("finance_return_advance_balance");
    expect(migration).toContain("finance_advance_items_evidence_once");
    expect(migration).toContain("advance_request_id");
  });

  it("conecta el ciclo completo a la bandeja existente", () => {
    expect(page).toContain('rpc("finance_create_advance_request"');
    expect(page).toContain('rpc("finance_advance_summary"');
    expect(page).toContain('rpc("finance_render_advance_expense"');
    expect(page).toContain('rpc("finance_return_advance_balance"');
  });
});
