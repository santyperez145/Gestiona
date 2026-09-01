import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La tienda se deja encontrar.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Medido el 2026-08-28 pidiendo la tienda real con el user-agent de un
 * crawler: la vista previa de WhatsApp está **bien resuelta** —nombre,
 * descripción e imagen del comercio, no de Gestiona— porque `vercel.json`
 * reescribe `/tienda/*` a `/api/og` cuando el visitante es un bot.
 *
 * ⚠️ Pero **no había un solo dato estructurado**: 0 bloques
 * `application/ld+json` en la home y en las fichas. Sin `Product` + `offers`,
 * el resultado de Google es un link azul; con ellos muestra **el precio y si
 * hay stock** al lado del título. Tiendanube y Shopify lo emiten desde
 * siempre, y para un comercio chico la búsqueda orgánica es el canal que no
 * se paga.
 *
 * 📌 Y hay una trampa de seguridad propia del JSON-LD: un `</script>` dentro
 * del nombre o la descripción de un producto **cierra la etiqueta** y lo que
 * sigue se ejecuta como HTML. El contenido lo escribe el comercio, así que no
 * es hipotético.
 */

const OG = readFileSync(join(process.cwd(), "api", "og.ts"), "utf8");

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const cuerpo = sinComentarios(OG);

describe("la tienda se deja encontrar", () => {
  it("emite datos estructurados", () => {
    expect(cuerpo).toMatch(/application\/ld\+json/);
  });

  it("la ficha declara Product con precio y disponibilidad", () => {
    // Sin `offers`, Google no muestra el precio: es la mitad que importa.
    expect(cuerpo).toMatch(/"@type":\s*"Product"/);
    expect(cuerpo).toMatch(/"@type":\s*"Offer"/);
    expect(cuerpo).toMatch(/priceCurrency/);
    expect(cuerpo).toMatch(/availability/);
  });

  it("la disponibilidad sale del stock real, no de un valor fijo", () => {
    /**
     * ⚠️ Declarar «InStock» siempre hace que Google marque el dato como
     * engañoso y deje de mostrar el precio de **toda** la tienda, no sólo del
     * producto agotado.
     */
    expect(
      cuerpo,
      "availability está escrito a mano en vez de mirar el stock",
    ).toMatch(/stock\)\s*>\s*0[\s\S]{0,120}InStock/);
    expect(cuerpo, "no contempla el caso agotado").toMatch(/OutOfStock/);
  });

  it("el select trae el stock que la disponibilidad necesita", () => {
    // Pedir de menos no falla: llega undefined, `Number(undefined) > 0` es
    // false, y toda la tienda quedaría declarada agotada.
    const select = cuerpo.match(/store_catalog_products[^`]*select=([^&`]*)/)?.[1] ?? "";
    expect(select, `el select no pide stock: «${select}»`).toContain("stock");
  });

  it("la home se declara como un comercio", () => {
    expect(cuerpo).toMatch(/"@type":\s*"Store"/);
  });

  it("el listado no se declara como la home", () => {
    expect(cuerpo).toMatch(/"@type":\s*"CollectionPage"/);
    expect(cuerpo).toMatch(/parseRutaTienda/);
  });

  it("la ficha declara og:type product y el precio que se cobra", () => {
    expect(cuerpo).toMatch(/type === "product"/);
    expect(cuerpo).toMatch(/precioDeCatalogo/);
    const select = cuerpo.match(/store_catalog_products[^`]*select=([^&`]*)/)?.[1] ?? "";
    expect(select, `el select no pide promo_price: «${select}»`).toContain("promo_price");
    expect(select).toContain("stock");
  });

  it("⚠️ el JSON-LD se escapa: un </script> en un nombre no cierra la etiqueta", () => {
    /**
     * El contenido viene del comercio. `JSON.stringify` **no** escapa `<` ni
     * `>`, así que un producto llamado `</script><img onerror=…>` se
     * ejecutaría en la página que ve el crawler — y en la que ve cualquiera
     * que abra la vista previa.
     */
    expect(
      cuerpo,
      "el JSON-LD se serializa sin escapar < y >: un </script> en un nombre de producto rompe la etiqueta",
    ).toMatch(/replace\(\/<\/g[\s\S]{0,40}u003c/);
    expect(cuerpo).toMatch(/replace\(\/>\/g[\s\S]{0,40}u003e/);
  });
});
