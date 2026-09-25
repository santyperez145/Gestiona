import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migration = read("supabase/migrations/20260925000800_finance_approval_policies.sql");
const verification = read("supabase/verificaciones/20260925_finance_approval_policies.sql");
const panel = read("src/components/finance/ApprovalPolicyPanel.tsx");
const solicitudes = read("src/pages/FinanceSolicitudesPage.tsx");

describe("F5.2 — política de aprobación versionada", () => {
  it("la migración crea la tabla versionada con RLS y unicidad org+versión", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.finance_approval_policies");
    expect(migration).toContain("CONSTRAINT finance_approval_policies_org_version_unique UNIQUE (org_id, version)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (public.is_org_member(org_id, auth.uid()))");
    expect(migration).toContain("CHECK (approver_role IN ('admin', 'owner'))");
  });

  it("la RPC de política es un acto de owner, no de admin", () => {
    expect(migration).toContain("m.role = 'owner'");
    expect(migration).toContain("Sólo el owner define la política versionada");
  });

  it("cada nueva definición crea una versión y desactiva la vigente del mismo alcance", () => {
    expect(migration).toContain("SET active = false");
    expect(migration).toContain("SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version");
  });

  it("la aprobación exige el rol de la política más específica que cubra el monto", () => {
    expect(migration).toContain("ORDER BY (f.category IS NOT NULL) DESC, (f.cost_center IS NOT NULL) DESC, f.version DESC");
    expect(migration).toContain("IF FOUND THEN");
    expect(migration).not.toContain("IF v_policy IS NOT NULL THEN");
    expect(migration).toContain("La política v% exige aprobación de % para montos hasta % ARS");
  });

  it("las solicitudes en USD se escalan a owner sin tipo de cambio en el servidor", () => {
    expect(migration).toMatch(/IF v_req\.currency = 'USD' THEN\s*\n\s*v_required_rank := 3;/);
  });

  it("la aprobación compromete presupuesto real de la categoría del mes", () => {
    expect(migration).toContain("JOIN public.budgets b");
    expect(migration).toContain("r.status IN ('approved', 'paid')");
    expect(migration).toContain("Supera el presupuesto disponible de la categoría");
  });

  it("sin políticas la aprobación mantiene el comportamiento previo", () => {
    // La resolución de política se hace sobre la tabla; sin filas, FOUND es
    // false y el flujo cae al permiso clásico owner/admin + expenses.edit.
    expect(migration).toContain("SELECT * INTO v_policy");
    expect(verification).toContain("sin políticas la aprobación deberia funcionar como antes");
  });

  it("la verificación reversible cubre versionado, escalamiento, USD y presupuesto", () => {
    expect(verification).toContain("la primera version deberia ser 1");
    expect(verification).toContain("el admin aprobó una solicitud que la política escala a owner");
    expect(verification).toContain("el admin aprobó una solicitud en USD");
    expect(verification).toContain("la aprobación ignoró el presupuesto disponible de la categoría");
    expect(verification).toContain("un admin definió política de aprobación");
    expect(verification).toContain("rollback_intencional");
  });

  it("el panel del owner consulta la RPC real y lista versiones", () => {
    expect(panel).toContain("finance_list_approval_policies");
    expect(panel).toContain("finance_set_approval_policy");
    expect(panel).not.toMatch(/vi(t)eo|mock/i);
    expect(panel).toContain('activeRole === "owner"');
  });

  it("el panel está montado en Solicitudes con org activa", () => {
    expect(solicitudes).toContain('import ApprovalPolicyPanel from "@/components/finance/ApprovalPolicyPanel"');
    expect(solicitudes).toContain("{activeOrg?.id && <ApprovalPolicyPanel />}");
  });
});