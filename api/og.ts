/**
 * Vista previa para bots: WhatsApp, Instagram, Facebook, Twitter y Google no
 * ejecutan JavaScript, así que los meta tags que la SPA setea en runtime son
 * invisibles para ellos. Al pegar el link de la tienda salía una tarjeta vacía.
 *
 * Esta función corre en el borde y devuelve HTML plano con los Open Graph
 * correctos. `vercel.json` la usa SOLO para user-agents de bots, así que los
 * compradores reales siguen recibiendo la SPA sin latencia extra.
 *
 * Rutas que entiende:
 *   /tienda/:slug
 *   /tienda/:slug/producto/:id
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

function page(o: {
  title: string; description: string; url: string; image?: string; siteName: string;
}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.url)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(o.siteName)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.url)}">
${o.image ? `<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:alt" content="${esc(o.title)}">` : ""}

<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
${o.image ? `<meta name="twitter:image" content="${esc(o.image)}">` : ""}
</head>
<body>
<h1>${esc(o.title)}</h1>
<p>${esc(o.description)}</p>
<p><a href="${esc(o.url)}">Ver la tienda</a></p>
</body>
</html>`;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  // El path original llega por query cuando el rewrite lo reescribe.
  const path = url.searchParams.get("path") ?? url.pathname;
  const m = /^\/tienda\/([^/]+)(?:\/producto\/([^/?]+))?/.exec(path);

  if (!m) {
    return new Response("Not found", { status: 404 });
  }

  const slug = decodeURIComponent(m[1]);
  const productId = m[2] ? decodeURIComponent(m[2]) : null;

  const stores = await rpc<any[]>("get_store_by_slug", { p_slug: slug });
  const store = Array.isArray(stores) ? stores[0] : stores;

  if (!store) {
    return new Response(
      page({
        title: "Tienda no encontrada",
        description: "Esta tienda no existe o fue desactivada.",
        url: `${origin}${path}`,
        siteName: "Gestiona",
      }),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const storeName = store.name ?? "Tienda online";

  // ── Ficha de producto ────────────────────────────────────────────────
  if (productId && SUPABASE_URL && SUPABASE_KEY) {
    try {
      // `store_catalog_products`, no `products`: la tabla cruda está cerrada a
      // la clave anónima desde el hardening de RLS, así que esta consulta venía
      // devolviendo **cero filas** y toda ficha compartida por WhatsApp o
      // Facebook mostraba la vista previa genérica de la tienda en vez del
      // producto. La vista es la superficie pública y ya trae las columnas
      // saneadas, sin costos ni márgenes.
      //
      // Se filtra además por `org_id`: sin eso, el id de un producto de otra
      // tienda devolvía su ficha bajo esta marca.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/store_catalog_products?id=eq.${encodeURIComponent(productId)}&org_id=eq.${encodeURIComponent(store.org_id)}&select=name,brand,description,sale_price_ars,discount_price_ars,image_url&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const rows = res.ok ? await res.json() : [];
      const p = rows?.[0];
      if (p) {
        const price = Number(p.discount_price_ars) || Number(p.sale_price_ars) || 0;
        const precio = price
          ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(price)
          : "";
        return new Response(
          page({
            title: `${p.name}${p.brand ? ` — ${p.brand}` : ""} | ${storeName}`,
            description: [precio, p.description].filter(Boolean).join(" · ").slice(0, 200)
              || `Comprá ${p.name} en ${storeName}.`,
            url: `${origin}${path}`,
            image: p.image_url ?? store.logo_url ?? undefined,
            siteName: storeName,
          }),
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } },
        );
      }
    } catch { /* cae a la tarjeta de la tienda */ }
  }

  // ── Home de la tienda ────────────────────────────────────────────────
  return new Response(
    page({
      title: store.meta_title || `${storeName} — Tienda online`,
      description: store.meta_description || store.description
        || `Comprá online en ${storeName}. Envíos a todo el país.`,
      url: `${origin}/tienda/${slug}`,
      image: store.banner_url ?? store.logo_url ?? undefined,
      siteName: storeName,
    }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } },
  );
}
