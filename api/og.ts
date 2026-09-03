/**
 * Vista previa para bots: WhatsApp, Instagram, Facebook, Twitter y Google no
 * ejecutan JavaScript, así que los meta tags que la SPA setea en runtime son
 * invisibles para ellos.
 *
 * Corre en el borde y devuelve HTML plano. `vercel.json` la usa SOLO para
 * user-agents de crawlers; el comprador sigue recibiendo la SPA.
 */
import { parseRutaTienda, precioDeCatalogo } from "../src/lib/storefrontSeo.js";
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
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
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
  image?: string;
  siteName: string;
  sitemap: string;
  type?: "website" | "product";
  indexable?: boolean;
  datos?: unknown;
}) {
  const indexable = o.indexable !== false;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
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
<h1>${esc(o.title)}</h1>
<p>${esc(o.description)}</p>
<p><a href="${esc(o.url)}">Ver la tienda</a></p>
</body>
</html>`;
}

const html = (body: string, status = 200, cache = "public, max-age=300") =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache },
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
  const store = Array.isArray(stores) ? stores[0] : stores;

  if (!store) {
    return html(page({
      title: "Tienda no encontrada",
      description: "Esta tienda no existe o fue desactivada.",
      url: homeUrl,
      siteName: "Nerqia",
      sitemap: `${origin}/sitemap.xml`,
      indexable: false,
    }), 404, "public, max-age=60");
  }

  const storeName = store.name ?? "Tienda online";
  const storeDatos = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: storeName,
    url: homeUrl,
    ...(store.logo_url ? { logo: store.logo_url } : {}),
    ...(store.description ? { description: String(store.description).slice(0, 500) } : {}),
  };

  if (ruta.kind === "private") {
    return html(page({
      title: `${storeName}`,
      description: "Esta pantalla no se indexa.",
      url: `${origin}${path.split("?")[0]}`,
      siteName: storeName,
      sitemap,
      indexable: false,
    }), 200, "private, no-store");
  }

  if (ruta.kind === "pdp" && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/store_catalog_products?id=eq.${encodeURIComponent(ruta.productId)}&org_id=eq.${encodeURIComponent(store.org_id)}&select=name,brand,description,sale_price_ars,discount_price_ars,promo_price,image_url,stock&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const rows = res.ok ? await res.json() : [];
      const p = rows?.[0];
      if (p) {
        const price = precioDeCatalogo(p);
        const precio = price
          ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(price)
          : "";
        const productUrl = `${homeUrl}/producto/${encodeURIComponent(ruta.productId)}`;
        return html(page({
          title: `${p.name}${p.brand ? ` — ${p.brand}` : ""} | ${storeName}`,
          description: [precio, p.description].filter(Boolean).join(" · ").slice(0, 200)
            || `Comprá ${p.name} en ${storeName}.`,
          url: productUrl,
          image: p.image_url ?? store.logo_url ?? undefined,
          siteName: storeName,
          sitemap,
          type: "product",
          datos: {
            "@context": "https://schema.org",
            "@type": "Product",
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
              seller: { "@type": "Organization", name: storeName },
            },
          },
        }));
      }
    } catch { /* cae a la home */ }
  }

  if (ruta.kind === "plp") {
    const cat = ruta.cat;
    let nombreCat = cat ? cat.replace(/_/g, " ") : null;
    if (cat) {
      const cats = await rpc<Array<{ slug: string; name: string }>>("get_store_categories", { p_slug: ruta.slug });
      const fila = (cats ?? []).find(c => c.slug === cat);
      if (fila?.name) nombreCat = fila.name;
    }
    const plpUrl = cat
      ? `${homeUrl}/productos?cat=${encodeURIComponent(cat)}`
      : `${homeUrl}/productos`;
    const titulo = nombreCat
      ? `${nombreCat} — ${storeName}`
      : `Productos — ${storeName}`;
    return html(page({
      title: titulo,
      description: store.meta_description || store.description
        || `Catálogo de ${storeName}. Envíos a todo el país.`,
      url: plpUrl,
      image: store.banner_url ?? store.logo_url ?? undefined,
      siteName: storeName,
      sitemap,
      datos: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: titulo,
        url: plpUrl,
        isPartOf: storeDatos,
      },
    }));
  }

  if (ruta.kind === "page") {
    const pages = await rpc<Array<{ slug: string; title: string; meta_description: string | null; updated_at: string }>>(
      "get_store_pages",
      { p_slug: ruta.slug },
    );
    const pagina = (pages ?? []).find(p => p.slug === ruta.pageSlug);
    if (!pagina) {
      return html(page({
        title: `Página no encontrada | ${storeName}`,
        description: "Esta página no está publicada.",
        url: `${homeUrl}/pagina/${encodeURIComponent(ruta.pageSlug)}`,
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
      image: store.logo_url ?? undefined,
      siteName: storeName,
      sitemap,
      datos: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: pagina.title,
        url: pageUrl,
        dateModified: pagina.updated_at,
        isPartOf: storeDatos,
      },
    }));
  }

  if (ruta.kind === "legal") {
    const legalUrl = `${homeUrl}/arrepentimiento`;
    return html(page({
      title: `Botón de arrepentimiento | ${storeName}`,
      description: `Ejercé el derecho de arrepentimiento en ${storeName}.`,
      url: legalUrl,
      siteName: storeName,
      sitemap,
      datos: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Botón de arrepentimiento",
        url: legalUrl,
        isPartOf: storeDatos,
      },
    }));
  }

  return html(page({
    title: store.meta_title || `${storeName} — Tienda online`,
    description: store.meta_description || store.description
      || `Comprá online en ${storeName}. Envíos a todo el país.`,
    url: homeUrl,
    image: store.banner_url ?? store.logo_url ?? undefined,
    siteName: storeName,
    sitemap,
    datos: storeDatos,
  }));
}
