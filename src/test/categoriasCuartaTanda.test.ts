import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000300_categorias_cuarta_tanda.sql"), "utf8");
const correccion = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000400_categorias_singulares.sql"), "utf8");
// Lo que queda en la base: la cuarta tanda con los reemplazos de la corrección.
const reemplazos = [...correccion.matchAll(/'([a-z]+es\?)', '([a-z]+\(es\)\?)'/g)].map(m => [m[1], m[2]] as const);
const conCorreccion = (patron: string) => reemplazos.reduce((p, [viejo, nuevo]) => p.split(viejo).join(nuevo), patron);
const filas = [...migration.matchAll(/^\s+\('(\w+)', '([^']+)', '[^']+', '(categoria|nombre)', '((?:[^']|'')+)', (\d+)\)/gm)]
  .map(f => { const copia = [...f] as string[]; copia[4] = conCorreccion(f[4]); return copia; });

describe("categorías por rubro: cuarta tanda (cualquier rubro, TESIS §1)", () => {
  it("carga los seis rubros que faltaban, cada uno con menos de 20 reglas", () => {
    const porRubro = new Map<string, number>();
    for (const f of filas) porRubro.set(f[1], (porRubro.get(f[1]) ?? 0) + 1);
    expect([...porRubro.keys()].sort()).toEqual(["alimentos", "deportes", "hogar", "jugueteria", "mascotas", "tecnologia"]);
    for (const n of porRubro.values()) expect(n).toBeLessThan(20);
  });

  it("identificadores válidos, patrones sin tildes ni ñ y categorías ancladas", () => {
    for (const f of filas) {
      expect(f[2]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f[4]).not.toMatch(/[áéíóúñü]/i);
      if (f[3] === "categoria") expect(f[4]).toMatch(/^\^\(.*\)\$$/);
    }
  });

  it("los plurales de palabras que terminan en consonante reconocen el singular", () => {
    const patrones = filas.map(f => f[4]).join(" ");
    for (const malo of ["cargadores?", "monitores?", "auriculares?", "sartenes?", "monopatines?", "camiones?", "rascadores?", "collares?", "alfajores?", "botines?", "cereales?", "panales?", "televisores?"]) {
      expect(patrones).not.toContain(malo);
    }
    expect(reemplazos).toHaveLength(5);
  });

  it("no usa palabras demasiado comunes para clasificar", () => {
    expect(migration).not.toMatch(/\|uno\|/);
  });
});
