import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("funciones internas sin ejecución desde la app", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001900_funciones_internas_sin_usuarios.sql"), "utf8");
  it("avisar_a_los_que_mandan y aplicar_limites_del_plan quedan sólo para el servidor", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.aplicar_limites_del_plan(uuid) FROM PUBLIC, anon, authenticated;");
  });
  it("ninguna pantalla las llama directo", async () => {
    const { execSync } = await import("node:child_process");
    let usos = "";
    try {
      usos = execSync('git grep -l -e "avisar_a_los_que_mandan" -e "aplicar_limites_del_plan" -- src ":!src/integrations" ":!src/test"', { encoding: "utf8" }).trim();
    } catch {
      usos = ""; // git grep sale con 1 cuando no encuentra nada: es lo esperado.
    }
    expect(usos).toBe("");
  });
});
