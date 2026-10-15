import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14: el egreso de un gasto lo anotaba el navegador aparte y editar o
// borrar el gasto lo dejaba desparejo; los gastos del servidor nunca llegaban
// a Movimientos. Ahora lo mantiene la base (scripts/egreso-de-cada-gasto-matrix.sql).
describe("el egreso de cada gasto lo mantiene la base", () => {
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
  it("el navegador ya no escribe Movimientos", () => {
    expect(store).not.toContain("recordFinancialMovement");
    expect(store).not.toMatch(/from\(['"]financial_movements['"]\)\s*\.insert/);
  });
  it("el disparador cubre alta, edición y baja", () => {
    const m = fs.readFileSync("supabase/migrations/20261014002600_egreso_de_cada_gasto.sql", "utf8");
    expect(m).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.expenses");
  });
});
