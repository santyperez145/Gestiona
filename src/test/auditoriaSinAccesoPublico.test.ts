import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("vistas de auditoría sin acceso para la app", () => {
  it("audit_rubro_adivinado queda como las demás: ni anónimos ni usuarios", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001800_auditoria_sin_acceso_publico.sql"), "utf8");
    expect(sql).toContain("REVOKE ALL ON public.audit_rubro_adivinado FROM PUBLIC, anon, authenticated;");
  });
});
