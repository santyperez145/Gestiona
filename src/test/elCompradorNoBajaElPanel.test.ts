import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * El comprador no baja el panel.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido en la tienda real el 2026-08-28: la primera carga eran **636 KB
 * comprimidos**, y **248 KB (39%) eran `vendor-pdf` y `vendor-charts`** —
 * generación de PDF y gráficos, que un comprador de perfumes no usa nunca.
 *
 * No estaban ahí por un import mal puesto: el árbol estático desde `App.tsx`
 * no toca ninguna de las dos. Los arrastraban **dos símbolos**, y encontrarlos
 * necesitó leer el bundle, no el código:
 *
 *   - de `vendor-charts`, el entry importaba **`clsx`** — Rollup la había
 *     metido ahí porque recharts la usa, y todo `cn()` de la UI la llama;
 *   - de `vendor-pdf`, importaba **`__vitePreload`**, el helper de `import()`
 *     del propio Vite: un módulo virtual que no vive en `node_modules`, así
 *     que Rollup lo dejaba en el primer chunk que lo pidiera.
 *
 * 📌 Dos funciones de veinte líneas obligaban a bajar 833 KB. Con Vite 8,
 * `codeSplitting.groups` debe desactivar la captura recursiva de dependencias:
 * de lo contrario un grupo pesado vuelve a absorber esos helpers.
 *
 * ── Cómo se vuelve a medir ────────────────────────────────────────────────
 *
 *     npm run build
 *     grep -oE 'modulepreload[^>]*vendor-[a-z-]+' dist/index.html
 *
 * No tienen que aparecer `vendor-pdf` ni `vendor-charts`.
 */

const CONFIG = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const cuerpo = sinComentarios(CONFIG);

