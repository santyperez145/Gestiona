import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * El dedo llega al botón.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28 en la tienda real a 375px de ancho: **47 elementos
 * interactivos por debajo de 40px de alto**, que es el mínimo que el propio
 * contrato de este repo fija («acciones llegan a 40px», CONTRIBUTING.md). Entre
 * ellos, los del camino de compra:
 *
 *     Carrito              36 x 36
 *     Menú                 36 x 36
 *     Iniciar sesión       36 x 36
 *     Agregar al carrito  140 x 36
 *     Guardar en deseos    32 x 32
 *
 * Apple pide 44x44 y Material 48x48. El patrón era siempre el mismo: `p-2`
 * (8px) alrededor de un ícono de 20px da 36.
 *
 * 📌 **No es una preferencia estética: es el camino de conversión.** En
 * Argentina la mayoría del tráfico de ecommerce es mobile, y un carrito de
 * 36px se erra. Cada intento fallido es una compra menos.
 *
 * Esta guarda mira el **código** de la tienda, no el navegador: un test no
 * puede medir píxeles, pero sí puede exigir que un control con sólo padding
 * declare además un mínimo.
 */

const STOREFRONT = join(process.cwd(), "src", "storefront");

/**
 * Controles que no necesitan mínimo táctil, con el motivo.
 *
 * ⚠️ Un enlace de texto dentro de un párrafo no es un objetivo táctil
 * independiente: agrandarlo a 44px rompería la línea. La regla aplica a
 * botones y a enlaces que se comportan como botones.
 */
const SIN_MINIMO = /inline-flex|hover:underline|storefront-section__link|storefront-brand/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

function sinComentarios(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Los `className="…"` de cada `<button>`.
 *
 * ⚠️ El fin de la etiqueta se busca contando llaves, no con el primer `>`.
 * La primera versión usaba `/<button\b([\s\S]{0,600}?)>/` y **cortaba en el
 * `>` de `onClick={() => …}`**, así que nunca llegaba al `className`: el test
 * pasaba en verde sobre botones que no había mirado. Se descubrió saboteándolo
 * —devolver un botón a `py-2` y ver si el test se ponía rojo— y no se descubrió
 * corriéndolo.
 */
function clasesDeControles(src: string): { clase: string; linea: number }[] {
  const out: { clase: string; linea: number }[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let llaves = 0, comilla: string | null = null, fin = -1;

    for (; i < src.length && i < m.index + 2000; i++) {
      const c = src[i];
      if (comilla) { if (c === comilla) comilla = null; continue; }
      if (c === '"' || c === "'" || c === "`") { comilla = c; continue; }
      if (c === "{") llaves++;
      else if (c === "}") llaves--;
      else if (c === ">" && llaves === 0) { fin = i; break; }
    }
    if (fin < 0) continue;

    const clase = src.slice(m.index, fin).match(/className="([^"]*)"/)?.[1];
    if (!clase) continue;
    out.push({ clase, linea: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("el dedo llega al botón", () => {
  const fs = archivos(STOREFRONT);

  it("hay componentes de tienda que revisar", () => {
    expect(fs.length).toBeGreaterThan(5);
  });

  it("todo botón de la tienda declara un mínimo táctil", () => {
    const chicos: string[] = [];

    for (const f of fs) {
      const src = sinComentarios(readFileSync(f, "utf8"));
      for (const { clase, linea } of clasesDeControles(src)) {
        if (SIN_MINIMO.test(clase)) continue;

        // Ya declara un mínimo, un alto fijo grande, o es un control full-size.
        const declara =
          /min-h-(11|12|14|\[4[4-9]px\]|\[5\d px\])/.test(clase) ||
          /\bh-(11|12|14|16|full)\b/.test(clase) ||
          /\bsize-(11|12|14)\b/.test(clase);
        if (declara) continue;

        // Sólo padding: `p-1`/`p-2`/`py-2` sobre un ícono no llega a 44.
        const soloPadding = /\bp-[0-2]\b|\bpy-[0-2]\b/.test(clase);
        if (soloPadding) {
          chicos.push(
            `${f.replace(process.cwd() + "\\", "").replace(/\\/g, "/")}:${linea}  ${clase.slice(0, 58)}`,
          );
        }
      }
    }

    expect(
      chicos,
      `Estos botones de la tienda se apoyan sólo en padding y quedan por debajo ` +
        `de 44px, que es donde el dedo empieza a errarle. En mobile es el ` +
        `camino de conversión:\n\n  ${chicos.join("\n  ")}\n\n` +
        `Se arregla agregando min-h-11 (y min-w-11 si es un ícono).`,
    ).toEqual([]);
  });
});
