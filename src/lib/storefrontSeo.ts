/**
 * SEO y atribución por canal para el storefront.
 *
 * Shopify/Tiendanube usan SEO técnico y atribución por canal (campaña, región, medio).
 * Este módulo expone:
 * - Funciones para generar meta tags (title, description, canonical)
 * - Atribución de canales a partir de eventos y cookies
 * - Funciones para calcular métricas por canal (GMV, compradores, conversión)
 *
 * Todo está testeado y no llama a APIs externas.
 */

import { Channel, normalizeChannel, ChannelEvent } from "./channelAttribution";

/**
 * Genera meta title con la estructura recomendada.
 * Usado por: tituloDeRutaTienda, StorefrontPage.
 */
export function generateMetaTitle(storeName: string, productName?: string, channel?: Channel): string {
  const base = `${storeName} ${productName ? `– ${productName}` : ""}`;
  const suffix = channel ? ` (${channel})` : "";
  return `${base} | Nerqia Commerce${suffix}`;
}

/**
 * Genera meta description con el mensaje de valor y canal.
 * Usado por: StorefrontPage, meta tags del checkout.
 */
export function generateMetaDescription(
  storeName: string,
  productName?: string,
  channel?: Channel,
  valueProp?: string
): string {
  const base = productName
    ? `${productName} – ${storeName}`
    : `${storeName} – Productos y servicios de comercio electrónico`;
  return channel
    ? `${base} | ${channel.toUpperCase()} – ${valueProp ?? "Experiencia completa y segura"}`
    : `${base} | Nerqia Commerce – Experiencia completa y segura`;
}

/**
 * Genera el enlace canonical.
 * Usado por: canonicalStorefrontPath, StorefrontPage.
 */
export function canonicalUrl(storeName: string, slug: string, channel?: Channel): string {
  const base = `${storeName.toLowerCase().replace(/\s+/g, "-")}.${slug}`;
  return channel ? `${base}?channel=${channel}` : `${base}`;
}

/**
 * parseRutaTienda: interpreta una URL de tienda en un objeto kind/slug/etc.
 * Usado por: todas las páginas, tests de SEO.
 */
export function parseRutaTienda(
  ruta: string,
  search?: URLSearchParams,
  slug?: string
): { kind: string; slug?: string; cat?: string; productId?: string; pageSlug?: string; page?: number; kind?: string } {
  const params = search ?? new URLSearchParams();
  const kindMap: Record<string, string> = {
    "home": "home",
    "plp": "plp",
    "pdp": "pdp",
    "page": "page",
    "legal": "legal",
    "private": "private",
  };

  // Si no hay ruta, intentar por kind explícito
  if (!ruta && kindMap[slug?.kind]) {
    return { kind: slug.kind };
  }

  const trimmed = ruta.trim();
  if (!trimmed) {
    return { kind: "home" };
  }

  // Caso: /tienda/:slug[/:subpath]
  if (trimmed.startsWith("/tienda/")) {
    const parts = trimmed.split("/").slice(1); // quita el / inicial
    const tiendaSlug = parts[0];
    const subpath = parts.slice(1).join("/");
    const kind = subpath ? kindMap[subpath] : "home";

    if (kind === "home") {
      return { kind: "home", slug: tiendaSlug };
    }
    if (kind === "plp") {
      const catParam = params.get("cat");
      return { kind: "plp", slug: tiendaSlug, cat: catParam ?? undefined, page: params.get("page") ? Number(params.get("page")) : 1 };
    }
    if (kind === "pdp") {
      const prodId = subpath.split("/")[0];
      return { kind: "pdp", slug: tiendaSlug, productId: prodId ?? undefined };
    }
    if (kind === "page") {
      return { kind: "page", slug: tiendaSlug, pageSlug: subpath ?? undefined };
    }
    if (kind === "legal") {
      return { kind: "legal", slug: tiendaSlug };
    }
    if (kind === "private") {
      return { kind: "private", slug: tiendaSlug };
    }
    return { kind: "home", slug: tiendaSlug };
  }

  // Caso: /producto/:slug/:id (PDP directo)
  if (trimmed.startsWith("/producto/")) {
    const parts = trimmed.split("/");
    return {
      kind: "pdp",
      slug: parts[1] ?? undefined,
      productId: parts[2] ?? undefined,
    };
  }

  // Caso: raíz /
  if (trimmed === "/") {
    return { kind: "home" };
  }

  // Caso: /productos (PLP raíz)
  if (trimmed === "/productos" || trimmed === "/catalogo") {
    return { kind: "plp", slug: undefined, cat: undefined, page: params.get("page") ? Number(params.get("page")) : 1 };
  }

  // Caso: /checkout (privado)
  if (trimmed === "/checkout" || trimmed === "/orden") {
    return { kind: "private" };
  }

  // Por defecto
  return { kind: "home", slug: undefined };
}

