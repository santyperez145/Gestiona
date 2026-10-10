import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002100_categoria_sugerida_rapida.sql"), "utf8");
const matrix = readFileSync(resolve(process.cwd(), "scripts/categoria-rapida-matrix.sql"), "utf8");

describe("categoría por rubro rápida (E1/E3)", () => {
  it("una categoría genérica va directo a las reglas por nombre", () => {
    const generica = migration.indexOf("v_generica := v_cat IN ('', 'otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria')");
    const porCategoria = migration.indexOf("r.sobre = 'categoria'");
    const porNombre = migration.indexOf("r.sobre = 'nombre'");
    expect(generica).toBeGreaterThan(0);
    expect(generica).toBeLessThan(porCategoria);
    expect(migration).toContain("IF NOT v_generica THEN");
    expect(porCategoria).toBeLessThan(porNombre);
  });

  it("conserva las tres salidas: unifica, sugiere por nombre o «Varios», y respeta la propia", () => {
    expect(migration).toContain("slug := 'varios'; nombre := 'Varios';");
    expect(migration).toContain("-- 3. Categoría propia que no se reconoce: se respeta (sin filas).");
    expect(migration).toContain("OR v_cat = public.texto_catalogo(p_industry)");
  });

  it("la matriz compara contra la definición anterior y verifica las reglas cargadas", () => {
    expect(matrix).toContain("CREATE FUNCTION pg_temp.categoria_anterior");
    expect(matrix).toContain("'resultados distintos (0)'");
    expect(matrix).toContain("'reglas por categoría que reconocen una genérica (0)'");
    expect(matrix.trim().endsWith("ROLLBACK;")).toBe(true);
  });
});
