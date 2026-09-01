/**
 * Índice de sitemaps: una URL que Search Console puede pegar una sola vez.
 *
 * Cada tienda activa declara la suya en `/tienda/<slug>/sitemap.xml`. Este
 * archivo las junta para no depender de que alguien recorra la home.
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
  const locs: string[] = [];

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_published_store_slugs`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const rows = res.ok ? await res.json() : [];
      const slugs = Array.isArray(rows)
        ? rows.map((r: { slug?: string }) => String(r?.slug ?? "").trim()).filter(Boolean)
        : [];
      for (const slug of slugs) {
        locs.push(`${origin}/tienda/${encodeURIComponent(slug)}/sitemap.xml`);
      }
    } catch { /* índice vacío es honesto */ }
  }

  const body = locs.length === 0
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      locs.map(loc => `  <sitemap><loc>${esc(loc)}</loc></sitemap>`).join("\n")
    }\n</sitemapindex>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
