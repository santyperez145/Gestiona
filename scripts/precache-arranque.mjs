/**
 * Qué guarda sí o sí el service worker (2026-10-23).
 *
 * El entry con todo lo que importa de forma estática (lo que `index.html`
 * precarga) y el POS con sus dependencias, para vender sin señal.
 *
 * ⚠️ El precache se armaba excluyendo por nombre (`!(POSPage|index|vendor)*`).
 * El bundler empezó a sacar piezas del arranque con otros nombres (`client-*`,
 * `auth-*`, `orgContext-*`, `rolldown-runtime-*`) y quedaron afuera: el
 * service worker servía el `index.html` guardado, esas piezas ya no existían
 * después de un despliegue (404) y la página quedaba en negro para cualquiera
 * que volviera al sitio. Ahora se lee del build, no se adivina.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Imports estáticos de un chunk ESM minificado (no los `import()` dinámicos). */
export function importsEstaticos(codigo) {
  return [...codigo.matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.js)"/g)].map((m) => `assets/${m[1]}`);
}

/** Las piezas de `/assets` que `index.html` carga o precarga. */
export function piezasDelHtml(html) {
  return [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
}

/** Entry + POS, con sus imports estáticos transitivos. */
export function piezasDelArranque(dist) {
  const piezas = new Set(piezasDelHtml(readFileSync(path.join(dist, "index.html"), "utf8")));
  const assets = path.join(dist, "assets");
  if (existsSync(assets)) {
    for (const f of readdirSync(assets)) if (/^POSPage-.*\.js$/.test(f)) piezas.add(`assets/${f}`);
  }
  const pendientes = [...piezas];
  const leidas = new Set();
  while (pendientes.length) {
    const actual = pendientes.pop();
    if (leidas.has(actual)) continue;
    leidas.add(actual);
    const archivo = path.join(dist, actual);
    if (!existsSync(archivo)) continue;
    for (const dep of importsEstaticos(readFileSync(archivo, "utf8"))) {
      if (!piezas.has(dep)) { piezas.add(dep); pendientes.push(dep); }
    }
  }
  return piezas;
}

/** Vendors pesados que sólo usan reportes y exportaciones: nunca al precache. */
const PESADOS = /^assets\/vendor-(xlsx|charts|pdf)-/;

/**
 * `manifestTransforms` de workbox: de los JS de `/assets` se quedan sólo los
 * del arranque y los vendors compartidos; el resto se cachea al abrirse.
 * Falla el build si una pieza del arranque no está en el precache.
 */
export function transformarPrecache(dist) {
  return async (entradas) => {
    const arranque = piezasDelArranque(dist);
    const manifest = entradas.filter(({ url }) => {
      if (!url.startsWith("assets/") || !url.endsWith(".js")) return true;
      // Lo que importa el arranque o el POS entra siempre, aunque sea pesado:
      // el POS importa vendor-pdf (el ticket), y sin él no vende sin señal.
      if (arranque.has(url)) return true;
      return /^assets\/vendor-/.test(url) && !PESADOS.test(url);
    });
    const urls = new Set(manifest.map((e) => e.url));
    const faltan = [...arranque].filter((u) => !urls.has(u));
    if (faltan.length) throw new Error(`El arranque necesita piezas que no entran al precache: ${faltan.join(", ")}`);
    return { manifest, warnings: [] };
  };
}
