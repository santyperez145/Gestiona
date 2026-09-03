/**
 * Feed de productos para Google Shopping y el catálogo de Meta.
 *
 * La tienda ya tiene configurados el píxel de Meta, GA4 y TikTok: el comercio
 * está anunciando. Pero sin un feed no se puede correr Shopping, ni etiquetar
 * productos en Instagram, ni armar remarketing dinámico — que es lo que trae
 * de vuelta a quien miró un perfume y no compró. Tiendanube y Empretienda lo
 * generan solos; acá no existía.
 *
 * Formato: RSS 2.0 con el namespace `g:`, que es el que leen los dos. Google lo
 * toma desde Merchant Center y Meta desde el Commerce Manager, apuntando los dos
 * a la misma URL.
 *
 * Uso: /tienda/:slug/feed.xml
 *
 * ── Lo que NO hace, a propósito ──────────────────────────────────────────
 *
 * No inventa `gtin` ni `mpn`. Google los pide para productos con código de
 * barras, y mandar uno falso hace que rechacen el ítem entero — o peor, que
 * suspendan la cuenta. Se manda `identifier_exists=no`, que es la forma
 * correcta de decir "esto no tiene código universal". Cuando el catálogo cargue
 * códigos de barras de verdad, se agrega.
 */
import { precioDeCatalogo } from "../src/lib/storefrontSeo.js";
import { hostedStoreOrigin, hostedStoreSlugFromUrl, publicStoreBaseUrl } from "../src/lib/storefrontHost.js";

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

/** Texto plano, sin saltos ni etiquetas: los dos rechazan HTML en `description`. */
const plano = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

interface FilaCatalogo {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  image_urls: string[] | null;
  sale_price_ars: number | null;
  discount_price_ars: number | null;
  promo_price: number | null;
  stock: number | null;
  content_ml: number | null;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hostedSlug = hostedStoreSlugFromUrl(url);
  const origin = hostedStoreOrigin(url, hostedSlug);
  const path = url.searchParams.get("path") ?? url.pathname;
  const slug = hostedSlug ?? decodeURIComponent(/^\/tienda\/([^/]+)/.exec(path)?.[1] ?? "");
  const storeBase = publicStoreBaseUrl(origin, slug, Boolean(hostedSlug));

  const xml = (titulo: string, items: string) =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
      `<channel>\n` +
      `  <title>${esc(titulo)}</title>\n` +
      `  <link>${esc(storeBase)}</link>\n` +
      `  <description>Catálogo de ${esc(titulo)}</description>\n` +
      `${items}\n` +
      `</channel>\n</rss>`,
      {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          // Una hora: el catálogo no cambia tanto, y Google lo baja seguido.
          "Cache-Control": "public, max-age=3600",
        },
      },
    );

  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) return xml("Tienda", "");

  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  try {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_store_by_slug`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    const stores = sRes.ok ? await sRes.json() : [];
    const store = Array.isArray(stores) ? stores[0] : stores;
    if (!store?.org_id) return xml("Tienda", "");

    // La vista pública, no `products`: la tabla cruda está cerrada a la clave
    // anónima y además lleva costos y márgenes, que no van a un feed público.
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/store_catalog_products?org_id=eq.${store.org_id}` +
      `&select=id,name,brand,category,gender,description,image_url,image_urls,` +
      `sale_price_ars,discount_price_ars,promo_price,stock,content_ml&limit=5000`,
      { headers },
    );
    const productos: FilaCatalogo[] = pRes.ok ? await pRes.json() : [];

    const base = storeBase;
    const moneda = String(store.currency ?? "ARS");

    const items = productos
      // Sin precio o sin imagen el ítem se rechaza igual: mejor no mandarlo que
      // acumular errores en la cuenta.
      .filter(p => precioDeCatalogo(p) > 0 && p.image_url)
      .map(p => {
        const lista = Number(p.sale_price_ars) || 0;
        const cobrado = precioDeCatalogo(p);
        // `price` es el de lista y `sale_price` el que se cobra si es menor.
        const precio = lista > 0 ? lista : cobrado;
        const rebaja = cobrado > 0 && cobrado < precio ? cobrado : null;

        const extras = (p.image_urls ?? [])
          .filter(u => u && u !== p.image_url)
          .slice(0, 10)   // el tope de Google para imágenes adicionales
          .map(u => `    <g:additional_image_link>${esc(u)}</g:additional_image_link>`)
          .join("\n");

        const titulo = [p.name, p.content_ml ? `${p.content_ml}ml` : null]
          .filter(Boolean).join(" ");

        return [
          "  <item>",
          `    <g:id>${esc(p.id)}</g:id>`,
          `    <g:title>${esc(plano(titulo, 150))}</g:title>`,
          `    <g:description>${esc(plano(p.description || titulo, 5000))}</g:description>`,
          `    <g:link>${esc(base)}/producto/${esc(p.id)}</g:link>`,
          `    <g:image_link>${esc(p.image_url)}</g:image_link>`,
          extras,
          `    <g:availability>${Number(p.stock) > 0 ? "in stock" : "out of stock"}</g:availability>`,
          `    <g:condition>new</g:condition>`,
          `    <g:price>${precio.toFixed(2)} ${esc(moneda)}</g:price>`,
          rebajaLinea(rebaja, moneda),
          p.brand ? `    <g:brand>${esc(plano(p.brand, 70))}</g:brand>` : "",
          p.category ? `    <g:product_type>${esc(plano(p.category, 750))}</g:product_type>` : "",
          generoLinea(p.gender),
          // Sin código de barras real. Mandar uno inventado hace que rechacen
          // el ítem, así que se declara que no existe, que es lo correcto.
          `    <g:identifier_exists>no</g:identifier_exists>`,
          "  </item>",
        ].filter(Boolean).join("\n");
      });

    return xml(String(store.name ?? "Tienda"), items.join("\n"));
  } catch {
    return xml("Tienda", "");
  }
}

function rebajaLinea(rebaja: number | null, moneda: string): string {
  return rebaja ? `    <g:sale_price>${rebaja.toFixed(2)} ${esc(moneda)}</g:sale_price>` : "";
}

/**
 * `gender` sólo se manda cuando coincide con el vocabulario que aceptan: male,
 * female o unisex. Un valor libre hace que rechacen el atributo.
 */
function generoLinea(gender: string | null): string {
  const g = String(gender ?? "").toLowerCase();
  const mapa: Record<string, string> = {
    hombre: "male", masculino: "male", male: "male",
    mujer: "female", femenino: "female", female: "female",
    unisex: "unisex",
  };
  return mapa[g] ? `    <g:gender>${mapa[g]}</g:gender>` : "";
}
