import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Una alerta que se dice creada tiene que estar guardada.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28 disparando `check-alerts` de verdad: contestó
 * `{"ok":true,"notifications_created":45}` y en `notifications` había **cero**
 * filas nuevas.
 *
 * Dos errores encadenados:
 *
 *   1. `notifications.org_id` es `NOT NULL` y el objeto insertado no lo
 *      mandaba. Cada insert cortaba con `23502`.
 *   2. El `.error` no se miraba, y el contador sumaba igual.
 *
 * 📌 O sea que **las alertas nunca se crearon** —stock bajo, deuda vencida,
 * margen bajo, gastos elevados, productos por vencer— y la función informaba
 * éxito todas las veces. Lo mismo en `execute-automations`: la automatización
 * decía haber notificado sin escribir nada.
 *
 * ⚠️ Esta es la familia más cara del repo: no falla, no avisa, y la pantalla
 * dice que anduvo. Se encontró **ejecutando**, no leyendo.
 */

const FUNCIONES = join(process.cwd(), "supabase", "functions");

/** Tablas con `org_id NOT NULL` que las funciones escriben seguido. */
const EXIGEN_ORG = ["notifications"];

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** El literal que llega a `.insert(...)`, siguiendo la variable si hace falta. */
function objetoInsertado(src: string, tabla: string): string | null {
  const m = src.match(
    new RegExp(`from\\(["']${tabla}["']\\)\\s*\\.insert\\(\\s*`),
  );
  if (!m || m.index === undefined) return null;
  const resto = src.slice(m.index + m[0].length);

  const recortar = (s: string) => {
    let prof = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{") prof++;
      else if (s[i] === "}") { prof--; if (prof === 0) return s.slice(0, i + 1); }
    }
    return s;
  };

  if (resto.startsWith("{")) return recortar(resto);

  // `.insert(toInsert)` — se busca dónde se arma esa variable.
  const nombre = resto.match(/^(\w+)/)?.[1];
  if (!nombre) return null;
  const arma = src.match(new RegExp(`${nombre}\\s*(?:\\.push\\(|=[^=])[\\s\\S]{0,60}?\\{`));
  if (!arma || arma.index === undefined) return null;
  const desde = src.indexOf("{", arma.index);
  return recortar(src.slice(desde));
}

function funcionesQueEscriben(tabla: string): string[] {
  return readdirSync(FUNCIONES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .filter((n) => {
      const f = join(FUNCIONES, n, "index.ts");
      if (!existsSync(f)) return false;
      return new RegExp(`from\\(["']${tabla}["']\\)\\s*\\.insert`)
        .test(sinComentarios(readFileSync(f, "utf8")));
    });
}

describe("una alerta que se dice creada está guardada", () => {
  for (const tabla of EXIGEN_ORG) {
    const escriben = funcionesQueEscriben(tabla);

    it(`hay funciones que escriben en ${tabla}`, () => {
      // Si esto da 0, el detector se rompió y los tests de abajo pasan vacíos.
      expect(escriben.length).toBeGreaterThan(5);
    });

    it(`toda función que inserta en ${tabla} manda org_id`, () => {
      const sinOrg: string[] = [];

      for (const fn of escriben) {
        const src = sinComentarios(readFileSync(join(FUNCIONES, fn, "index.ts"), "utf8"));
        const obj = objetoInsertado(src, tabla);
        if (obj === null) continue;
        if (!/\borg_id\b/.test(obj)) sinOrg.push(fn);
      }

      expect(
        sinOrg,
        `${tabla}.org_id es NOT NULL. Estas funciones insertan sin mandarlo, ` +
          `así que cada insert corta con 23502: ${sinOrg.join(", ")}. Ya pasó ` +
          `con check-alerts, que informaba «45 notificaciones creadas» con 0 ` +
          `filas escritas.`,
      ).toEqual([]);
    });

    it(`toda función que inserta en ${tabla} mira el error`, () => {
      /**
       * ⚠️ Contar lo que no se escribió es peor que fallar: la función informa
       * éxito, el cron queda en verde, y nadie se entera nunca.
       */
      const ciegas: string[] = [];

      for (const fn of escriben) {
        const src = sinComentarios(readFileSync(join(FUNCIONES, fn, "index.ts"), "utf8"));
        const m = src.match(
          new RegExp(`([\\s\\S]{0,120})from\\(["']${tabla}["']\\)\\s*\\.insert`),
        );
        if (!m) continue;
        // O se desestructura el error, o se guarda el resultado para mirarlo.
        const antes = m[1];
        if (!/\{\s*(data\s*:\s*\w+\s*,\s*)?error|const\s+\w*[Rr]es\w*\s*=/.test(antes)) {
          ciegas.push(fn);
        }
      }

      expect(
        ciegas,
        `Estas funciones insertan en ${tabla} sin mirar el .error, así que ` +
          `«no se guardó» se vuelve «listo»: ${ciegas.join(", ")}.`,
      ).toEqual([]);
    });
  }

  it("el dueño recibe las alertas de su propio comercio", () => {
    /**
     * ⚠️ Tres funciones elegían a quién avisar con `.eq("role", "admin")`, que
     * **excluye al dueño**. Y en un comercio de una sola persona —todo comercio
     * nuevo— la lista quedaba vacía y la función salía por `continue` sin
     * mandar nada.
     *
     * 📌 Medido el 2026-08-28: las 45 alertas que `check-alerts` acababa de
     * crear fueron **al admin y ninguna al dueño**. En una organización sin
     * admin no habría creado ninguna. Es justo el caso del segundo comercio.
     */
    const malas: string[] = [];

    for (const fn of readdirSync(FUNCIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)) {
      const archivo = join(FUNCIONES, fn, "index.ts");
      if (!existsSync(archivo)) continue;

      const src = sinComentarios(readFileSync(archivo, "utf8"));
      // Sólo importa donde se elige a quién avisar.
      if (!/from\(["']memberships["']\)/.test(src)) continue;
      if (!/from\(["']notifications["']\)\s*\.insert|enviarWhatsApp|sendEmail/.test(src)) continue;

      const roles = [...src.matchAll(/\.(?:eq|in)\(\s*["']role["']\s*,\s*([^)]+)\)/g)]
        .map((m) => m[1]);
      if (roles.length === 0) continue;
      if (roles.every((r) => !r.includes("owner"))) malas.push(fn);
    }

    expect(
      malas,
      `Estas funciones avisan sólo a los «admin» y dejan afuera al dueño, así ` +
        `que un comercio de una sola persona no recibe nada: ${malas.join(", ")}.`,
    ).toEqual([]);
  });
});
