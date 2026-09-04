/**
 * sitemap.xml de una tienda: home, listado, categorías, páginas, legales
 * y cada ficha — con o sin stock.
 *
 * Un agotado sigue siendo una URL que Google ya conoce; sacarlo del índice
 * y volverlo a pedir cuando reingrese stock gasta presupuesto de rastreo.
 * La disponibilidad la declara el JSON-LD de la ficha, no la presencia acá.
 *
 * Uso: /tienda/:slug/sitemap.xml o https://slug.nerqia.app/sitemap.xml
 */
import {
  lookupStoreSlugByHost,
  publicStoreBaseUrl,
  resolveHostedStoreRequest,
  resolvedStoreOrigin,
} from "../src/lib/storefrontHost.js";
import { storeCatalogPage } from "../src/lib/storeCatalogPagination.js";
import { slugsDeRama, type CategoriaTienda } from "../src/lib/storeCategories.js";

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
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

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
  const slug = hostedSlug ?? decodeURIComponent(/^\/tienda\/([^/]+)/.exec(path)?.[1] ?? "");

  const xml = (body: string, status = 200, indexable = true) =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
      {
        status,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": indexable ? "public, max-age=3600" : "public, max-age=60",
          ...(!indexable ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
        },
      },
    );

  if (resolution.customDomain && !hostedSlug) return xml("", 404, false);

  if (!slug) {
    return xml(`  <url><loc>${esc(origin)}</loc></url>`);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return xml("", 503, false);

  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  try {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_store_by_slug`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!sRes.ok) {
      console.error(`[sitemap] get_store_by_slug respondió HTTP ${sRes.status}`);
      return xml("", 503, false);
    }
    const stores = sRes.ok ? await sRes.json() : [];
    const store = Array.isArray(stores) ? stores[0] : stores;
    if (!store?.org_id) return xml(`  <url><loc>${esc(origin)}</loc></url>`);

    // `store_catalog_products`, no `products`: la tabla cruda está cerrada a la
    // clave anónima desde el hardening de RLS, así que esto devolvía **cero
    // filas** y el sitemap sólo listaba la home y el listado. Ni una ficha de
    // producto indexada — que es justo el tráfico que se buscaba.
    //
    // La vista no tiene `updated_at`: no se fabrica un `lastmod` con la fecha
    // de hoy ni se confunde creación con modificación. Google pide que ese
    // valor sea exacto; si no podemos sostenerlo, se omite.
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/store_catalog_products?org_id=eq.${store.org_id}&select=id,category&limit=5000`,
      { headers },
    );
    if (!pRes.ok) {
      console.error(`[sitemap] store_catalog_products respondió HTTP ${pRes.status}`);
      return xml("", 503, false);
    }
    const products = pRes.ok ? await pRes.json() : [];

    let pages: Array<{ slug: string; updated_at: string | null }> = [];
    let categorias: CategoriaTienda[] = [];
    try {
      const [pags, cats] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rpc/get_store_pages`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ p_slug: slug }),
        }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/get_store_categories`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ p_slug: slug }),
        }),
      ]);
      pages = pags.ok ? await pags.json() : [];
      categorias = cats.ok ? await cats.json() : [];
      if (!pags.ok || !cats.ok) {
        console.error(`[sitemap] páginas/categorías respondieron HTTP ${pags.status}/${cats.status}`);
        return xml("", 503, false);
      }
    } catch (error) {
      console.error("[sitemap] no se pudieron leer páginas o categorías", error);
      return xml("", 503, false);
    }

    const base = publicStoreBaseUrl(origin, slug, Boolean(hostedSlug));
    const catalog = Array.isArray(products)
      ? products as Array<{ id: string; category?: string | null }>
      : [];
    const urlEntry = (loc: string, lastmod?: string | null) =>
      `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : ""}</url>`;
    const paginationEntries = (path: string, total: number) => {
      const { pageCount } = storeCatalogPage(total, 1);
      return Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => {
        const pageNumber = index + 2;
        const separator = path.includes("?") ? "&" : "?";
        return urlEntry(`${base}${path}${separator}page=${pageNumber}`);
      });
    };

    const urls = [
      urlEntry(base),
      urlEntry(`${base}/productos`),
      ...paginationEntries("/productos", catalog.length),
      urlEntry(`${base}/arrepentimiento`),
      ...(Array.isArray(categorias) ? categorias : [])
        .filter(c => c.slug && catalog.some(product => slugsDeRama(c.slug, categorias).includes(product.category ?? "")))
        .flatMap(c => {
          const path = `/productos?cat=${encodeURIComponent(c.slug)}`;
          const total = catalog.filter(product => slugsDeRama(c.slug, categorias).includes(product.category ?? "")).length;
          return [urlEntry(`${base}${path}`), ...paginationEntries(path, total)];
        }),
      ...(Array.isArray(pages) ? pages : [])
        .filter(p => p.slug)
        .map(p => urlEntry(`${base}/pagina/${encodeURIComponent(p.slug)}`, p.updated_at)),
      ...catalog.map(p => urlEntry(`${base}/producto/${encodeURIComponent(p.id)}`)),
    ];

    return xml(urls.join("\n"));
  } catch (error) {
    console.error("[sitemap] no se pudo construir el sitemap", error);
    return xml("", 503, false);
  }
}
