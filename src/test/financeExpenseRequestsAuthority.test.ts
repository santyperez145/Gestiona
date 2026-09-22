import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919000100_expense_requests_authority.sql"),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "src/pages/FinanceSolicitudesPage.tsx"),
  "utf8",
);

describe("autoridad de solicitudes de gasto (paridad Mendel F5.2)", () => {
  it("crea la tabla con RLS y columnas de auditoría de aprobación", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.finance_expense_requests");
    expect(migration).toContain("approved_by UUID REFERENCES auth.users(id)");
    expect(migration).toContain("approved_at TIMESTAMPTZ");
    expect(migration).toContain("rejection_reason TEXT");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("la RLS usa membresía real y no compara org_id con auth.uid", () => {
    expect(migration).toContain("public.is_org_member(org_id, auth.uid())");
    expect(migration).not.toMatch(/\borg_id\s*=\s*auth\.uid\(\)/);
  });

  it("las funciones que hacen UPDATE son VOLATILE y tienen SECURITY DEFINER", () => {
    expect(migration).toMatch(/finance_approve_expense_request[\s\S]{0,120}VOLATILE/);
    expect(migration).toMatch(/finance_reject_expense_request[\s\S]{0,120}VOLATILE/);
    expect(migration).toContain("SECURITY DEFINER");
  });

  it("aprobar exige permisos de edición o rol owner/admin", () => {
    expect(migration).toContain("v_role NOT IN ('owner', 'admin')");
    expect(migration).toContain("public.has_permission(v_req.org_id, 'expenses', 'edit')");
  });

  it("la UI usa las RPCs de aprobación y rechazo y no hace UPDATE directo en la tabla", () => {
    expect(page).toContain('rpc("finance_approve_expense_request"');
    expect(page).toContain('rpc("finance_reject_expense_request"');
    expect(page).toContain('rpc("finance_create_expense_request"');
    expect(page).not.toMatch(/\.from\(["']finance_expense_requests["']\)\s*\.update\(/);
  });
});
