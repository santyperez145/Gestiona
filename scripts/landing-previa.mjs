/**
 * Landing previa (2026-11-02): al compilar, renderiza la landing a HTML y la
 * deja en el <template id="plantilla-landing"> de index.html. El script de
 * arranque la muestra en `/` a quien no tiene sesión mientras baja el
 * JavaScript, y la saca cuando React monta la landing viva (misma marca, mismo
 * tamaño: no hay salto). En un celular el título pasa de esperar ~3 s de
 * JavaScript a pintarse con el HTML.
 */
import path from "node:path";

export const MARCA = "<!--landing-previa-->";

/** Pone el HTML de la landing en el lugar de la marca; sin marca, falla. */
export function insertarLandingPrevia(html, landing) {
  if (!html.includes(MARCA)) throw new Error(`index.html no tiene la marca ${MARCA} dentro de #plantilla-landing.`);
  if (!/data-landing/.test(landing) || !/<h1[\s>]/.test(landing)) {
    throw new Error("La landing renderizada no tiene data-landing ni su <h1>: no se publica una previa rota.");
  }
  return html.replace(MARCA, () => landing);
}

/**
 * El CSS antes que el JavaScript. Vite pone la hoja de estilos después de los
 * diez `modulepreload` del arranque, así que en un celular los 230 KB de JS
 * le ganaban el ancho de banda a los 48 KB de CSS y nada se pintaba hasta que
 * terminaban todos (medido: la landing pasó de 3,3 s a 2,9 s de LCP).
 */
export function cssPrimero(html) {
  const hojas = html.match(/[ \t]*<link rel="stylesheet"[^>]*>\r?\n?/g) ?? [];
  if (!hojas.length) return html;
  let sin = html;
  for (const hoja of hojas) sin = sin.replace(hoja, "");
  const modulo = sin.search(/[ \t]*<script type="module"/);
  if (modulo < 0) return html;
  return sin.slice(0, modulo) + hojas.join("") + sin.slice(modulo);
}

/** Plugin de Vite: sólo en el build y con su propio servidor SSR de un uso. */
export function landingPrevia(raiz) {
  return {
    name: "nerqia-landing-previa",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      async handler(html) {
        const { createServer } = await import("vite");
        const servidor = await createServer({
          configFile: false,
          root: raiz,
          logLevel: "error",
          appType: "custom",
          resolve: { alias: { "@": path.resolve(raiz, "src") } },
          esbuild: { jsx: "automatic" },
          server: { middlewareMode: true, hmr: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
        });
        try {
          const { landingEstatica } = await servidor.ssrLoadModule("/src/prerender/landingEstatica.tsx");
          return cssPrimero(insertarLandingPrevia(html, landingEstatica()));
        } finally {
          await servidor.close();
        }
      },
    },
  };
}
