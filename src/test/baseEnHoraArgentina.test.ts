import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diaAR, diaARMas } from "../../supabase/functions/_shared/fechaAR";

describe("la base y el servidor trabajan con el día argentino", () => {
  it("la base queda en hora argentina, y si no puede, los roles que abren sesión", () => {
    const sql = readFileSync("supabase/migrations/20261030001800_base_en_hora_argentina.sql", "utf8");
    expect(sql).toContain("EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Argentina/Buenos_Aires');");
    expect(sql).toContain("EXCEPTION WHEN insufficient_privilege THEN");
    expect(sql).toContain("ARRAY['authenticator', 'authenticated', 'anon', 'service_role', 'postgres']");
    expect(sql).toContain("SET timezone TO 'America/Argentina/Buenos_Aires';");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8"))
      .toContain("'20261030001800': 'scripts/base-en-hora-argentina-matrix.sql'");
  });

  it("las funciones del servidor cuentan el día como en Argentina", () => {
    // Las 22:30 del 31/10 en Argentina son las 01:30 UTC del 1/11.
    expect(diaAR(new Date("2026-11-01T01:30:00Z"))).toBe("2026-10-31");
    expect(diaARMas(-1, Date.parse("2026-11-01T01:30:00Z"))).toBe("2026-10-30");
    expect(diaARMas(30, new Date("2026-10-31T12:00:00Z"))).toBe("2026-11-30");
    expect(diaAR(Number.NaN)).toBe("");
  });
});
