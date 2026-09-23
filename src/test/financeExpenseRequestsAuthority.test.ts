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

describe("notificaciones del ciclo de solicitudes (F3, paridad Mendel)", () => {
  const notifications = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260922000700_expense_request_notifications.sql"),
    "utf8",
  );

  it("crear notifica a los aprobadores dentro de la misma transacción", () => {
    // La notificación vive adentro del RPC de autoridad: si la solicitud se
    // crea, la campana suena; si falla, no hay notificación huérfana.
    expect(notifications).toContain("finance_notify_approvers");
    expect(notifications).toContain("'Nueva solicitud de gasto'");
    expect(notifications).toContain("p_exclude_user");
  });

  it("aprobar y rechazar le avisan al solicitante, no al que decide", () => {
    // v_req.user_id <> auth.uid(): el que decide no se notifica a sí mismo.
    expect(notifications).toContain("v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid()");
    expect(notifications).toContain("'Solicitud aprobada'");
    expect(notifications).toContain("'Solicitud rechazada'");
    // El rechazo arrastra el motivo, que es lo que el solicitante necesita.
    expect(notifications).toContain("left(p_reason, 300)");
  });

  it("una notificación que falla no bloquea la decisión financiera", () => {
    // Si INSERT en notifications falla, la aprobación ya se hizo y se registra
    // el warning: la plata no se detiene por un fallo de campana.
    expect(notifications).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]{0,120}RAISE WARNING/);
  });

  it("el helper de notificación exige membresía como cualquier SECURITY DEFINER", () => {
    expect(notifications).toContain("finance_notify_approvers(");
    // La guardia de membresía está en el cuerpo del helper, junto al INSERT.
    expect(notifications).toMatch(/IF NOT public\.is_org_member\(p_org_id, auth\.uid\(\)\) THEN[\s\S]{0,300}INSERT INTO public\.notifications/);
    expect(notifications).toContain("REVOKE ALL ON FUNCTION public.finance_notify_approvers");
  });
});
