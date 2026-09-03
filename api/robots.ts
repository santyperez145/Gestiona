/**
 * robots.txt con los sitemaps reales, no un comentario.
 *
 * El archivo estático decía dónde vivía cada sitemap y nunca lo declaraba.
 * Google no adivina `/tienda/<slug>/sitemap.xml`. Esta función lista las
 * tiendas activas en el servidor y emite `Sitemap:`.
 *
 * ⚠️ No puede existir `public/robots.txt`: Vercel entrega el estático antes
 * del rewrite y esta función no corre. Lo midió el deploy de D5.9.
 */
import { cuerpoRobots } from "../src/lib/storefrontSeo.js";
import { BRAND_DOMAIN } from "../src/lib/brand.js";
import { hostedStoreOrigin, hostedStoreSlugFromUrl } from "../src/lib/storefrontHost.js";

export const config = { runtime: "edge" };

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hostedSlug = hostedStoreSlugFromUrl(url);
  const origin = hostedStoreOrigin(url, hostedSlug);
  const sitemaps = ["/sitemap.xml"];

  if (!hostedSlug && SUPABASE_URL && SUPABASE_KEY) {
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
        sitemaps.push(`https://${slug}.${BRAND_DOMAIN}/sitemap.xml`);
      }
    } catch {
      /* el índice raíz sigue yendo */
    }
  }

  return new Response(cuerpoRobots(origin, sitemaps, { hostedStore: Boolean(hostedSlug) }), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
