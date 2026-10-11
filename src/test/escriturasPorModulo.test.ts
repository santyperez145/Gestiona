import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001600_escrituras_por_modulo.sql"), "utf8");

describe("P0.2: escrituras por módulo", () => {
  it("cada tabla pasa a exigir el permiso del módulo para crear, editar y borrar", () => {
    for (const [tabla, modulo] of [
      ["customers", "customers"], ["payment_links", "payments"], ["email_campaigns", "marketing"],
      ["automation_flows", "marketing"], ["quotes", "sales"], ["alert_rules", "settings"],
    ]) expect(sql).toContain(`('${tabla}', '${modulo}', `);
    expect(sql).toContain("FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, %L, ''create''))");
    expect(sql).toContain("FOR DELETE TO authenticated USING (public.has_permission(org_id, %L, ''delete''))");
  });

  it("leer sigue igual para cualquier miembro", () => {
    expect(sql).toContain("FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))");
  });

  it("lo que queda fuera está dicho", () => {
    expect(sql).toContain("Fuera de esta vuelta, a propósito: tasks, deals y deal_outcomes");
  });
});
