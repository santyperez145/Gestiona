import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * El `.select()` pide todas las columnas que la pantalla después lee.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `columnasQueExisten.test.ts` vigila el error opuesto: pedir una columna que
 * no existe. Ése al menos falla —PostgREST devuelve 400— y la pantalla queda
 * vacía, que se ve.
 *
 * ⚠️ Éste no falla nunca. La interface declara el campo, la pantalla lo lee, y
 * el `select` no lo pide: llega `undefined`, y con `strictNullChecks: false`
 * el cast a la interface hace que TypeScript crea que está. Compila, pasa el
 * lint, pasa los tests, y la pantalla muestra otra cosa.
 *
 * Encontrado el 2026-08-27 en `AFIPPage`: el `select` sobre
 * `afip_connection_status` no pedía `motivo`, `plataforma_cuit` ni
 * `plataforma_razon_social`. La vista los devolvía bien —medido:
 * `motivo=listo`, `plataforma_cuit=20446484436`— pero:
 *
 *   · el CUIT a delegar salía «—», porque `formatearCuit(null)` devuelve eso;
 *   · y como `motivo` llegaba `undefined`, no matcheaba ningún caso y el panel
 *     mostraba «Conectá AFIP en 3 pasos» con AFIP **ya conectado**.
 *
 * Un solo campo que no se pide, dos pantallas equivocadas.
 *
 * ── Cómo decide, y qué NO marca ───────────────────────────────────────────
 *
 * Empareja una `interface` con un `select` cuando **todas** las columnas del
 * select están declaradas en la interface y comparten al menos cuatro: eso
 * significa que la interface es el tipo de fila de esa consulta.
 *
 * 📌 No marca un campo que el archivo **asigna** (`campo: valor` en un objeto
 * literal): ése está calculado o vino de una segunda consulta y se mergeó.
 * Sin esa regla el detector daba 5 hallazgos y los 5 eran falsos positivos
 * —`plan_name` armado desde `plans`, `display_name` mergeado desde `profiles`,
 * `items` desde la relación—. Y saltea los archivos con `select("*")`, donde
 * no se puede saber qué falta.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");

function fuentes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "test") fuentes(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Los nombres de columna de un `.select("a, b:alias, rel(x)")`. */
function columnas(sel: string): string[] {
  return sel
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map(c => c.trim().split(":")[0].trim())
    .filter(c => /^[a-z_][a-z0-9_]*$/.test(c));
}

/** Rangos [inicio, fin) de cada cuerpo de `interface`. */
function rangosDeInterfaces(texto: string): [number, number][] {
  const rangos: [number, number][] = [];
  const re = /interface\s+[A-Za-z0-9_]+\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    let i = re.lastIndex, prof = 1;
    while (i < texto.length && prof > 0) {
      if (texto[i] === "{") prof++;
      else if (texto[i] === "}") prof--;
      i++;
    }
    rangos.push([m.index, i]);
  }
  return rangos;
}

function interfaces(texto: string): { nombre: string; props: string[] }[] {
  const out: { nombre: string; props: string[] }[] = [];
  const re = /interface\s+([A-Za-z0-9_]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    let i = re.lastIndex, prof = 1;
    while (i < texto.length && prof > 0) {
      if (texto[i] === "{") prof++;
      else if (texto[i] === "}") prof--;
      i++;
    }
    const cuerpo = texto.slice(re.lastIndex, i - 1);
    const props = [...cuerpo.matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gim)].map(x => x[1]);
    if (props.length) out.push({ nombre: m[1], props });
  }
  return out;
}

/** El archivo sin los cuerpos de interface: declarar no es asignar. */
function sinInterfaces(texto: string): string {
  let out = texto;
  const rangos = rangosDeInterfaces(texto);
  for (let k = rangos.length - 1; k >= 0; k--) {
    out = out.slice(0, rangos[k][0]) + out.slice(rangos[k][1]);
  }
  return out;
}

describe("el select pide lo que la pantalla usa", () => {
  const archivos = fuentes(SRC);

  it("el escaneo mira archivos de verdad", () => {
    expect(archivos.length).toBeGreaterThan(200);
  });

  it("ninguna pantalla lee un campo que su consulta no pidió", () => {
    const hallazgos: string[] = [];

    for (const ruta of archivos) {
      const texto = readFileSync(ruta, "utf8");
      // Con `select("*")` viene todo: no hay nada que comparar.
      if (/\.select\(\s*["'`]\s*\*/.test(texto)) continue;

      const selects = [...texto.matchAll(/\.select\(\s*["'`]([^"'`]+)["'`]/g)]
        .map(m => columnas(m[1]))
        .filter(cols => cols.length >= 3);
      if (!selects.length) continue;

      const cuerpo = sinInterfaces(texto);
      const rel = ruta.slice(ROOT.length + 1).split("\\").join("/");

      for (const iface of interfaces(texto)) {
        const declaradas = new Set(iface.props);
        for (const cols of selects) {
          const comunes = cols.filter(c => declaradas.has(c));
          if (comunes.length < 4 || !cols.every(c => declaradas.has(c))) continue;

          const pedidas = new Set(cols);
          const faltan = iface.props.filter(p => {
            if (pedidas.has(p)) return false;
            // Asignado en un objeto literal ⇒ calculado o mergeado.
            if (new RegExp(`\\b${p}\\s*:[^:]`).test(cuerpo)) return false;
            return new RegExp(`\\?\\.${p}\\b|\\.${p}\\b`).test(cuerpo);
          });
          if (faltan.length) {
            hallazgos.push(`${rel} [${iface.nombre}] no pide: ${faltan.join(", ")}`);
          }
        }
      }
    }

    expect(hallazgos, [
      "Una pantalla lee un campo que su `.select()` nunca pidió.",
      "",
      "Llega `undefined` y no falla nada: con `strictNullChecks: false` el cast",
      "a la interface hace que TypeScript crea que el campo está. Compila, pasa",
      "el lint y muestra otra cosa — así el panel de AFIP decía «Conectá AFIP en",
      "3 pasos» con AFIP ya conectado, y el CUIT a delegar salía «—».",
      "",
      "Se arregla agregando la columna al select, o sacando el campo de la",
      "interface si de verdad no se usa.",
      "",
      ...hallazgos,
    ].join("\n")).toEqual([]);
  });
});
