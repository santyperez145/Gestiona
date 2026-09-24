import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const solicitudesPage = readFileSync(resolve(root, "src/pages/FinanceSolicitudesPage.tsx"), "utf8");
const rejectMigration = readFileSync(
  resolve(root, "supabase/migrations/20260922000700_expense_request_notifications.sql"),
  "utf8"
);

describe("paridad Mendel: gestión y trazabilidad de solicitudes de gasto", () => {
  it("mapea los estados de la base (pending, under_review, approved, rejected) a los contadores de la UI", () => {
    // El bug anterior usaba `c[r.status] += 1` que buscaba nombres en español
    // dejando todos los contadores de la card en 0.
    expect(solicitudesPage).toContain('if (r.status === "pending") c.pendiente += 1;');
    expect(solicitudesPage).toContain('else if (r.status === "under_review") c.bajo_revision += 1;');
    expect(solicitudesPage).toContain('else if (r.status === "approved") c.aprobado += 1;');
    expect(solicitudesPage).toContain('else if (r.status === "rejected") c.rechazado += 1;');
  });

  it("el filtro por vista traduce las pestañas en español al estado real en la base", () => {
    // El bug anterior hacía `r.status === inboxView` que nunca matcheaba
    // porque `inboxView` era "pendiente" y en la base era "pending".
    expect(solicitudesPage).toContain('pendiente: "pending"');
    expect(solicitudesPage).toContain('"en revisión": "under_review"');
    expect(solicitudesPage).toContain('aprobado: "approved"');
    expect(solicitudesPage).toContain('rechazado: "rejected"');
    expect(solicitudesPage).toContain("const targetStatus = VIEW_MAP[inboxView];");
  });

  it("el rechazo solicita motivo al usuario y lo pasa a finance_reject_expense_request", () => {
    expect(solicitudesPage).toContain("handleConfirmReject");
    expect(solicitudesPage).toContain('"finance_reject_expense_request"');
    expect(solicitudesPage).toContain("p_reason: rejectReason.trim() || null");
    expect(solicitudesPage).toContain("Motivo del rechazo (opcional)");
    expect(rejectMigration).toContain("p_reason TEXT DEFAULT NULL");
  });
});
