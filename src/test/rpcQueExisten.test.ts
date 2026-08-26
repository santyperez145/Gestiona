import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * Ningún `.rpc("x")` puede nombrar una función que no existe.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────
 *
 * Es la hermana de `columnasQueExisten`: el mismo fallo silencioso, del otro
 * lado. PostgREST responde `PGRST202` a un RPC inexistente, y si alguien
 * destructura el `error` sin mirarlo, la feature no anda y nadie se entera.
 *
 * ⚠️ Encontró uno de verdad: `check-stock-alerts` llamaba a
 * `supabase.rpc("low_stock_threshold")`, que **no es un RPC — es una columna de
 * `products`**. La llamada devolvía un builder que se stringificaba dentro de un
 * `.filter()`, armaba una consulta inválida, su error no se miraba y su
 * resultado se descartaba. Corría por cron todos los días a las 9.
 *
 * ── Contra qué se compara ────────────────────────────────────────────────
 *
 * Contra la **unión** de las dos fuentes de verdad del repo, porque ninguna
 * alcanza sola:
 *
 * - `src/integrations/supabase/types.ts`, que se regenera desde la base con
 *   `gen types`. Trae lo que PostgREST expone: 306 funciones.
 * - Las `CREATE FUNCTION` de `supabase/migrations/`. Cubren lo que el generador
 *   omite — sobre todo las **sobrecargadas**, que no puede representar.
 *
 * 📌 Si aparece un falso positivo porque los tipos están viejos, la respuesta es
 * regenerarlos, no agregar el nombre a una allowlist.
 */

const ROOT = resolve(__dirname, "../..");
const TYPES = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");

/**
 * Los nombres de RPC que la base expone, según los tipos generados.
 *
 * ⚠️ Dos trampas que este parser ya se comió, y por eso está el test de que el
 * catálogo se pudo leer:
 *
 * 1. Hay **dos** secciones `Functions:` en el archivo. La primera es la de
 *    `graphql_public` y tiene una sola entrada; la que interesa es la de
 *    `public`. Buscar la primera daba un catálogo de 1 función y **todas** las
 *    llamadas quedaban marcadas como inexistentes.
 * 2. El archivo se genera con CRLF, así que un `$` después de `{` no matchea:
 *    la línea termina en `{\r`.
 * 3. Las funciones cortas se renderizan **en una sola línea**
 *    (`is_platform_admin: { Args: { _user_id: string }; Returns: boolean }`) y
 *    las largas abren llave y siguen abajo. Anclar el `{` al final de la línea
 *    dejaba afuera 27 funciones que sí existen.
 */
function funcionesDeLosTipos(): Set<string> {
  const texto = TYPES.split("\r\n").join("\n");

  const schema = texto.indexOf("\n  public: {\n");
  const desde = schema === -1 ? 0 : schema;

  const marca = "    Functions: {\n";
  const i = texto.indexOf(marca, desde);
  if (i === -1) return new Set();

  // La sección termina donde arranca la siguiente clave de primer nivel.
  const fin = texto.indexOf("\n    Enums: {", i);
  const cuerpo = texto.slice(i + marca.length, fin === -1 ? undefined : fin);

  const nombres = new Set<string>();
  for (const linea of cuerpo.split("\n")) {
    // Sin anclar el cierre: hay entradas de una sola línea y entradas que
    // abren llave y siguen abajo.
    const m = /^ {6}([a-z_0-9]+): \{/.exec(linea);
    if (m) nombres.add(m[1]);
  }
  return nombres;
}

/**
 * Las funciones que el repo declara en sus migraciones.
 *
 * ⚠️ `types.ts` **no alcanza solo**, y esto se midió: tiene 306 funciones y la
 * base 440. La diferencia no es error —las de trigger no se exponen por
 * PostgREST— pero además el generador **omite las sobrecargadas**, porque no
 * puede representar dos firmas con el mismo nombre. `pago_reintegro_preparar`
 * tiene dos, existe, se llama desde `refund-store-payment`, y quedaba marcada
 * como inexistente.
 *
 * Las migraciones son la otra fuente de verdad del repo y cubren ese hueco.
 *
 * 📌 Un nombre creado y después dropeado seguiría contando. Es un falso
 * negativo posible y aceptado: este guard busca el error de tipear un nombre que
 * nunca existió, que es el que pasa de verdad.
 */
function funcionesDeLasMigraciones(): Set<string> {
  const dir = resolve(ROOT, "supabase/migrations");
  const nombres = new Set<string>();
  for (const archivo of readdirSync(dir)) {
    if (!archivo.endsWith(".sql")) continue;
    const texto = readFileSync(resolve(dir, archivo), "utf8");
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) nombres.add(m[1].toLowerCase());
  }
  return nombres;
}

