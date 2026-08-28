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
 * 📌 Dos funciones de veinte líneas obligaban a bajar 833 KB. `manualChunks`
 * con forma de objeto no permite evitarlo: hace falta la forma de función, y
 * darles un chunk propio.
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
  it("manualChunks es una función, no un objeto", () => {
    // La forma de objeto no deja decidir dónde caen los módulos virtuales ni
    // las utilidades compartidas, que es de donde vino el problema.
    expect(cuerpo).toMatch(/manualChunks\s*\(\s*id\s*:/);
  });

  it("el helper de import() de Vite tiene chunk propio", () => {
    /**
     * ⚠️ Va **antes** del filtro de `node_modules`: es un módulo virtual
     * (`\0vite/preload-helper`) y ese filtro lo descartaría.
     */
    const i = cuerpo.indexOf("vite/preload-helper");
    const j = cuerpo.indexOf('!id.includes("node_modules")');
    expect(i, "no se le asigna chunk al helper de Vite").toBeGreaterThan(-1);
    expect(
      i < j,
      "el helper se chequea después del filtro de node_modules, así que nunca entra",
    ).toBe(true);
  });

  it("las utilidades chicas no viven dentro de un vendor pesado", () => {
    // `clsx` adentro de `vendor-charts` arrastraba 110 KB de gráficos a toda
    // página que use `cn()` — es decir, todas.
    expect(cuerpo).toMatch(/clsx[\s\S]{0,90}vendor-utils/);
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
