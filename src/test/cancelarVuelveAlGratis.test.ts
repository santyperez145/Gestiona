import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const leer = (ruta: string) => readFileSync(ruta, "utf8");
const migracion = leer("supabase/migrations/20261010001600_cancelar_vuelve_al_gratis.sql");

describe("cancelar el plan pago vuelve solo al plan gratis", () => {
  it("la base resuelve una baja como el plan Inicial, sin motivo de corte propio", () => {
    expect(migracion).toMatch(/v_sub\.status = 'canceled' THEN[\s\S]*?v_plan := v_base;[\s\S]*?v_vigente := true;/);
    expect(migracion).not.toContain("v_motivo := 'cancelado'");
    expect(migracion).toContain("'estado', 'plan_gratis'");
  });

  it("ninguna pantalla dice «Tu suscripción está cancelada»", () => {
    for (const ruta of ["src/components/AppLayout.tsx", "src/pages/Dashboard.tsx", "supabase/functions/_shared/entitlements.ts"]) {
      expect(leer(ruta)).not.toMatch(/suscripción está cancelada/);
    }
    expect(leer("src/pages/MiPlanPage.tsx")).toContain("sub?.estado === 'plan_gratis'");
  });
});
