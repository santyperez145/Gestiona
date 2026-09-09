import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  expenseBudgetMap,
  expenseBudgetPeriod,
  expenseBudgetSpendByCategory,
} from "@/lib/financeBudgets";

const root = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260908000100_expense_budgets_authority.sql");
const page = read("src/pages/ExpensesPage.tsx");
const service = read("src/lib/financeBudgets.ts");

describe("autoridad de presupuestos de gastos", () => {
  it("acepta solamente períodos mensuales válidos", () => {
    expect(expenseBudgetPeriod("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(expenseBudgetPeriod("2026-13")).toBeNull();
    expect(expenseBudgetPeriod("all")).toBeNull();
  });

  it("calcula el ejecutado por mes sin depender de filtros visuales", () => {
    expect(expenseBudgetSpendByCategory([
      { date: "2026-09-01", category: "servicios", amount_ars: 1250 },
      { date: "2026-09-30", category: "servicios", amount_ars: "750.50" },
      { date: "2026-09-15", category: "marketing", amount_ars: 300 },
      { date: "2026-08-31", category: "servicios", amount_ars: 9000 },
      { date: "2026-09-20", category: "", amount_ars: 100 },
      { date: "2026-09-20", category: "otros", amount_ars: "invalido" },
    ], { year: 2026, month: 9 })).toEqual({
      servicios: 2000.5,
      marketing: 300,
    });
  });

  it("normaliza los montos recibidos desde Postgres", () => {
    expect(expenseBudgetMap([
      {
        budget_id: "budget-1",
        category_key: "logistica",
        category_name: "Logística",
        amount: 0,
        notes: null,
        updated_at: "2026-09-08T00:00:00Z",
      },
    ])).toEqual({ logistica: 0 });
  });

  it("protege lectura y edición por organización, permiso y RPC", () => {
    expect(migration).toContain("public.has_permission(p_org_id, 'expenses', 'view')");
    expect(migration).toContain("public.has_permission(p_org_id, 'expenses', 'edit')");
    expect(migration).toContain("budget_categories_source_key_unique");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.budgets FROM anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_expense_budgets");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.set_expense_budget");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(service).toContain('supabase.rpc("get_expense_budgets"');
    expect(service).toContain('supabase.rpc("set_expense_budget"');
  });

  it("elimina el presupuesto local y presenta una única vista canónica", () => {
    expect(page).not.toContain("gestiona.expense_budgets");
    expect(page).toContain("expenseBudgetSpendByCategory(expenses, selectedBudgetPeriod)");
    expect(page).toContain("const historicalKeys = new Set");
    expect(page).toContain("budgetRows.map(category =>");
    expect(page).toContain("Tu rol tiene acceso de consulta");
    expect(page).toContain("void loadBudgets()");
    expect(page).toContain('next.set("vista", "presupuesto")');
    expect(page).toContain('next.set("periodo", month)');
  });
});
