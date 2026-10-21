/**
 * Índice de sitemaps: una URL que Search Console puede pegar una sola vez.
 *
 * Cada tienda activa declara la suya en `<slug>.nerqia.app/sitemap.xml`. Este
 * archivo las junta para no depender de que alguien recorra la home.
 */
import { BRAND_DOMAIN } from "../src/lib/brand.js";

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

/**
 * Lee las tiendas publicadas. Falla con excepción: una respuesta de error o
 * un cuerpo que no es la lista no se pueden confundir con «no hay tiendas».
 */
async function tiendasPublicadas(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_published_store_slugs`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`list_published_store_slugs respondió ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("list_published_store_slugs no devolvió una lista");
  return rows.map((r: { slug?: string }) => String(r?.slug ?? "").trim()).filter(Boolean);
}

/**
 * Arma el índice. Si no se pudieron leer las tiendas responde 503 (2026-10-19:
 * con la base caída el índice respondía 200 con sólo la plataforma, y Google
 * podía entender que las tiendas ya no existían). Un 503 le dice que vuelva
 * más tarde y conserva lo que ya conocía.
 */
export async function indiceDeSitemaps(listar: (() => Promise<string[]>) | null): Promise<Response> {
  // La plataforma también necesita una ruta de descubrimiento. Antes este
  // índice sólo apuntaba a tiendas: Google podía conocer cada catálogo y aun
  // así no tenía una sola URL de Nerqia para rastrear.
  const locs: string[] = [`https://${BRAND_DOMAIN}/sitemap-platform.xml`];

  if (listar) {
    let slugs: string[];
    try {
      slugs = await listar();
    } catch (error) {
      console.error("sitemap-index: no se pudieron leer las tiendas", error);
      return new Response("Índice de sitemaps temporalmente no disponible", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
      });
    }
    for (const slug of slugs) {
      locs.push(`https://${encodeURIComponent(slug)}.${BRAND_DOMAIN}/sitemap.xml`);
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    locs.map(loc => `  <sitemap><loc>${esc(loc)}</loc></sitemap>`).join("\n")
  }\n</sitemapindex>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default function handler(_req: Request): Promise<Response> {
  return indiceDeSitemaps(SUPABASE_URL && SUPABASE_KEY ? tiendasPublicadas : null);
}
