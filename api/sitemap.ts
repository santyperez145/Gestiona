/**
 * sitemap.xml de una tienda: home, listado, categorías, páginas, legales
 * y cada ficha — con o sin stock.
 *
 * Un agotado sigue siendo una URL que Google ya conoce; sacarlo del índice
 * y volverlo a pedir cuando reingrese stock gasta presupuesto de rastreo.
 * La disponibilidad la declara el JSON-LD de la ficha, no la presencia acá.
 *
 * Uso: /tienda/:slug/sitemap.xml
 */
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
  const origin = `${url.protocol}//${url.host}`;
  const path = url.searchParams.get("path") ?? url.pathname;
  const slug = decodeURIComponent(/^\/tienda\/([^/]+)/.exec(path)?.[1] ?? "");

  const xml = (body: string) =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
      { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
    );

  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) {
    return xml(`  <url><loc>${esc(origin)}</loc></url>`);
  }

  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  try {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_store_by_slug`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    const stores = sRes.ok ? await sRes.json() : [];
    const store = Array.isArray(stores) ? stores[0] : stores;
    if (!store?.org_id) return xml(`  <url><loc>${esc(origin)}</loc></url>`);

    // `store_catalog_products`, no `products`: la tabla cruda está cerrada a la
    // clave anónima desde el hardening de RLS, así que esto devolvía **cero
    // filas** y el sitemap sólo listaba la home y el listado. Ni una ficha de
    // producto indexada — que es justo el tráfico que se buscaba.
    //
    // La vista no tiene `updated_at`, así que se ordena y fecha por
    // `created_at`, que sí trae.
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/store_catalog_products?org_id=eq.${store.org_id}&select=id,created_at,stock&limit=5000`,
      { headers },
    );
    const products = pRes.ok ? await pRes.json() : [];

    let pages: Array<{ slug: string; updated_at: string | null }> = [];
    let categorias: Array<{ slug: string; productos: number }> = [];
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
    } catch { /* el catálogo igual se indexa */ }

    const base = `${origin}/tienda/${encodeURIComponent(slug)}`;
    const hoy = new Date().toISOString().slice(0, 10);

    const urls = [
      `  <url><loc>${esc(base)}</loc><changefreq>daily</changefreq><priority>1.0</priority><lastmod>${hoy}</lastmod></url>`,
      `  <url><loc>${esc(base)}/productos</loc><changefreq>daily</changefreq><priority>0.9</priority><lastmod>${hoy}</lastmod></url>`,
      `  <url><loc>${esc(base)}/arrepentimiento</loc><changefreq>yearly</changefreq><priority>0.3</priority><lastmod>${hoy}</lastmod></url>`,
      ...(Array.isArray(categorias) ? categorias : [])
        .filter(c => Number(c.productos) > 0 && c.slug)
        .map(c =>
          `  <url><loc>${esc(base)}/productos?cat=${esc(encodeURIComponent(c.slug))}</loc><changefreq>weekly</changefreq><priority>0.7</priority><lastmod>${hoy}</lastmod></url>`,
        ),
      ...(Array.isArray(pages) ? pages : [])
        .filter(p => p.slug)
        .map(p =>
          `  <url><loc>${esc(base)}/pagina/${esc(encodeURIComponent(p.slug))}</loc><changefreq>monthly</changefreq><priority>0.5</priority><lastmod>${esc(String(p.updated_at ?? hoy).slice(0, 10))}</lastmod></url>`,
        ),
      ...(products as Array<{ id: string; created_at?: string; stock?: number }>).map(p => {
        const enStock = Number(p.stock) > 0;
        return `  <url><loc>${esc(base)}/producto/${esc(p.id)}</loc><changefreq>weekly</changefreq><priority>${enStock ? "0.8" : "0.4"}</priority><lastmod>${esc(String(p.created_at ?? hoy).slice(0, 10))}</lastmod></url>`;
      }),
    ];

    return xml(urls.join("\n"));
  } catch {
    return xml(`  <url><loc>${esc(origin)}</loc></url>`);
  }
}
