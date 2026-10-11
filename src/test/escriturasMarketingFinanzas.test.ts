import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000100_escrituras_marketing_finanzas.sql"), "utf8");
const matrix = readFileSync(resolve(process.cwd(), "scripts/escrituras-marketing-finanzas-matrix.sql"), "utf8");

describe("P0.2: escrituras de marketing, finanzas e historial de stock", () => {
  it("las campañas y alertas exigen el permiso del módulo", () => {
    expect(migration).toContain("CREATE POLICY whatsapp_campaigns_crear ON public.whatsapp_campaigns FOR INSERT TO authenticated\n  WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));");
    expect(migration).toContain("USING (public.has_permission(org_id, 'marketing', 'delete'));");
    expect(migration).toContain("CREATE POLICY segment_campaigns_registrar ON public.segment_campaigns FOR INSERT TO authenticated\n  WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));");
    expect(migration).toContain("USING (public.has_permission(org_id, 'finance', 'edit'))");
    expect(migration).toContain("WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']));");
  });

  it("el CRM del vendedor sigue inscribiendo en automatizaciones (crear, no editar)", () => {
    expect(migration).toContain("public.has_permission(org_id, 'marketing', 'create') OR public.has_permission(org_id, 'crm', 'create')");
    expect(migration).not.toContain("'crm', 'edit'");
  });

  it("leer sigue igual para los miembros y no queda ninguna política «FOR ALL» de membresía", () => {
    expect(migration).toContain("CREATE POLICY whatsapp_campaigns_leer ON public.whatsapp_campaigns FOR SELECT TO authenticated\n  USING (public.is_org_member(org_id, auth.uid()));");
    expect(migration).toContain('DROP POLICY IF EXISTS "org members can manage whatsapp_campaigns"');
    expect(migration).toContain("DROP POLICY IF EXISTS finance_budget_alerts_org");
  });

  it("la matriz prueba vendedor, visualizador y dueño, y se revierte", () => {
    expect(matrix).toContain("ARRAY['vendedor', 'viewer', 'owner']");
    expect(matrix.trim().endsWith("ROLLBACK;")).toBe(true);
  });
});
