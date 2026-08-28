import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260828000160_las_funciones_internas_no_son_anonimas.sql",
  ),
  "utf8",
);

const INTERNAS = [
  "registrar_invocacion",
  "reconciliar_invocaciones",
  "podar_invocaciones",
  "cambios_de_precio_a_aplicar",
  "registrar_cambio_de_precio",
  "ia_registrar_consumo",
] as const;

function bloqueDeFuncion(nombre: string): string {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}`);
  const siguiente = sql.indexOf("CREATE OR REPLACE FUNCTION public.", inicio + 1);
  return sql.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

describe("funciones internas fuera del navegador", () => {
  it.each(INTERNAS)("%s tiene una guarda interna de backend", nombre => {
    const bloque = bloqueDeFuncion(nombre);
    expect(bloque).not.toBe("");
    expect(bloque).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(bloque).toContain("session_user IN ('postgres', 'supabase_admin')");
    expect(bloque).toContain("insufficient_privilege");
  });

  it.each(INTERNAS)("%s revoca los dos roles del navegador", nombre => {
    // `FROM PUBLIC` solo no alcanza: en la base había grants directos a anon y
    // authenticated. La regresión que cerramos fue exactamente esa diferencia.
    const revocacion = new RegExp(
      `REVOKE ALL ON FUNCTION public\\.${nombre}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`,
    );
    const grant = new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${nombre}\\([\\s\\S]*?TO service_role;`,
    );
    expect(sql).toMatch(revocacion);
    expect(sql).toMatch(grant);
  });

  it("anon no enumera roles heredados", () => {
    for (const helper of ["platform_role", "has_role", "get_user_role"]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${helper}\\([\\s\\S]*?FROM PUBLIC, anon;`,
        ),
      );
    }
  });

  it("el cálculo puro de precio no mantiene roja la guarda de costo público", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.precio_sugerido\([\s\S]*?FROM PUBLIC, anon;/,
    );
    expect(sql).toContain("audit_costo_expuesto no quedó vacía");
  });
});
