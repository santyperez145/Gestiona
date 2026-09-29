import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260929000600_finance_expense_dimensions.sql",
  "utf8",
);

describe("dimensiones estructuradas de gastos Finance", () => {
  it("conserva centro, medio y solicitud como columnas", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS cost_center");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS payment_method");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS expense_request_id");
    expect(migration).toContain("expenses_request_once");
  });

  it("lleva las dimensiones al ledger y a la exportación existente", () => {
    expect(migration).toContain("'centro_costo', v_e.cost_center");
    expect(migration).toContain("'expense_request_id', v_e.expense_request_id");
    expect(migration).toContain("'payment_method', v_e.payment_method");
    const exportMigration = readFileSync(
      "supabase/migrations/20260925000100_finance_export_contable.sql",
      "utf8",
    );
    expect(exportMigration).toContain("l.metadata->>'centro_costo'");
  });

  it("el pago es idempotente por FK, no por texto de proveedor", () => {
    expect(migration).toContain("WHERE expense_request_id = v_req.id OR");
    expect(migration).toContain("v_req.cost_center");
    expect(migration).toContain("v_method, v_req.id");
  });
});
