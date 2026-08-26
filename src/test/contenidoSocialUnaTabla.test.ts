import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260826000220_contenido_social_una_tabla.sql");
const store = leer("src/lib/supabaseStore.ts");

function archivosFuente(dir = "src"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    if (statSync(resolve(ROOT, rel)).isDirectory()) {
      if (entrada === "test" || entrada === "node_modules") continue;
      salida.push(...archivosFuente(rel));
    } else if (/\.tsx?$/.test(entrada) && entrada !== "types.ts") {
      salida.push(rel.split(sep).join("/"));
    }
  }
  return salida;
}

/**
 * Una sola autoridad para el contenido social.
 *
 * Había dos modelos para lo mismo: `MarketingPage` escribía en
 * `marketing_posts` —vía los helpers de `supabaseStore.ts`— y
 * `SocialPlannerPage` en `social_posts`. Dos esquemas, dos pantallas, la misma
 * cosa.
 *
 * ⚠️ Y `social_posts` **no era estrictamente más completo**, que es lo que
 * decía el análisis. Tuvo que mirarse columna por columna: `product_ids` no lo
 * usa nadie, `user_id` sobra porque la publicación es del comercio, y
 * `ai_generated` **sí se usa** — en el KPI «Con IA» y en el badge de cada
 * publicación. Migrar sin mirar habría perdido esa marca.
 */
describe("el contenido social tiene una sola tabla", () => {
  it("ninguna pantalla ni helper escribe en marketing_posts", () => {
    // Se buscan las dos comillas: `supabaseStore.ts` usa simples, y mirar sólo
    // las dobles ya escondió un bug en esta misma sesión.
    const culpables = archivosFuente()
      .filter(f => /\.from\(\s*['"]marketing_posts['"]/.test(leer(f)));
    expect(culpables).toEqual([]);
  });

  it("los helpers de Marketing leen y escriben social_posts", () => {
    expect(store).toContain("from('social_posts')");
    expect(store).not.toContain("from('marketing_posts')");
  });

  it("la tabla vieja queda marcada como deprecada", () => {
    expect(migracion).toContain("COMMENT ON TABLE public.marketing_posts");
    expect(migracion).toContain("DEPRECADA");
  });

  it("no se borra en la misma migración que cambia la UI", () => {
    // La tabla legacy se elimina en otra migración: tienen que poder
    // revertirse por separado.
    expect(migracion).not.toMatch(/DROP TABLE[^;]*marketing_posts/i);
  });
});

describe("la traducción entre las dos formas vive en un solo lugar", () => {
  it("image_url y media_urls se traducen en el store, no en la pantalla", () => {
    // Si cada pantalla conociera la diferencia, volvería a haber dos verdades
    // sobre la misma fila.
    expect(store).toContain("function postDesdeSocial");
    expect(store).toContain("function postHaciaSocial");
    expect(store).toContain("media_urls: [image_url]");
  });

  it("scheduled_at se traduce a scheduled_for", () => {
    expect(store).toContain("scheduled_for: scheduled_at");
  });

  it("no se manda user_id ni product_ids a social_posts", () => {
    // La tabla no los tiene: mandarlos daría 400 y la publicación no se
    // guardaría, con un toast que no dice por qué.
    expect(store).toMatch(/user_id: _user/);
    expect(store).toMatch(/product_ids: _prod/);
  });
});

describe("lo que se agregó y lo que no", () => {
  it("ai_generated existe y su default no marca todo como IA", () => {
    // Un default true diría que el comercio genera todo con IA, y el KPI
    // «Con IA» mediría cualquier cosa.
    expect(migracion).toContain("ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false");
    expect(migracion).toContain("el default marca como generado con IA lo que escribio una persona");
  });

  it("no se agregó product_ids, porque no lo usa nadie", () => {
    expect(migracion).not.toMatch(/ADD COLUMN[^;]*product_ids/);
  });

  it("la migración exige que la tabla vieja esté vacía antes de deprecarla", () => {
    // Si tuviera filas, deprecarla sin migrarlas perdería contenido.
    expect(migracion).toContain("hay que migrarlas antes de deprecarla");
  });
});
