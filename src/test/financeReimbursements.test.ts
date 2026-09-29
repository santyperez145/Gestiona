import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260929000700_finance_reimbursements.sql", "utf8");
const page = readFileSync("src/pages/FinanceSolicitudesPage.tsx", "utf8");

describe("reembolsos Finance", () => {
  it("cifra el destino y expone solo su mascara en la bandeja", () => {
    expect(migration).toContain("finance_reimbursement_destinations");
    expect(migration).toContain("public.secret_encrypt(v_identifier)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.finance_reimbursement_destinations");
    expect(page).toContain("payout_identifier_masked");
  });

  it("separa solicitud, aprobación y liquidación con evidencia", () => {
    expect(migration).toContain("finance_create_reimbursement_request");
    expect(migration).toContain("finance_settle_reimbursement");
    expect(migration).toContain("v_request.status NOT IN ('approved', 'paid')");
    expect(migration).toContain("payment_reference = left(v_reference, 160)");
    expect(migration).toContain("trg_finance_reimbursement_evidence");
    const segregation = readFileSync("supabase/migrations/20260929000710_finance_reimbursement_segregation.sql", "utf8");
    expect(segregation).toContain("Otro responsable debe aprobar este reembolso");
    expect(segregation).toContain("membership.user_id <> NEW.user_id");
  });

  it("la liquidación crea el gasto que dispara el ledger", () => {
    expect(migration).toContain("INSERT INTO public.expenses");
    expect(migration).toContain("expense_request_id");
    expect(page).toContain('rpc("finance_settle_reimbursement"');
  });
});
