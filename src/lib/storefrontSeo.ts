/**
 * SEO y precio de la vitrina pública, en un solo lugar.
 *
 * Los crawlers no ejecutan la SPA: título, canonical, JSON-LD y el sitemap
 * tienen que salir del borde. El precio que se declara a Google tiene que ser
 * el mismo que cobra `resolve_store_line`. Si divergen, el rich result miente
 * y Search Console deja de mostrar el precio de toda la tienda.
 */

export const STOREFRONT_CRAWLER_UA =
  "facebookexternalhit|Facebot|facebookcatalog|WhatsApp|Twitterbot|Slackbot|" +
  "LinkedInBot|TelegramBot|Discordbot|Googlebot|Google-InspectionTool|" +
  "AdsBot-Google|Storebot-Google|GoogleOther|bingbot|BingPreview|DuckDuckBot|" +
  "YandexBot|Applebot|Pinterest|redditbot|SkypeUriPreview|vkShare|" +
  "W3C_Validator|embedly";

/** Rutas del panel: gastar presupuesto de rastreo acá no vende. */
export const ROBOTS_DISALLOW_PANEL = [
  "/configuracion",
  "/productos",
  "/ventas",
  "/clientes",
  "/caja",
  "/reportes",
  "/admin",
  "/perfil",
  "/equipo",
  "/integraciones",
  "/onboarding",
  "/platform",
  "/finance",
  "/login",
  "/tienda-online",
] as const;

/** Recorridos de comprador que no son catálogo. */
export const ROBOTS_DISALLOW_TIENDA = [
  "/tienda/*/checkout",
  "/tienda/*/cuenta",
  "/tienda/*/orden",
  "/tienda/*/carrito",
] as const;

export interface PrecioDeCatalogo {
  sale_price_ars?: number | null;
  discount_price_ars?: number | null;
  promo_price?: number | null;
}

/**
 * El precio que ve el comprador. Espejo de `resolve_store_line`.
 * Oferta manual vs lista, y después la promoción si mejora.
 */
export function precioDeCatalogo(p: PrecioDeCatalogo): number {
  const lista = Number(p.sale_price_ars) || 0;
  const oferta = Number(p.discount_price_ars) || 0;
  const vigente = oferta > 0 && oferta < lista ? oferta : lista;
  const promo = Number(p.promo_price) || 0;
  return promo > 0 && promo < vigente ? promo : vigente;
}

export type RutaTienda =
  | { kind: "home"; slug: string }
  | { kind: "plp"; slug: string; cat: string | null }
  | { kind: "pdp"; slug: string; productId: string }
  | { kind: "page"; slug: string; pageSlug: string }
  | { kind: "legal"; slug: string }
  | { kind: "private"; slug: string };

function slugLimpio(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Interpreta la URL pública de una tienda. El rewrite de Vercel manda el path
 * original en `?path=`; la query de categoría viaja aparte.
 */
export function parseRutaTienda(path: string, search: URLSearchParams | { get(name: string): string | null } = new URLSearchParams()): RutaTienda | null {
  const raw = path.split("?")[0] ?? "";
  const partes = raw.split("/").filter(Boolean);
  if (partes[0] !== "tienda" || !partes[1]) return null;

  const slug = slugLimpio(partes[1]);
  const resto = partes.slice(2);

  if (resto.length === 0) return { kind: "home", slug };

  const [seccion, id] = resto;
  if (seccion === "productos" && resto.length === 1) {
    const cat = search.get("cat");
    return { kind: "plp", slug, cat: cat && cat.trim() ? cat : null };
  }
  if (seccion === "producto" && id) {
    return { kind: "pdp", slug, productId: slugLimpio(id) };
  }
  if (seccion === "pagina" && id) {
    return { kind: "page", slug, pageSlug: slugLimpio(id) };
  }
  if (seccion === "arrepentimiento" && resto.length === 1) {
    return { kind: "legal", slug };
  }
  if (["checkout", "cuenta", "orden", "carrito"].includes(seccion)) {
    return { kind: "private", slug };
  }
  return { kind: "private", slug };
}

export function tituloDeRutaTienda(input: {
  ruta: RutaTienda | null;
  storeName: string;
  metaTitle?: string | null;
  productName?: string | null;
  categoryLabel?: string | null;
  pageTitle?: string | null;
}): string {
  const tienda = input.storeName.trim() || "Tienda";
  const meta = input.metaTitle?.trim();
  const home = meta || `${tienda} — Tienda online`;

  if (!input.ruta || input.ruta.kind === "home") return home;

  if (input.ruta.kind === "pdp") {
    const prod = input.productName?.trim();
    return prod ? `${prod} — ${tienda}` : home;
  }
  if (input.ruta.kind === "plp") {
    const cat = input.categoryLabel?.trim();
    return cat ? `${cat} — ${tienda}` : `Productos — ${tienda}`;
  }
  if (input.ruta.kind === "page") {
    const page = input.pageTitle?.trim();
    return page ? `${page} — ${tienda}` : home;
  }
  if (input.ruta.kind === "legal") return `Botón de arrepentimiento — ${tienda}`;
  const privada = input.pageTitle?.trim();
  return privada ? `${privada} — ${tienda}` : home;
}

export function cuerpoRobots(origin: string, sitemaps: string[]): string {
  const lineas = [
    "User-agent: *",
    "Allow: /",
    "",
    "# El panel de gestión no aporta nada en los buscadores y solo gasta",
    "# presupuesto de rastreo: lo que interesa indexar son las tiendas.",
    ...ROBOTS_DISALLOW_PANEL.map(p => `Disallow: ${p}`),
    "",
    "# Checkout, cuenta y seguimiento no son catálogo.",
    ...ROBOTS_DISALLOW_TIENDA.map(p => `Disallow: ${p}`),
    "",
    "Allow: /tienda/",
    "Allow: /catalogo/",
    "",
  ];
  const unicos = [...new Set(sitemaps.filter(Boolean))];
  if (unicos.length === 0) {
    lineas.push("# El índice de sitemaps se declara cuando hay una tienda activa.");
  } else {
    for (const loc of unicos) {
      const href = loc.startsWith("http")
        ? loc
        : `${origin}${loc.startsWith("/") ? loc : `/${loc}`}`;
      lineas.push(`Sitemap: ${href}`);
    }
  }
  return `${lineas.join("\n")}\n`;
}