function archivosFuente(dir: string): string[] {
  const salida: string[] = [];
  let entradas: string[];
  try { entradas = readdirSync(resolve(ROOT, dir)); } catch { return salida; }
  for (const entrada of entradas) {
    const rel = join(dir, entrada);
    const abs = resolve(ROOT, rel);
    if (statSync(abs).isDirectory()) {
      if (entrada === "node_modules" || entrada === "dist") continue;
      salida.push(...archivosFuente(rel));
    } else if (/\.tsx?$/.test(entrada) && entrada !== "types.ts") {
      salida.push(rel.split(sep).join("/"));
    }
  }
  return salida;
}

interface Llamada { archivo: string; linea: number; nombre: string }

function llamadasRpc(): Llamada[] {
  const salida: Llamada[] = [];
  for (const dir of ["src", "supabase/functions", "api"]) {
    for (const rel of archivosFuente(dir)) {
      // El propio test nombra RPC en sus comentarios; se saltea.
      if (rel.endsWith("rpcQueExisten.test.ts")) continue;
      const texto = readFileSync(resolve(ROOT, rel), "utf8");
      const re = /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto)) !== null) {
        salida.push({
          archivo: rel,
          linea: texto.slice(0, m.index).split("\n").length,
          nombre: m[1],
        });
      }
    }
  }
  return salida;
}

describe("ningún .rpc() llama a una función que no existe", () => {
  // El catálogo es la unión de las dos fuentes del repo. Ver arriba por qué
  // ninguna alcanza sola.
  const deTipos = funcionesDeLosTipos();
  const deMigraciones = funcionesDeLasMigraciones();
  const catalogo = new Set([...deTipos, ...deMigraciones]);
  const llamadas = llamadasRpc();

  it("el catálogo de los tipos se pudo leer, en sus dos formas", () => {
    // Si esto falla, el resto del test pasaría por vacío y no probaría nada.
    expect(deTipos.size).toBeGreaterThan(250);
    expect(deMigraciones.size).toBeGreaterThan(250);
    // ⚠️ Una de cada forma: la corta va en una línea, la larga abre llave. Con
    //    el regex anclado al final, la corta no matcheaba y 27 funciones reales
    //    quedaban marcadas como inexistentes.
    expect(deTipos.has("is_platform_admin")).toBe(true);
    expect(deTipos.has("create_store_order")).toBe(true);
    // Sobrecargada: no está en los tipos y sí en las migraciones.
    expect(deTipos.has("pago_reintegro_preparar")).toBe(false);
    expect(deMigraciones.has("pago_reintegro_preparar")).toBe(true);
  });

  it("el escaneo encuentra llamadas de verdad", () => {
    // Misma razón: un regex roto haría que todo "pase".
    expect(llamadas.length).toBeGreaterThan(150);
  });

  it("todas las funciones llamadas existen en la base", () => {
    const faltantes = llamadas
      .filter(l => !catalogo.has(l.nombre))
      .map(l => `${l.archivo}:${l.linea}  ${l.nombre}()`);

    expect(faltantes, [
      "Hay .rpc() apuntando a funciones que la base no tiene.",
      "PostgREST responde PGRST202 y, si el error no se mira, la feature",
      "no anda sin que nadie se entere.",
      "",
      ...faltantes,
    ].join("\n")).toEqual([]);
  });

  it("el caso que se encontró: low_stock_threshold es una columna, no un RPC", () => {
    // Guarda concreta contra la regresión exacta.
    expect(catalogo.has("low_stock_threshold")).toBe(false);
    const usos = llamadas.filter(l => l.nombre === "low_stock_threshold");
    expect(usos).toEqual([]);
  });
});
