/**
 * sitemap.xml de una tienda: la home, el listado y cada producto con stock.
 *
 * Sin esto Google solo conoce la portada y no indexa ninguna ficha, que es
 * justo lo que trae tráfico de búsqueda ("comprar khamrah argentina").
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
      `${SUPABASE_URL}/rest/v1/store_catalog_products?org_id=eq.${store.org_id}&stock=gt.0&select=id,created_at&limit=5000`,
      { headers },
    );
    const products = pRes.ok ? await pRes.json() : [];

    const base = `${origin}/tienda/${encodeURIComponent(slug)}`;
    const hoy = new Date().toISOString().slice(0, 10);

    const urls = [
      `  <url><loc>${esc(base)}</loc><changefreq>daily</changefreq><priority>1.0</priority><lastmod>${hoy}</lastmod></url>`,
      `  <url><loc>${esc(base)}/productos</loc><changefreq>daily</changefreq><priority>0.9</priority><lastmod>${hoy}</lastmod></url>`,
      ...(products as any[]).map(p =>
        `  <url><loc>${esc(base)}/producto/${esc(p.id)}</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${esc(String(p.created_at ?? hoy).slice(0, 10))}</lastmod></url>`,
      ),
    ];

    return xml(urls.join("\n"));
  } catch {
    return xml(`  <url><loc>${esc(origin)}</loc></url>`);
  }
}
