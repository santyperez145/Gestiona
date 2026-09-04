/**
 * Vista previa para bots: WhatsApp, Instagram, Facebook, Twitter y Google no
 * ejecutan JavaScript, así que los meta tags que la SPA setea en runtime son
 * invisibles para ellos.
 *
 * Corre en el borde y devuelve HTML plano. `vercel.json` la usa SOLO para
 * user-agents de crawlers; el comprador sigue recibiendo la SPA.
 */
import { storeCatalogPage } from "../src/lib/storeCatalogPagination.js";
import { slugsDeRama, type CategoriaTienda } from "../src/lib/storeCategories.js";
import {
  canonicalStorefrontPath,
  parseRutaTienda,
  precioDeCatalogo,
  tituloDeRutaTienda,
} from "../src/lib/storefrontSeo.js";
import {
  lookupStoreSlugByHost,
  publicStoreBaseUrl,
  resolveHostedStoreRequest,
  resolvedStoreOrigin,
} from "../src/lib/storefrontHost.js";

export const config = { runtime: "edge" };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[seo] ${fn} respondió HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[seo] no se pudo consultar ${fn}`, error);
    return null;
  }
}

interface SeoLink {
  href: string;
  label: string;
}

interface SeoCatalogProduct {
  id: string;
  name: string;
  category: string | null;
  featured: boolean | null;
  stock: number | null;
}

async function storeCatalogForSeo(orgId: string): Promise<SeoCatalogProduct[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/store_catalog_products?org_id=eq.${encodeURIComponent(orgId)}&select=id,name,category,featured,stock&order=featured.desc.nullslast,name.asc&limit=5000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!response.ok) {
      console.error(`[seo] store_catalog_products respondió HTTP ${response.status}`);
      return null;
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) return null;
    return (rows as SeoCatalogProduct[]).sort((a, b) => {
      const stock = Number(b.stock) > 0 ? 1 : 0;
      const otherStock = Number(a.stock) > 0 ? 1 : 0;
      return stock - otherStock
        || Number(Boolean(b.featured)) - Number(Boolean(a.featured))
        || String(a.name).localeCompare(String(b.name), "es-AR");
    });
  } catch (error) {
    console.error("[seo] no se pudo leer el catálogo enlazable", error);
    return null;
  }
}

/**
 * ⚠️ `</script>` dentro de un string JSON cierra la etiqueta. El contenido
 * lo escribe el comercio.
 */
const jsonLd = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\u003c").replace(/>/g, "\u003e");

function page(o: {
  title: string;
  description: string;
  url: string;
  homeUrl: string;
  image?: string;
  siteName: string;
  sitemap: string;
  type?: "website" | "product";
  indexable?: boolean;
  datos?: unknown;
  breadcrumbs?: SeoLink[];
  discoverySections?: Array<{ heading: string; links: SeoLink[] }>;
  paginationLinks?: SeoLink[];
}) {
  const indexable = o.indexable !== false;
  const breadcrumbs = (o.breadcrumbs ?? []).length > 1
    ? `<nav aria-label="Migas de pan"><ol>${o.breadcrumbs!.map(link => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join("")}</ol></nav>`
    : "";
  const discovery = (o.discoverySections ?? [])
    .filter(section => section.links.length > 0)
    .map(section => `<section><h2>${esc(section.heading)}</h2><ul>${section.links.map(link => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join("")}</ul></section>`)
    .join("");
  const pagination = (o.paginationLinks ?? []).length > 0
    ? `<nav aria-label="Páginas del catálogo">${o.paginationLinks!.map(link => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join(" ")}</nav>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.url)}">
<link rel="sitemap" type="application/xml" href="${esc(o.sitemap)}">
<meta name="robots" content="${indexable ? "index,follow" : "noindex,nofollow"}">

<meta property="og:type" content="${o.type === "product" ? "product" : "website"}">
<meta property="og:site_name" content="${esc(o.siteName)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:locale" content="es_AR">
${o.image ? `<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:alt" content="${esc(o.title)}">` : ""}

<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
${o.image ? `<meta name="twitter:image" content="${esc(o.image)}">` : ""}
${o.datos ? `<script type="application/ld+json">${jsonLd(o.datos)}</script>` : ""}
</head>
<body>
<header><a href="${esc(o.homeUrl)}">${esc(o.siteName)}</a> <nav aria-label="Navegación principal"><a href="${esc(o.homeUrl)}">Inicio</a> <a href="${esc(o.homeUrl)}/productos">Productos</a></nav></header>
<main>
${breadcrumbs}
<h1>${esc(o.title)}</h1>
<p>${esc(o.description)}</p>
${discovery}
${pagination}
</main>
</body>
</html>`;
}

function storeStructuredGraph(input: {
  homeUrl: string;
  storeName: string;
  store: Record<string, unknown>;
  nodes?: Array<Record<string, unknown>>;
}) {
  const websiteId = `${input.homeUrl}/#website`;
  const storeId = `${input.homeUrl}/#store`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: `${input.homeUrl}/`,
        name: input.storeName,
        inLanguage: "es-AR",
        publisher: { "@id": storeId },
      },
      {
        "@type": "OnlineStore",
        "@id": storeId,
        name: input.storeName,
        url: `${input.homeUrl}/`,
        ...(input.store.logo_url ? { logo: input.store.logo_url } : {}),
        ...(input.store.description ? { description: String(input.store.description).slice(0, 500) } : {}),
      },
      ...(input.nodes ?? []),
    ],
  };
}

