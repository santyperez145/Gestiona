import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-10-21: el ingreso le mostraba al comercio «Meta Cloud Messaging tiene
 * que estar probado (`whatsapp_listo`)», y otras pantallas nombraban columnas
 * (`custom_fields`, `created_at`) o pedían configurar `email_dominio`. Este test
 * busca identificadores con guion bajo en el texto visible de las pantallas de
 * comercio (las de staff de plataforma pueden hablar técnico).
 */
const PERMITIDOS = new Set([
  "utm_source", "utm_medium", "utm_campaign", // términos estándar de marketing
  "promo_mayo", "banner_rojo", // ejemplos de valores UTM
  "nombre_producto", // variables de plantilla entre llaves
]);
const IDENT = /(?<![\w.$\-/{])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w(}])/g;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return /test|integrations/.test(nombre) ? [] : archivos(ruta);
    return ruta.endsWith(".tsx") && !/latform/.test(ruta) ? [ruta] : [];
  });
}

describe("las pantallas de comercio no muestran jerga técnica", () => {
  it("ningún identificador con guion bajo en texto visible", () => {
    const hallazgos: string[] = [];
    for (const ruta of archivos("src")) {
      readFileSync(ruta, "utf8").split("\n").forEach((linea, i) => {
        const limpia = linea.trim();
        if (/^(\/\/|\*|\/\*|import|case |const |let |if |return )/.test(limpia)) return;
        const textos = [
          // Un «;» delata un tipo genérico (Record<…>; …), no texto visible.
          ...[...linea.matchAll(/>([^<>{}]+)</g)].map(m => m[1]).filter(t => !t.includes(";")),
          ...[...linea.matchAll(/(?:toast\.\w+\(|title=|description=|label=|placeholder=)\s*[`"']([^`"']+)[`"']/g)].map(m => m[1].replace(/\$\{[^}]*\}/g, "")),
        ];
        for (const texto of textos) {
          for (const [, palabra] of texto.matchAll(IDENT)) {
            if (!PERMITIDOS.has(palabra)) hallazgos.push(`${ruta}:${i + 1}: ${palabra}`);
          }
        }
      });
    }
    expect(hallazgos).toEqual([]);
  });
});
