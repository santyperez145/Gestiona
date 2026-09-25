// copy-product-images — copia URLs de imágenes externas al bucket propio.
//
// El importador de catálogo (Shopify/Tiendanube/Empretienda) conserva las URLs
// del origen: si el comercio de origen borra el archivo o cambia su CDN, la
// vitrina se rompe sin que el dueño haga nada. Paridad real con Shopify:
// las imágenes viven en storage propio.
//
// Entrada: { batch_id } — el lote ya aplicado. Requiere usuario real de la org
// (requireUser) y lote de esa org. Procesa las URLs https externas de
// products.image_urls / product_variants.image_url de ese lote y las reemplaza
// por la URL pública del bucket product-images. Idempotente: re-corridas
// honestas (una URL propia no se descarga otra vez).
//
// Límite por request: 40 imágenes. El lote puede re-invocarse hasta completar;
// la respuesta informa done y remaining.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "product-images";
const MAX_PER_REQUEST = 40;
const MAX_BYTES = 6 * 1024 * 1024;
const OWN_PATH = "/storage/v1/object/public/product-images/";
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
]);

interface MirrorRow {
  product_id: string;
  variant_id: string | null;
  url: string;
}

function isOwnUrl(url: string, projectHost: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.host === projectHost && parsed.pathname.startsWith(OWN_PATH);
  } catch {
    return false;
  }
}

function safeFileName(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").pop() || "imagen";
    const ext = (last.split(".").pop() || "jpg").toLowerCase();
    const clean = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
    return `${crypto.randomUUID()}.${clean}`;
  } catch {
    return `${crypto.randomUUID()}.jpg`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no soportado" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  let body: { batch_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const batchId = body.batch_id;
  if (!batchId || typeof batchId !== "string") {
    return new Response(JSON.stringify({ error: "batch_id requerido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceRole || !anonKey) {
    return new Response(JSON.stringify({ error: "Falta configuración del servidor" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // El lote debe existir y pertenecer a una org donde el usuario es miembro.
  // El chequeo de membresía corre con el JWT del usuario; la descarga y el
  // reemplazo, con service_role (storage RLS de imágenes de producto es laxa).
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(url, serviceRole);

  const { data: batch, error: batchError } = await userClient
    .from("product_import_batches")
    .select("id, org_id")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError || !batch) {
    return new Response(JSON.stringify({ error: "Lote no encontrado para esta sesión" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Reunir URLs candidatas del resultado del lote: productos + variantes.
  const { data: rows, error: rowsError } = await admin
    .from("product_import_rows")
    .select("result_product_id")
    .eq("batch_id", batchId)
    .not("result_product_id", "is", null)
    .limit(500);
  if (rowsError) {
    return new Response(JSON.stringify({ error: "No se pudo leer el lote" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const productIds = [...new Set((rows ?? []).map((r: { result_product_id: string | null }) => r.result_product_id))];
  if (productIds.length === 0) {
    return new Response(JSON.stringify({ done: true, mirrored: 0, remaining: 0, failures: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: products, error: productsError } = await admin
    .from("products")
    .select("id, image_url, image_urls")
    .in("id", productIds)
    .eq("org_id", batch.org_id);
  if (productsError) {
    return new Response(JSON.stringify({ error: "No se pudo leer el catálogo del lote" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: variants, error: variantsError } = await admin
    .from("product_variants")
    .select("id, product_id, image_url")
    .in("product_id", productIds)
    .eq("org_id", batch.org_id);
  if (variantsError) {
    return new Response(JSON.stringify({ error: "No se pudieron leer las variantes del lote" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const projectHost = new URL(url).host;
  const work: MirrorRow[] = [];
  const seen = new Set<string>();
  const push = (productId: string, variantId: string | null, raw: string | null) => {
    if (!raw) return;
    if (!/^https:\/\//i.test(raw)) return;
    if (isOwnUrl(raw, projectHost)) return;
    const key = `${productId}|${variantId ?? ""}|${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    work.push({ product_id: productId, variant_id: variantId, url: raw });
  };
  for (const p of products ?? []) {
    for (const u of Array.isArray(p.image_urls) ? p.image_urls : []) push(p.id, null, u);
    if (!Array.isArray(p.image_urls) || p.image_urls.length === 0) push(p.id, null, p.image_url);
  }
  for (const v of variants ?? []) push(v.product_id, v.id, v.image_url);

  const batch2 = work.slice(0, MAX_PER_REQUEST);
  let mirrored = 0;
  const failed: string[] = [];
  const updates: { item: MirrorRow; newUrl: string }[] = [];

  for (const item of batch2) {
    try {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) { failed.push(item.url); continue; }
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.has(type)) { failed.push(item.url); continue; }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) { failed.push(item.url); continue; }

      const ext = type === "image/png" ? "png"
        : type === "image/webp" ? "webp"
        : type === "image/gif" ? "gif"
        : type === "image/avif" ? "avif" : "jpg";
      const path = `${batch.org_id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
        contentType: type, cacheControl: "31536000", upsert: false,
      });
      if (uploadError) { failed.push(item.url); continue; }
      const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path);
      if (!publicUrl?.publicUrl) { failed.push(item.url); continue; }
      updates.push({ item, newUrl: publicUrl.publicUrl });
      mirrored += 1;
    } catch {
      failed.push(item.url);
    }
  }

  // Aplicar reemplazos: por producto (array completo) y por variante.
  for (const u of updates) {
    if (u.item.variant_id) {
      await admin.from("product_variants").update({ image_url: u.newUrl })
        .eq("id", u.item.variant_id).eq("org_id", batch.org_id);
    } else {
      const product = (products ?? []).find((p) => p.id === u.item.product_id);
      const current = Array.isArray(product?.image_urls) ? product.image_urls : [];
      const next = current.map((old) => (old === u.item.url ? u.newUrl : old));
      await admin.from("products").update({
        image_urls: next, image_url: next[0] ?? u.newUrl,
      }).eq("id", u.item.product_id).eq("org_id", batch.org_id);
    }
  }

  return new Response(JSON.stringify({
    done: work.length <= MAX_PER_REQUEST,
    mirrored, failed_count: failed.length,
    remaining: Math.max(work.length - MAX_PER_REQUEST, 0),
    total_found: work.length,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});