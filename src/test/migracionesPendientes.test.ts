import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MATRICES, cuerpoDeMigracion, migracionesLocales } from "../../scripts/migraciones-pendientes.mjs";

// 2026-10-22: con la base inactiva se acumularon migraciones; al volver se
// aplican con este script, que exige una matriz por cada una.
describe("migraciones pendientes", () => {
  it("cada migración con matriz existe y su matriz termina en OK y ROLLBACK", () => {
    const locales = new Set(migracionesLocales().map((m: { version: string }) => m.version));
    for (const [version, matriz] of Object.entries(MATRICES as Record<string, string>)) {
      expect(locales.has(version), version).toBe(true);
      expect(existsSync(matriz), matriz).toBe(true);
      const texto = readFileSync(matriz, "utf8");
      expect(texto, matriz).toMatch(/RAISE EXCEPTION 'OK/);
      expect(texto, matriz).toMatch(/ROLLBACK;\s*$/);
    }
  });

  it("toda migración posterior a 2026-10-21 tiene matriz", () => {
    const nuevas = migracionesLocales().filter((m: { version: string }) => m.version >= "20261021000000");
    for (const m of nuevas) expect((MATRICES as Record<string, string>)[m.version], `${m.version}_${m.nombre}`).toBeTruthy();
  });

  it("el simulacro saca el BEGIN/COMMIT de nivel superior y nada más", () => {
    expect(cuerpoDeMigracion("BEGIN;\nSELECT 1;\n  COMMIT;\nDO $$ BEGIN PERFORM 1; END $$;")).toBe("SELECT 1;\nDO $$ BEGIN PERFORM 1; END $$;");
  });
});
