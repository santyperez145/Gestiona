import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cuerpoRobots,
  parseRutaTienda,
  precioDeCatalogo,
  ROBOTS_DISALLOW_PANEL,
  STOREFRONT_CRAWLER_UA,
  tituloDeRutaTienda,
} from "@/lib/storefrontSeo";

const leer = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("precio canónico de la vitrina", () => {
  it("la promoción gana si mejora la oferta, y no si es peor", () => {
    expect(precioDeCatalogo({ sale_price_ars: 1000, discount_price_ars: 800, promo_price: 700 })).toBe(700);
    expect(precioDeCatalogo({ sale_price_ars: 1000, discount_price_ars: 800, promo_price: 900 })).toBe(800);
    expect(precioDeCatalogo({ sale_price_ars: 1000, discount_price_ars: 0, promo_price: 0 })).toBe(1000);
  });
});

describe("rutas públicas de la tienda", () => {
  it("distingue home, listado, ficha y página, y no indexa el checkout", () => {
    expect(parseRutaTienda("/tienda/exentryimports")).toEqual({ kind: "home", slug: "exentryimports" });
    expect(parseRutaTienda("/tienda/exentryimports/productos")).toEqual({
      kind: "plp", slug: "exentryimports", cat: null,
    });
    expect(parseRutaTienda("/tienda/exentryimports/productos", new URLSearchParams("cat=vaper"))).toEqual({
      kind: "plp", slug: "exentryimports", cat: "vaper",
    });
    expect(parseRutaTienda("/tienda/exentryimports/producto/abc")).toEqual({
      kind: "pdp", slug: "exentryimports", productId: "abc",
    });
    expect(parseRutaTienda("/tienda/exentryimports/pagina/privacidad")).toEqual({
      kind: "page", slug: "exentryimports", pageSlug: "privacidad",
    });
    expect(parseRutaTienda("/tienda/exentryimports/arrepentimiento")?.kind).toBe("legal");
    expect(parseRutaTienda("/tienda/exentryimports/checkout")?.kind).toBe("private");
    expect(parseRutaTienda("/tienda/exentryimports/productos")?.kind).not.toBe("home");
  });

  it("interpreta las mismas rutas limpias cuando el slug viene del host", () => {
    expect(parseRutaTienda("/", new URLSearchParams(), "mi-tienda"))
      .toEqual({ kind: "home", slug: "mi-tienda" });
    expect(parseRutaTienda("/producto/abc", new URLSearchParams(), "mi-tienda"))
      .toEqual({ kind: "pdp", slug: "mi-tienda", productId: "abc" });
    expect(parseRutaTienda("/checkout", new URLSearchParams(), "mi-tienda")?.kind)
      .toBe("private");
  });

  it("el título de la pestaña nombra el producto, no sólo la tienda", () => {
    const base = {
      storeName: "Exentry Imports",
      metaTitle: "Exentry — perfumes",
    };
    expect(tituloDeRutaTienda({
      ...base, ruta: { kind: "home", slug: "exentryimports" },
    })).toBe("Exentry — perfumes");
    expect(tituloDeRutaTienda({
      ...base,
      ruta: { kind: "pdp", slug: "exentryimports", productId: "abc" },
      productName: "Afnan 9am Dive",
    })).toBe("Afnan 9am Dive — Exentry Imports");
    expect(tituloDeRutaTienda({
      ...base,
      ruta: { kind: "plp", slug: "exentryimports", cat: "vaper" },
      categoryLabel: "Vaper",
    })).toBe("Vaper — Exentry Imports");
    expect(tituloDeRutaTienda({
      ...base,
      ruta: { kind: "page", slug: "exentryimports", pageSlug: "privacidad" },
      pageTitle: "Privacidad",
    })).toBe("Privacidad — Exentry Imports");
    expect(tituloDeRutaTienda({
      ...base,
      ruta: { kind: "private", slug: "exentryimports" },
      pageTitle: "Checkout",
    })).toBe("Checkout — Exentry Imports");
  });

  it("StorefrontPage aplica el título por ruta, no un título único de tienda", () => {
    const pagina = leer("src/pages/StorefrontPage.tsx");
    expect(pagina).toContain("tituloDeRutaTienda");
    expect(pagina).toContain("parseRutaTienda");
    expect(pagina).not.toContain("document.title = store.meta_title");
  });
});

describe("robots e índice salen del servidor", () => {
  it("declara Sitemap y no deja el checkout al rastreo", () => {
    const txt = cuerpoRobots("https://ejemplo.test", ["/sitemap.xml", "/tienda/demo/sitemap.xml"]);
    expect(txt).toContain("Sitemap: https://ejemplo.test/sitemap.xml");
    expect(txt).toContain("Sitemap: https://ejemplo.test/tienda/demo/sitemap.xml");
    expect(txt).toContain("Disallow: /tienda/*/checkout");
    expect(txt).toContain("Disallow: /platform");
  });

  it("en un host de tienda niega checkout/cuenta sin el prefijo heredado", () => {
    const txt = cuerpoRobots("https://demo.nerqia.app", ["/sitemap.xml"], { hostedStore: true });
    expect(txt).toContain("Disallow: /checkout");
    expect(txt).toContain("Disallow: /cuenta");
    expect(txt).not.toContain("Disallow: /tienda/*/checkout");
    expect(txt).not.toContain("Disallow: /productos");
    expect(txt).not.toContain("# El panel de gestión");
  });

  it("Search Console y AdsBot pasan por el middleware previo al filesystem", () => {
    const vercel = JSON.parse(leer("vercel.json")) as {
      rewrites: Array<{ destination?: string; has?: Array<{ value: string }>; source: string }>;
    };
    const routingMiddleware = leer("middleware.ts");
    expect(routingMiddleware).toContain("STOREFRONT_CRAWLER_UA");
    expect(routingMiddleware).toContain("source.pathname = '/api/og'");
    expect(STOREFRONT_CRAWLER_UA).toContain("Google-InspectionTool");
    expect(STOREFRONT_CRAWLER_UA).toContain("AdsBot-Google");
    expect(vercel.rewrites[0]?.source).toBe("/robots.txt");
    expect(vercel.rewrites.some(r => r.source === "/sitemap.xml")).toBe(true);
  });

  it("no hay robots.txt estático: en Vercel el archivo tapa el rewrite", () => {
    /**
     * Medido el 2026-09-01: el borde ya listaba sitemaps y producción seguía
     * sirviendo el comentario. Un archivo en `public/` se copia a `dist/` y
     * Vercel lo entrega antes de aplicar rewrites. Sin archivo, `/robots.txt`
     * llega a `api/robots`.
     */
    expect(existsSync(resolve(process.cwd(), "public/robots.txt"))).toBe(false);
    const borde = leer("api/robots.ts");
    expect(borde).toContain("cuerpoRobots");
    expect(borde).toContain("list_published_store_slugs");
    const txt = cuerpoRobots("https://ejemplo.test", ["/sitemap.xml"]);
    for (const path of ROBOTS_DISALLOW_PANEL) {
      expect(txt, `cuerpoRobots no niega ${path}`).toContain(`Disallow: ${path}`);
    }
  });
});