describe("el comprador no baja el panel", () => {
  it("Vite 8 usa grupos de Rolldown sin captura recursiva", () => {
    expect(cuerpo).toMatch(/rolldownOptions\s*:/);
    expect(cuerpo).toMatch(/codeSplitting\s*:/);
    expect(cuerpo).not.toMatch(/manualChunks\s*[:(]/);

    const grupos = cuerpo.match(/includeDependenciesRecursively\s*:\s*false/g) ?? [];
    expect(grupos, "utils, PDF, charts y xlsx deben conservar sus dependencias fuera del chunk pesado")
      .toHaveLength(4);
  }, 15_000);

  it("el helper de import() de Vite tiene chunk propio", () => {
    /**
     * ⚠️ Va **antes** del filtro de `node_modules`: es un módulo virtual
     * (`\0vite/preload-helper`) y ese filtro lo descartaría.
     */
    const i = cuerpo.indexOf("vite/preload-helper");
    expect(i, "no se le asigna chunk al helper de Vite").toBeGreaterThan(-1);
    expect(cuerpo).toMatch(/vite\/preload-helper[\s\S]{0,180}vendor-utils|vendor-utils[\s\S]{0,220}vite\/preload-helper/);
  });

  it("las utilidades chicas no viven dentro de un vendor pesado", () => {
    // `clsx` adentro de `vendor-charts` arrastraba 110 KB de gráficos a toda
    // página que use `cn()` — es decir, todas.
    expect(cuerpo).toMatch(/vendor-utils[\s\S]{0,220}clsx|clsx[\s\S]{0,220}vendor-utils/);
  });

  it("si hay un build, el arranque no precarga PDF ni gráficos", () => {
    /**
     * Esta es la comprobación de verdad; las de arriba miran la intención.
     * Se saltea si no hay `dist/` para no obligar a construir en cada test.
     */
    const html = join(process.cwd(), "dist", "index.html");
    if (!existsSync(html)) return;

    const precargados = [...readFileSync(html, "utf8")
      .matchAll(/modulepreload[^>]*?\/assets\/(vendor-[a-z-]+)-/g)]
      .map((m) => m[1]);

    const pesados = precargados.filter(
      (v) => v === "vendor-pdf" || v === "vendor-charts" || v === "vendor-xlsx",
    );

    expect(
      pesados,
      `El arranque precarga ${pesados.join(", ")}. Un comprador que entra a ver ` +
        `un perfume no necesita generar PDF, dibujar gráficos ni leer Excel: ` +
        `son 833 KB que baja para nada. Suele ser un símbolo chico —clsx, el ` +
        `helper de Vite— que Rollup dejó adentro de un vendor pesado; se ve ` +
        `mirando qué importa el chunk de entrada en dist/assets/index-*.js.`,
    ).toEqual([]);
  });
});

/**
 * ── Y tampoco lo baja por atrás ───────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28: el precache del service worker eran **8,2 MB en 257
 * entradas**, y `registerSW.js` se inyecta en **toda** página —incluida la
 * tienda pública—. O sea que alguien que entraba a mirar un perfume bajaba en
 * segundo plano el panel entero: 87 chunks de páginas que no va a abrir (3 MB)
 * más xlsx, gráficos y PDF (1,3 MB).
 *
 * No se ve en la primera carga porque ocurre después, en background — y es
 * justamente por eso que nadie lo nota.
 *
 * 📌 Lo que se conserva a propósito: el shell, para que la app abra sin
 * conexión, y **`POSPage`**, que es la razón de ser del PWA — una feria sin
 * señal tiene que poder vender. El resto se cachea la primera vez que se abre.
 */
describe("el service worker no precachea el panel entero", () => {
  // La misma lectura que arriba, una sola fuente.
  //
  // 📌 Llegar acá costó una hora por algo que no era esto: la aserción de abajo
  // tenía un **carácter de retroceso invisible** (`\x08`) metido por el
  // escapado de un script, así que el regex era `/\bglobIgnores…/` con `\b`
  // convertido en byte 0x08. El editor lo mostraba bien y el test fallaba
  // diciendo que el archivo no contenía algo que sí contenía. Se vio con
  // `cat -A`, no leyendo.
  const config = cuerpo;

  it("hay un globIgnores que deja afuera las páginas", () => {
    /**
     * ⚠️ La clave exacta, con dos puntos. La primera versión pedía
     * `/globIgnores/` a secas y **`globIgnoresX` la satisfacía**: renombrar la
     * opción —que la deja de tener efecto— pasaba en verde. Es el mismo
     * problema de subcadena que ya mordió otras guardas de este repo.
     */
    expect(config).toMatch(/globIgnores\s*:/);
    expect(config).toMatch(/POSPage\|index\|vendor/);
  });

  it("los vendors de reportes y exportación no se precachean", () => {
    expect(config).toMatch(/vendor-\{xlsx,charts,pdf\}/);
  });

  it("lo que no se precachea se cachea al usarse", () => {
    // Sin esto, una página abierta una vez seguiría sin estar offline: se
    // habría cambiado un problema de peso por uno de disponibilidad.
    const sw = sinComentarios(
      readFileSync(join(process.cwd(), "src", "sw.ts"), "utf8"),
    );
    expect(sw).toMatch(/StaleWhileRevalidate/);
    expect(sw, "no hay una ruta para los chunks de /assets/").toMatch(/\/assets\//);
  });

  it("si hay un build, el POS sigue disponible sin conexión", () => {
    const sw = join(process.cwd(), "dist", "sw.js");
    if (!existsSync(sw)) return;
    const urls = [...readFileSync(sw, "utf8").matchAll(/"url":"([^"]+)"/g)].map(m => m[1]);

    expect(
      urls.some(u => u.includes("POSPage")),
      "el POS dejó de estar precacheado: una feria sin señal se queda sin vender",
    ).toBe(true);

    const panel = urls.filter(u => /(Admin|Reports|Analytics|Platform|Finance)Page/.test(u));
    expect(
      panel,
      `El precache trae ${panel.length} chunk(s) del panel que un comprador no ` +
        `abre nunca: ${panel.slice(0, 3).join(", ")}`,
    ).toEqual([]);
  });
});
