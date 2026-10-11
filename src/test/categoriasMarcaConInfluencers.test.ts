import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010003100_categorias_marca_con_influencers.sql"), "utf8");
const filas = [...migration.matchAll(/^\s+\('(\w+)', '([^']+)', '[^']+', '(categoria|nombre)', '((?:[^']|'')+)', (\d+)\)/gm)];

describe("categorías por rubro: puerta «marca con influencers» (TESIS §4)", () => {
  it("carga cosmética e indumentaria y deja perfumería como la armó el comercio", () => {
    const rubros = new Set(filas.map(f => f[1]));
    expect([...rubros].sort()).toEqual(["cosmetica", "indumentaria"]);
    expect(migration).toContain("Perfumería queda afuera a propósito");
    expect(migration).toContain("DELETE FROM public.rubro_reglas_categoria WHERE industry_code IN ('cosmetica', 'indumentaria');");
  });

  it("cada rubro queda por debajo de 20 reglas (quedan compiladas en memoria)", () => {
    const porRubro = new Map<string, number>();
    for (const f of filas) porRubro.set(f[1], (porRubro.get(f[1]) ?? 0) + 1);
    for (const n of porRubro.values()) expect(n).toBeLessThan(20);
  });

  it("los identificadores cumplen el formato de la tabla y los patrones no usan letras que el texto comparable quita", () => {
    for (const f of filas) {
      expect(f[2]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f[4]).not.toMatch(/[áéíóúñü]/i);
    }
  });

  it("las reglas por categoría están ancladas al nombre completo", () => {
    for (const f of filas.filter(x => x[3] === "categoria")) expect(f[4]).toMatch(/^\^\(.*\)\$$/);
  });
});
