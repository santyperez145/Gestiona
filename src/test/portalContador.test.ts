import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal del contador: acceso fiscal, separado del equipo", () => {
  const sql = readFileSync("supabase/migrations/20261030000100_portal_contador.sql", "utf8");

  it("el contador no es miembro y nadie lee la tabla de accesos directo", () => {
    expect(sql).toContain("REVOKE ALL ON public.contadores_de_negocio FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/INSERT INTO public\.memberships/);
  });

  it("invita y revoca sólo el dueño o un administrador; acepta sólo el email invitado", () => {
    expect(sql).toContain("RAISE EXCEPTION 'Sólo el dueño o un administrador invita al contador'");
    expect(sql).toContain("IF v_email IS DISTINCT FROM v_fila.email THEN");
    expect(sql).toContain("RAISE EXCEPTION 'La invitación venció: pedile al negocio que te la reenvíe'");
  });

  it("los datos fiscales sólo para el contador vigente, y cada descarga queda auditada", () => {
    expect(sql).toContain("IF NOT public.es_contador_de(p_org) THEN");
    expect(sql).toContain("VALUES (auth.uid(), p_org, 'export', 'paquete_contador', NULL");
  });
});