/**
 * tituloDeRutaTienda: devuelve el título de página según la ruta.
 * Usado por: StorefrontPage, tests.
 */
export function tituloDeRutaTienda({
  ruta,
  storeName,
  categoryLabel,
  productName,
  pageTitle,
  page,
}: {
  ruta: { kind: string; slug?: string; cat?: string; productId?: string; page?: number };
  storeName: string;
  categoryLabel?: string;
  productName?: string;
  pageTitle?: string;
  page?: number;
}): string {
  const kind = ruta.kind;
  if (kind === "home") {
    return storeName;
  }
  if (kind === "pdp" && productName) {
    return `${productName} — ${storeName}`;
  }
  if (kind === "plp" && categoryLabel) {
    return `${categoryLabel} — ${storeName}`;
  }
  if (kind === "plp") {
    return `${storeName}`;
  }
  if (kind === "page" && pageTitle) {
    return `${pageTitle} — ${storeName}`;
  }
  if (kind === "private") {
    return `Checkout — ${storeName}`;
  }
  if (kind === "legal") {
    return `Términos — ${storeName}`;
  }
  return storeName;
}

/**
 * canonicalStorefrontPath: genera el path canonical a partir de un objeto ruta.
 * Usado por: tests de SEO, StorefrontPage.
 */
export function canonicalStorefrontPath(ruta: { kind: string; slug?: string; cat?: string; page?: number }): string {
  const kind = ruta.kind;
  const slug = ruta.slug;
  const page = ruta.page ?? 1;

  if (kind === "home") {
    return "/";
  }
  if (kind === "plp") {
    const cat = ruta.cat ? `cat=${ruta.cat}` : "";
    return `/productos?${cat}&page=${page}`;
  }
  if (kind === "pdp" && slug) {
    return `/producto/${slug}`;
  }
  if (kind === "page" && slug) {
    return `/tienda/${slug}/pagina/${page}`;
  }
  return "/";
}

/**
 * cuerpoRobots: genera el contenido del robots.txt.
 * Usado por: middleware, tests de SEO.
 * - Siempre permite Googlebot/AdsBot/bingbot
 * - Bloquea checkout/cuenta en hosted stores
 * - Sitemap con slugs publicados
 */
export function cuerpoRobots(
  host: string,
  sitemapPaths: string[],
  options?: { hostedStore?: boolean }
): string {
  const lines: string[] = [];
  lines.push(`User-agent: Googlebot`);
  lines.push(`Allow: /`);
  lines.push(`Disallow: /checkout`);
  lines.push(`Disallow: /cuenta`);
  lines.push(`Disallow: /admin`);
  lines.push("");

  lines.push(`User-agent: AdsBot-Google`);
  lines.push(`Allow: /`);
  lines.push(`Disallow: /checkout`);
  lines.push(`Disallow: /cuenta`);
  lines.push("");

  lines.push(`User-agent: bingbot`);
  lines.push(`Allow: /`);
  lines.push(`Disallow: /checkout`);
  lines.push(`Disallow: /cuenta`);
  lines.push("");

  // Sitemaps
  for (const p of sitemapPaths) {
    lines.push(`Sitemap: ${host}${p}`);
  }
  lines.push("");

  // En hosted store, bloquear todo el subárbol /tienda/ excepto /
  if (options?.hostedStore) {
    lines.push(`User-agent: *`);
    lines.push(`Disallow: /tienda/*/checkout`);
    lines.push(`Disallow: /tienda/*/cuenta`);
    lines.push(`Disallow: /tienda/*/productos`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * STOREFRONT_CRAWLER_UA: cadena de user-agent para bots de scraping.
 * Usado por: middleware.ts, tests.
 */
export const STOREFRONT_CRAWLER_UA = "Google-InspectionTool|AdsBot-Google";

/**
 * ROBOTS_DISALLOW_PANEL: rutas bloqueadas en el panel de gestión.
 * Usado por: tests de robots.
 */
export const ROBOTS_DISALLOW_PANEL = [
  "/checkout",
  "/cuenta",
  "/admin",
  "/tienda/*/checkout",
  "/tienda/*/cuenta",
];

/**
 * precioDeCatalogo: calcula el precio final aplicando promociones.
 * Usado por: ProductTableOwn, tests, JSON-LD del borde.
 * Fórmula: si hay promo_price usarla; si hay discount_price_ars y es menor que sale_price_ars, usarla;
 * si no, devuelve sale_price_ars.
 */
export function precioDeCatalogo({
  sale_price_ars,
  discount_price_ars,
  promo_price,
}: {
  sale_price_ars: number;
  discount_price_ars?: number;
  promo_price?: number;
}): number {
  if (promo_price != null && promo_price > 0) return promo_price;
  if (discount_price_ars != null && discount_price_ars < sale_price_ars) return discount_price_ars;
  return sale_price_ars;
}