function breadcrumbNode(items: SeoLink[]): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: item.href,
    })),
  };
}

const html = (
  body: string,
  status = 200,
  cache = "public, max-age=300",
  extraHeaders: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
      ...extraHeaders,
    },
  });

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolution = await resolveHostedStoreRequest(url, hostname => lookupStoreSlugByHost({
    hostname,
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
  }));
  const hostedSlug = resolution.slug;
  const origin = resolvedStoreOrigin(url, resolution);
  const path = url.searchParams.get("path") ?? url.pathname;
  const ruta = parseRutaTienda(path, url.searchParams, hostedSlug);

  if (!ruta) return new Response("Not found", { status: 404 });

  const homeUrl = publicStoreBaseUrl(origin, ruta.slug, Boolean(hostedSlug));
  const sitemap = `${homeUrl}/sitemap.xml`;
  const stores = await rpc<any[]>("get_store_by_slug", { p_slug: ruta.slug });
  if (stores === null) {
    return html(page({
      title: "Tienda temporalmente no disponible",
      description: "No pudimos cargar esta tienda. Intentá nuevamente en unos minutos.",
      url: homeUrl,
      homeUrl,
      siteName: "Nerqia",
      sitemap: `${origin}/sitemap.xml`,
      indexable: false,
    }), 503, "private, no-store", { "Retry-After": "300" });
  }
  const store = Array.isArray(stores) ? stores[0] : stores;

  if (!store) {
    return html(page({
      title: "Tienda no encontrada",
      description: "Esta tienda no existe o fue desactivada.",
      url: homeUrl,
      homeUrl,
      siteName: "Nerqia",
      sitemap: `${origin}/sitemap.xml`,
      indexable: false,
    }), 404, "public, max-age=60");
  }

  const storeName = store.name ?? "Tienda online";
  const websiteReference = { "@id": `${homeUrl}/#website` };
  const storeReference = { "@id": `${homeUrl}/#store` };

  if (ruta.kind === "private") {
    return html(page({
      title: `${storeName}`,
      description: "Esta pantalla no se indexa.",
      url: `${origin}${path.split("?")[0]}`,
      homeUrl,
      siteName: storeName,
      sitemap,
      indexable: false,
    }), 200, "private, no-store");
  }

  if (ruta.kind === "pdp") {
    const productUrl = `${homeUrl}/producto/${encodeURIComponent(ruta.productId)}`;
    const productUnavailable = (status: 404 | 503, description: string) => html(page({
      title: `${status === 404 ? "Producto no encontrado" : "Producto temporalmente no disponible"} | ${storeName}`,
      description,
      url: productUrl,
      homeUrl,
      siteName: storeName,
      sitemap,
      indexable: false,
      breadcrumbs: [
        { href: homeUrl, label: storeName },
        { href: `${homeUrl}/productos`, label: "Productos" },
      ],
    }), status, status === 503 ? "private, no-store" : "public, max-age=60",
    status === 503 ? { "Retry-After": "300" } : {});
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return productUnavailable(503, "No pudimos cargar este producto. Intentá nuevamente en unos minutos.");
    }
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/store_catalog_products?id=eq.${encodeURIComponent(ruta.productId)}&org_id=eq.${encodeURIComponent(store.org_id)}&select=name,brand,description,sale_price_ars,discount_price_ars,promo_price,image_url,stock&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (!res.ok) {
        console.error(`[seo] producto ${ruta.productId} respondió HTTP ${res.status}`);
        return productUnavailable(503, "No pudimos cargar este producto. Intentá nuevamente en unos minutos.");
      }
      const rows = res.ok ? await res.json() : [];
      const p = rows?.[0];
      if (p) {
        const price = precioDeCatalogo(p);
        const precio = price
          ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(price)
          : "";
        const breadcrumbs = [
          { href: homeUrl, label: storeName },
          { href: `${homeUrl}/productos`, label: "Productos" },
          { href: productUrl, label: String(p.name) },
        ];
        return html(page({
          title: `${p.name}${p.brand ? ` — ${p.brand}` : ""} | ${storeName}`,
          description: [precio, p.description].filter(Boolean).join(" · ").slice(0, 200)
            || `Comprá ${p.name} en ${storeName}.`,
          url: productUrl,
          homeUrl,
          image: p.image_url ?? store.logo_url ?? undefined,
          siteName: storeName,
          sitemap,
          type: "product",
          breadcrumbs,
          datos: storeStructuredGraph({
            homeUrl,
            storeName,
            store,
            nodes: [
              {
                "@type": "Product",
                "@id": `${productUrl}#product`,
                name: p.name,
                url: productUrl,
                ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
                ...(p.description ? { description: String(p.description).slice(0, 500) } : {}),
                ...(p.image_url ? { image: p.image_url } : {}),
                offers: {
                  "@type": "Offer",
                  url: productUrl,
                  priceCurrency: "ARS",
                  price: String(price),
                  availability: Number(p.stock) > 0
                    ? "https://schema.org/InStock"
                    : "https://schema.org/OutOfStock",
                  seller: storeReference,
                },
                isPartOf: websiteReference,
              },
              breadcrumbNode(breadcrumbs),
            ],
          }),
        }));
      }
      return productUnavailable(404, "Este producto no existe o dejó de estar publicado.");
    } catch (error) {
      console.error(`[seo] no se pudo leer el producto ${ruta.productId}`, error);
      return productUnavailable(503, "No pudimos cargar este producto. Intentá nuevamente en unos minutos.");
    }
  }

  if (ruta.kind === "plp") {
    const cat = ruta.cat;
    let nombreCat = cat ? cat.replace(/_/g, " ") : null;
    const [categoriesResult, catalog] = await Promise.all([
      rpc<CategoriaTienda[]>("get_store_categories", { p_slug: ruta.slug }),
      storeCatalogForSeo(store.org_id),
    ]);
    if (categoriesResult === null || catalog === null) {
      return html(page({
        title: `Catálogo temporalmente no disponible | ${storeName}`,
        description: "No pudimos cargar el catálogo. Intentá nuevamente en unos minutos.",
        url: `${homeUrl}/productos`,
        homeUrl,
        siteName: storeName,
        sitemap,
        indexable: false,
      }), 503, "private, no-store", { "Retry-After": "300" });
    }
    const categories = categoriesResult ?? [];
    if (cat) {
      const fila = categories.find(c => c.slug === cat);
      if (fila?.name) nombreCat = fila.name;
    }
    const categorySlugs = cat ? new Set(slugsDeRama(cat, categories)) : null;
    const filteredCatalog = categorySlugs
      ? catalog.filter(product => categorySlugs.has(product.category ?? ""))
      : catalog;
    const window = storeCatalogPage(filteredCatalog.length, ruta.page);
    const normalizedRoute = { ...ruta, page: window.page };
    const canonicalPath = canonicalStorefrontPath(normalizedRoute) ?? "/productos";
    const plpUrl = `${homeUrl}${canonicalPath}`;
    const titulo = tituloDeRutaTienda({
      ruta: normalizedRoute,
      storeName,
      categoryLabel: nombreCat,
    });
    const productsOnPage = filteredCatalog.slice(window.start, window.end);
    const productLinks = productsOnPage.map(product => ({
      href: `${homeUrl}/producto/${encodeURIComponent(product.id)}`,
      label: product.name,
    }));
    const pageHref = (pageNumber: number) => `${homeUrl}${canonicalStorefrontPath({
      ...normalizedRoute,
      page: pageNumber,
    }) ?? "/productos"}`;
    const paginationLinks = [
      ...(window.hasPrevious ? [{ href: pageHref(window.page - 1), label: "Página anterior" }] : []),
      ...(window.hasNext ? [{ href: pageHref(window.page + 1), label: "Página siguiente" }] : []),
    ];
    const productsUrl = `${homeUrl}/productos`;
    const breadcrumbs: SeoLink[] = [
      { href: homeUrl, label: storeName },
      { href: productsUrl, label: "Productos" },
      ...(cat ? [{ href: `${productsUrl}?cat=${encodeURIComponent(cat)}`, label: nombreCat ?? cat }] : []),
    ];
    return html(page({
      title: titulo,
      description: store.meta_description || store.description
        || `Catálogo de ${storeName}. Envíos a todo el país.`,
      url: plpUrl,
      homeUrl,
      image: store.banner_url ?? store.logo_url ?? undefined,
      siteName: storeName,
      sitemap,
      breadcrumbs,
      discoverySections: [{ heading: "Productos de esta página", links: productLinks }],
      paginationLinks,
      datos: storeStructuredGraph({
        homeUrl,
        storeName,
        store,
        nodes: [
          {
            "@type": "CollectionPage",
            "@id": `${plpUrl}#collection`,
            name: titulo,
            url: plpUrl,
            isPartOf: websiteReference,
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: productsOnPage.length,
              itemListElement: productLinks.map((product, index) => ({
                "@type": "ListItem",
                position: window.start + index + 1,
                name: product.label,
                url: product.href,
              })),
            },
          },
          breadcrumbNode(breadcrumbs),
        ],
      }),
    }));
  }

  if (ruta.kind === "page") {
    const pages = await rpc<Array<{ slug: string; title: string; meta_description: string | null; updated_at: string }>>(
      "get_store_pages",
      { p_slug: ruta.slug },
    );
    if (pages === null) {
      return html(page({
        title: `Página temporalmente no disponible | ${storeName}`,
        description: "No pudimos cargar esta página. Intentá nuevamente en unos minutos.",
        url: `${homeUrl}/pagina/${encodeURIComponent(ruta.pageSlug)}`,
        homeUrl,
        siteName: storeName,
        sitemap,
        indexable: false,
      }), 503, "private, no-store", { "Retry-After": "300" });
    }
    const pagina = (pages ?? []).find(p => p.slug === ruta.pageSlug);
    if (!pagina) {
      return html(page({
        title: `Página no encontrada | ${storeName}`,
        description: "Esta página no está publicada.",
        url: `${homeUrl}/pagina/${encodeURIComponent(ruta.pageSlug)}`,
        homeUrl,
        siteName: storeName,
        sitemap,
        indexable: false,
      }), 404, "public, max-age=60");
    }
    const pageUrl = `${homeUrl}/pagina/${encodeURIComponent(pagina.slug)}`;
    return html(page({
      title: `${pagina.title} | ${storeName}`,
      description: pagina.meta_description || pagina.title,
      url: pageUrl,
      homeUrl,
      image: store.logo_url ?? undefined,
      siteName: storeName,
      sitemap,
      breadcrumbs: [{ href: homeUrl, label: storeName }, { href: pageUrl, label: pagina.title }],
      datos: storeStructuredGraph({
        homeUrl,
        storeName,
        store,
        nodes: [{
          "@type": "WebPage",
          name: pagina.title,
          url: pageUrl,
          dateModified: pagina.updated_at,
          isPartOf: websiteReference,
        }],
      }),
    }));
  }

  if (ruta.kind === "legal") {
    const legalUrl = `${homeUrl}/arrepentimiento`;
    return html(page({
      title: `Botón de arrepentimiento | ${storeName}`,
      description: `Ejercé el derecho de arrepentimiento en ${storeName}.`,
      url: legalUrl,
      homeUrl,
      siteName: storeName,
      sitemap,
      breadcrumbs: [{ href: homeUrl, label: storeName }, { href: legalUrl, label: "Arrepentimiento" }],
      datos: storeStructuredGraph({
        homeUrl,
        storeName,
        store,
        nodes: [{
          "@type": "WebPage",
          name: "Botón de arrepentimiento",
          url: legalUrl,
          isPartOf: websiteReference,
        }],
      }),
    }));
  }

  const [categoriesResult, catalog] = await Promise.all([
    rpc<CategoriaTienda[]>("get_store_categories", { p_slug: ruta.slug }),
    storeCatalogForSeo(store.org_id),
  ]);
  if (categoriesResult === null || catalog === null) {
    return html(page({
      title: `Tienda temporalmente no disponible | ${storeName}`,
      description: "No pudimos cargar la tienda. Intentá nuevamente en unos minutos.",
      url: homeUrl,
      homeUrl,
      siteName: storeName,
      sitemap,
      indexable: false,
    }), 503, "private, no-store", { "Retry-After": "300" });
  }
  const categories = categoriesResult ?? [];
  const categoryLinks = categories
    .filter(category => catalog.some(product => slugsDeRama(category.slug, categories).includes(product.category ?? "")))
    .map(category => ({
      href: `${homeUrl}/productos?cat=${encodeURIComponent(category.slug)}`,
      label: category.name,
    }));
  const featuredProductLinks = catalog.slice(0, 12).map(product => ({
    href: `${homeUrl}/producto/${encodeURIComponent(product.id)}`,
    label: product.name,
  }));
  return html(page({
    title: store.meta_title || `${storeName} — Tienda online`,
    description: store.meta_description || store.description
      || `Comprá online en ${storeName}. Envíos a todo el país.`,
    url: homeUrl,
    homeUrl,
    image: store.banner_url ?? store.logo_url ?? undefined,
    siteName: storeName,
    sitemap,
    discoverySections: [
      { heading: "Categorías", links: categoryLinks },
      { heading: "Productos destacados", links: featuredProductLinks },
    ],
    datos: storeStructuredGraph({ homeUrl, storeName, store }),
  }));
}
