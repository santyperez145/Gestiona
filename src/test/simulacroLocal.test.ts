import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cuerpoDeMatriz, esLocal, leerFinal } from "../../scripts/simulacro-local.mjs";
import { contexto } from "../../scripts/reproducir-migraciones.mjs";

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

  it("ubica el error de Postgres en la migración", () => {
    expect(contexto("SELECT 1;\nSELECT nada;", 18, 5)).toEqual({ linea: 2, texto: "LECT nada;" });
  });

  it("deja la transacción en manos del script", () => {
    expect(cuerpoDeMatriz("DO $$ BEGIN RAISE EXCEPTION 'OK'; END $$;\nROLLBACK;\n")).not.toMatch(/ROLLBACK/);
  });

  it("CI aplica todas las migraciones desde cero antes de las matrices", () => {
    const wf = readFileSync(".github/workflows/simulacro-migraciones.yml", "utf8");
    expect(wf).toContain("npx supabase start --workdir");
    expect(wf).toContain("node scripts/reproducir-migraciones.mjs");
    expect(wf).toContain("node scripts/simulacro-local.mjs");
    expect(wf).toContain('"supabase/migrations/**"');
  });
});

describe("semilla del E2E local", () => {
  const fuente = readFileSync("scripts/semilla-e2e-local.mjs", "utf8");
  it("se niega a sembrar fuera de una base local y no imprime la contraseña", () => {
    expect(fuente).toContain("if (!esLocal(db) || !esLocal(api))");
    expect(fuente).toContain("::add-mask::${password}");
    expect(fuente).not.toMatch(/console\.log\([^)]*\$\{password\}[^)]*Semilla/);
  });

  it("el workflow corre el panel contra la base local, no contra producción", () => {
    const wf = readFileSync(".github/workflows/e2e-local.yml", "utf8");
    expect(wf).toContain("VITE_SUPABASE_URL=$SUPABASE_LOCAL_URL");
    expect(wf).toContain("SUPABASE_LOCAL_URL: http://127.0.0.1:54321");
    expect(wf).not.toContain("secrets.");
  });
});
