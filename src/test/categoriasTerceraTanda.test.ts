import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000000_categorias_gastronomia_autopartes_libreria.sql"), "utf8");
const filas = [...migration.matchAll(/^\s+\('(\w+)', '([^']+)', '[^']+', '(categoria|nombre)', '((?:[^']|'')+)', (\d+)\)/gm)];

describe("categorías por rubro: catálogo grande y muchos gastos (TESIS §4)", () => {
  it("carga gastronomía, autopartes y librería con menos de 20 reglas cada uno", () => {
    const porRubro = new Map<string, number>();
    for (const f of filas) porRubro.set(f[1], (porRubro.get(f[1]) ?? 0) + 1);
    expect([...porRubro.keys()].sort()).toEqual(["autopartes", "gastronomia", "libreria"]);
    for (const n of porRubro.values()) expect(n).toBeLessThan(20);
  });

  it("identificadores válidos y patrones sin letras que el texto comparable quita", () => {
    for (const f of filas) {
      expect(f[2]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f[4]).not.toMatch(/[áéíóúñü]/i);
    }
  });

  it("los plurales de palabras que terminan en consonante reconocen el singular", () => {
    const patrones = filas.map(f => f[4]).join(" ");
    for (const malo of ["amortiguadores?", "rulemanes?", "inyectores?", "lapices?", "marcadores?", "pinceles?", "pistones?", "retenes?"]) {
      expect(patrones).not.toContain(malo);
    }
    // Y corrige los de la tanda anterior sin recargarla.
    expect(migration).toContain("replace(replace(patron, 'mocasines?', 'mocasin(es)?'), 'cinturones?', 'cinturon(es)?')");
    expect(migration).toContain("replace(patron, 'pinceles? de maquillaje', 'pincel(es)? de maquillaje')");
  });
});
