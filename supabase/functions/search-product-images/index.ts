import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { checkRateLimit } from "../_shared/rateLimiter.ts";
import { getAuthedUser } from "../_shared/requireUser.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function safeHttps(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ merchant_message: "Método no permitido." }, 405);
  if (checkRateLimit(req, "search-product-images", { max: 20, windowMs: 60_000 })) {
    return new Response(JSON.stringify({
      merchant_message: "Hiciste varias búsquedas seguidas. Esperá un minuto y volvé a intentar.",
    }), { status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" } });
  }

  const user = await getAuthedUser(req);
  if (!user) return json({ merchant_message: "Iniciá sesión para buscar imágenes." }, 401);

  let body: { org_id?: string; query?: string; brand?: string; product_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ merchant_message: "No pudimos leer la búsqueda." }, 400);
  }

  const orgId = String(body.org_id ?? "").trim();
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!orgId || !url || !serviceKey) {
    return json({ merchant_message: "No pudimos iniciar la búsqueda.", operator_message: "Falta org_id o configuración Supabase." }, 503);
  }

  const admin = createClient(url, serviceKey);
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("search-product-images membership:", membershipError);
    return json({ merchant_message: "No pudimos verificar tus permisos." }, 503);
  }
  if (!membership || !["owner", "admin"].includes(String(membership.role))) {
    return json({ merchant_message: "Sólo el dueño o un administrador puede completar imágenes del catálogo." }, 403);
  }

  let productName = text(body.query, 120) ?? "";
  let brand = text(body.brand, 80) ?? "";
  if (body.product_id) {
    const { data: product, error } = await admin
      .from("products")
      .select("name, brand")
      .eq("id", String(body.product_id))
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) console.error("search-product-images product:", error);
    if (!product) return json({ merchant_message: "No encontramos ese producto en tu catálogo." }, 404);
    productName = text(product.name, 120) ?? productName;
    brand = text(product.brand, 80) ?? brand;
  }

  const query = `${brand} ${productName}`.replace(/\s+/g, " ").trim();
  if (query.length < 3) return json({ merchant_message: "Ingresá un nombre o una marca más específicos." }, 400);

  const endpoint = new URL("https://api.openverse.org/v1/images/");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("page_size", "12");
  endpoint.searchParams.set("license_type", "commercial");
  endpoint.searchParams.set("mature", "false");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "User-Agent": "Nerqia catalog assistant/1.0 (https://nerqia.app)" },
    });
  } catch (error) {
    console.error("search-product-images provider network:", error);
    return json({ merchant_message: "El buscador de imágenes no respondió. Intentá nuevamente en unos minutos." }, 502);
  }

  if (!response.ok) {
    console.error("search-product-images provider:", response.status, await response.text().catch(() => ""));
    const status = response.status === 429 ? 429 : 502;
    return json({
      merchant_message: status === 429
        ? "El buscador recibió muchas consultas. Esperá un minuto y volvé a intentar."
        : "El buscador de imágenes no está disponible por el momento.",
    }, status);
  }

  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const results = rows
    .filter((row: Record<string, unknown>) => row && !row.watermarked)
    .map((row: Record<string, unknown>) => ({
      id: text(row.id, 80),
      title: text(row.title) ?? "Imagen sin título",
      url: safeHttps(row.url),
      thumbnail: safeHttps(row.thumbnail),
      source_url: safeHttps(row.foreign_landing_url),
      creator: text(row.creator, 120),
      creator_url: safeHttps(row.creator_url),
      provider: text(row.provider, 80),
      source: text(row.source, 80),
      license: text(row.license, 40),
      license_version: text(row.license_version, 20),
      license_url: safeHttps(row.license_url),
      width: Number(row.width) || null,
      height: Number(row.height) || null,
    }))
    .filter((row: { url: string | null; thumbnail: string | null }) => row.url && row.thumbnail)
    .slice(0, 8);

  return json({
    ok: true,
    query,
    results,
    policy: {
      auto_apply: false,
      requires_review: true,
      notice: "Confirmá que la imagen corresponde al producto y verificá la licencia en la fuente antes de publicarla.",
    },
  });
});
