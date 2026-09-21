// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { navRoutes } from "@/app/routeManifest";

const ROOT = resolve(__dirname, "../..");
const MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20260921000300_growth_programs_security.sql"), "utf8");
const AFFILIATES = readFileSync(resolve(ROOT, "src/pages/AffiliateProgramPage.tsx"), "utf8");
const REFERRALS = readFileSync(resolve(ROOT, "src/pages/ReferralsPage.tsx"), "utf8");

describe("Afiliados y Referidos son canales reales y separados", () => {
  it("ambos son alcanzables desde Marketing sin mezclarse con Influencers", () => {
    const routes = navRoutes();
    expect(routes.find(route => route.path === "/afiliados")?.module).toBe("marketing");
    expect(routes.find(route => route.path === "/referidos")?.module).toBe("marketing");
    expect(routes.find(route => route.path === "/afiliados")?.productSurface).toBeUndefined();
  });

  it("las políticas distinguen lectura, alta, edición y baja por permiso", () => {
    for (const action of ["view", "create", "edit", "delete"]) {
      expect(MIGRATION).toContain(`'marketing', '${action}'`);
    }
    expect(MIGRATION).toContain("customer_referrals_edit");
    expect(MIGRATION).toContain("affiliate_payout_prepare");
  });

  it("preparar una liquidación es atómico y no se presenta como pago ejecutado", () => {
    expect(MIGRATION).toContain("FOR UPDATE");
    expect(MIGRATION).toContain("Ya existe una liquidación pendiente");
    expect(AFFILIATES).toContain('(supabase.rpc as any)("affiliate_payout_prepare"');
    expect(AFFILIATES).toContain("El pago externo continúa pendiente");
    expect(AFFILIATES).not.toContain('.from("affiliate_payouts").insert');
  });

  it("las mutaciones del navegador conservan el filtro de organización", () => {
    expect(AFFILIATES).toContain('.eq("org_id", orgId).eq("id", partner.id)');
    expect(REFERRALS).toContain('.eq("org_id", activeOrg.id).eq("id", id)');
  });
});
