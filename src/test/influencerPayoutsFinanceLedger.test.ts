import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260925012100_influencer_payouts_finance_ledger.sql"),
  "utf8",
);
const repair = readFileSync(
  resolve(root, "supabase/migrations/20260925012200_creator_withdrawal_finance_authority_repair.sql"),
  "utf8",
);
const sourceContract = readFileSync(
  resolve(root, "supabase/migrations/20260925012300_financial_movement_source_contract.sql"),
  "utf8",
);

describe("liquidaciones de creadores alineadas con Finance", () => {
  it("usa expenses como autoridad contable y no duplica financial_movements", () => {
    expect(migration).toContain("INSERT INTO public.expenses");
    expect(migration).toContain("trg_expense_ledger");
    expect(migration).not.toContain("INSERT INTO public.financial_movements");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal");
  });

  it("identifica cada retiro con una clave canónica e idempotente", () => {
    expect(migration).toContain("'influencer_withdrawal:' || withdrawal.id::text");
    expect(migration).toMatch(/AND NOT EXISTS \([\s\S]*FROM public\.expenses expense/);
  });

  it("completa sólo retiros pagados y conserva un responsable contable válido", () => {
    expect(migration).toContain("withdrawal.status = 'paid'");
    expect(migration).toContain("COALESCE(withdrawal.processed_by, member.user_id)");
    expect(migration).toContain("membership.role IN ('owner', 'admin')");
  });

  it("certifica que las liquidaciones operables quedaron enlazadas", () => {
    expect(migration).toContain("hay liquidaciones pagadas sin gasto Finance");
    expect(migration).toContain("expense.vendor = 'influencer_withdrawal:' || withdrawal.id::text");
  });

  it("la reparación posterior conserva webhook, transición y autoridad contable", () => {
    expect(repair).toContain("service_role_only_confirms_payments");
    expect(repair).toContain("v_row.status NOT IN ('pending', 'approved')");
    expect(repair).toContain("INSERT INTO public.expenses");
    expect(repair).toContain("TO authenticated, service_role");
  });

  it("un replay nuevo conserva el origen legacy creado durante la carrera", () => {
    expect(sourceContract).toContain("financial_movements_source_type_check");
    expect(sourceContract).toContain("'influencer_payment'");
  });
});
