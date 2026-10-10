import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "test" ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta.replaceAll("\\", "/")] : [];
  });
}

describe("realtime por Broadcast desde la base", () => {
  it("ninguna pantalla usa Postgres Changes: la publicación quedó sin tablas", () => {
    const usan = archivos("src").filter(ruta => readFileSync(ruta, "utf8").includes("postgres_changes"));
    expect(usan).toEqual([]);
  });

  it("los avisos van por sentencia, a topics privados y sin romper la escritura", () => {
    const sql = readFileSync("supabase/migrations/20261010001100_realtime_broadcast.sql", "utf8");
    expect(sql).toContain("FOR EACH STATEMENT EXECUTE FUNCTION public.rt_aviso_ventas()");
    expect(sql).toContain("public.is_org_member(substr(realtime.topic(), 5)::uuid, auth.uid())");
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE");
    const cliente = readFileSync("src/lib/orgRealtime.ts", "utf8");
    expect(cliente).toContain("{ config: { private: true } }");
  });
});
