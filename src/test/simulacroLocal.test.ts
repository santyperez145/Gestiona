import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cuerpoDeMatriz, esLocal, leerFinal } from "../../scripts/simulacro-local.mjs";

describe("simulacro de matrices en una base local", () => {
  it("se niega a correr contra una base que no es local", () => {
    expect(esLocal("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe(true);
    expect(esLocal("postgresql://postgres:x@localhost:5432/postgres")).toBe(true);
    expect(esLocal("postgresql://postgres.hummeopatkniwkyrrhwc:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")).toBe(false);
    expect(esLocal("no es una url")).toBe(false);
  });

  it("sólo cuenta como bien el RAISE 'OK' del final de la matriz", () => {
    expect(leerFinal({ message: "OK 1 2 3" }).ok).toBe(true);
    expect(leerFinal({ message: "FALLA 2a: aceptó la situación 3" }).ok).toBe(false);
    expect(leerFinal(null)).toMatchObject({ ok: false, detalle: expect.stringMatching(/sin RAISE/) });
  });

  it("deja la transacción en manos del script", () => {
    expect(cuerpoDeMatriz("DO $$ BEGIN RAISE EXCEPTION 'OK'; END $$;\nROLLBACK;\n")).not.toMatch(/ROLLBACK/);
  });

  it("CI aplica todas las migraciones desde cero antes de las matrices", () => {
    const wf = readFileSync(".github/workflows/simulacro-migraciones.yml", "utf8");
    expect(wf).toContain("npx supabase start");
    expect(wf).toContain("node scripts/simulacro-local.mjs");
    expect(wf).toContain('"supabase/migrations/**"');
  });
});
