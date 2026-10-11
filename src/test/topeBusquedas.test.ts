import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("tope de términos de búsqueda por día", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002300_tope_de_busquedas_por_dia.sql"), "utf8");
  it("las cuatro funciones públicas consultan el tope antes de crear una fila", () => {
    expect(sql.match(/_busquedas_del_dia_llenas\(v\.org_id, 'con_resultado'\)/g)?.length).toBe(3);
    expect(sql).toContain("public._busquedas_del_dia_llenas(v_org, 'sin_resultado')");
    expect(sql).toContain("RETURN v_n >= 2000;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._busquedas_del_dia_llenas(uuid, text) FROM PUBLIC, anon, authenticated;");
  });
});
