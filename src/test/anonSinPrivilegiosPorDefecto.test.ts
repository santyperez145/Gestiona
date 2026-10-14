import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ADR 006, acción 3: anon fuera de los privilegios por defecto de tablas,
// vistas y secuencias. Probado en vivo con `scripts/anon-sin-privilegios-matrix.sql`
// (2026-10-13): sin la migración, una tabla nueva nacía con todo para anon.
const sql = fs.readFileSync("supabase/migrations/20261013000900_anon_sin_privilegios_por_defecto.sql", "utf8");

describe("anon sin privilegios por defecto", () => {
  it("revoca tablas (incluye vistas) y secuencias para objetos de postgres en public", () => {
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON TABLES FROM anon;/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON SEQUENCES FROM anon;/);
  });

  it("no le saca nada a authenticated: lo cuidan RLS e invoker", () => {
    expect(sql).not.toMatch(/FROM\s+(anon,\s*)?authenticated/);
  });

  it("el ADR registra la acción como hecha", () => {
    expect(fs.readFileSync("docs/ADR_006_FRONTERA_ENTRE_NEGOCIOS.md", "utf8")).toMatch(/3\. \[x\] `ALTER DEFAULT PRIVILEGES/);
  });
});
