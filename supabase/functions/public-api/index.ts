/**
 * Gestiona Public REST API — v1
 *
 * Authentication: Bearer token = org API key stored in settings.api_key
 *
 * Endpoints (all prefixes work: /public-api/ and /public-api/v1/):
 *   GET    /v1/products              — list org products
 *   GET    /v1/products/:id          — single product
 *   POST   /v1/sales                 — create a sale
 *   GET    /v1/sales                 — list recent sales (?limit=50&since=ISO_DATE)
 *   GET    /v1/customers             — list customers
 *   GET    /v1/stock/:productId      — get current stock for a product
 *   PATCH  /v1/stock/:productId      — update stock { quantity, reason }
 *   POST   /v1/api-key/rotate        — rotate API key (returns new key, invalidates old)
 *
 * Response headers:
 *   X-API-Version: 1
 *   X-Request-Id: <uuid>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const API_VERSION = "1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-version",
};

function baseHeaders() {
  return {
    ...corsHeaders,
    "Content-Type": "application/json",
    "X-API-Version": API_VERSION,
    "X-Request-Id": crypto.randomUUID(),
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: baseHeaders() });
}

function err(message: string, status = 400, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "public-api", { max: 120, windowMs: 60_000 })) return rateLimitResponse();

  const url = new URL(req.url);

  // Strip /public-api/ or /public-api/v1/ prefix to get clean path
  const rawPath = url.pathname.replace(/.*\/public-api\/?/, "");
  const withoutVersion = rawPath.replace(/^v\d+\//, "");
  const segments = withoutVersion.split("/").filter(Boolean);
  const [resource, resourceId] = segments;

  // ── Auth: validate API key ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = authHeader.replace(/^Bearer\s+/, "").trim();
  if (!apiKey) return err("Authorization header required (Bearer <api_key>)", 401, "auth_required");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await supabase
    .from("settings")
    .select("org_id, user_id, api_key, exchange_rate")
    .eq("api_key", apiKey)
    .maybeSingle();

  if (!settings?.org_id) return err("Invalid or revoked API key", 401, "invalid_api_key");
  const orgId = settings.org_id;

  // ── POST /api-key/rotate ────────────────────────────────────
  if (resource === "api-key" && resourceId === "rotate" && req.method === "POST") {
    const newKey = "gst_" + Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase
      .from("settings")
      .update({ api_key: newKey })
      .eq("org_id", orgId);
    if (error) return err(error.message, 500);
    return json({ api_key: newKey, rotated_at: new Date().toISOString() }, 200);
  }

  // ── GET /products ────────────────────────────────────────────
  if (resource === "products" && !resourceId && req.method === "GET") {
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    const limitParam = Math.min(Number(url.searchParams.get("limit") || "100"), 500);

    let query = supabase
      .from("products")
      .select("id,name,category,stock,cost_usd,sale_price_ars,image_url,barcode")
      .eq("org_id", orgId)
      .order("name")
      .limit(limitParam);

    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return err(error.message, 500);
    return json({ data, count: data?.length, version: API_VERSION });
  }

  // ── GET /products/:id ────────────────────────────────────────
  if (resource === "products" && resourceId && req.method === "GET") {
    const { data, error } = await supabase
      .from("products").select("*").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data });
  }

  // ── GET /stock/:productId ────────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "GET") {
    const { data, error } = await supabase
      .from("products").select("id,name,stock").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data });
  }

  // ── PATCH /stock/:productId ──────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const qty = Number(body.quantity);
    if (isNaN(qty)) return err("quantity must be a number", 400, "validation_error");
    if (qty < 0) return err("quantity cannot be negative", 400, "validation_error");
    if (!Number.isInteger(qty)) return err("quantity must be an integer", 400, "validation_error");
    // La API conserva la semántica de fijar un conteo absoluto, pero el delta y
    // el asiento de Kardex los calcula `adjust_stock` dentro de la base. Es
    // importante verificar el producto antes: la función recibe service_role.
    const { data: product, error: productError } = await supabase
      .from("products").select("id").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (productError) return err(productError.message, 500);
    if (!product) return err("Product not found", 404, "not_found");
    if (!settings.user_id) return err("API key has no stock adjustment owner", 409, "stock_owner_missing");
    const { error } = await supabase.rpc("adjust_stock", {
      p_org_id: orgId,
      p_product_id: product.id,
      p_variant_id: null,
      p_new_stock: qty,
      p_notes: typeof body.reason === "string" ? body.reason.slice(0, 500) : "Ajuste vía API pública",
      p_created_by: settings.user_id,
    });
    if (error) return err(error.message, 500);
    return json({ updated: true, productId: resourceId, stock: qty });
  }

  // ── GET /sales ────────────────────────────────────────────────
  if (resource === "sales" && !resourceId && req.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");

    let query = supabase
      .from("sales")
      .select("id,date,customer_name,total_ars,method,product_name,quantity,paid")
      .eq("org_id", orgId)
      .order("date", { ascending: false })
      .limit(limit);

    if (since) query = query.gte("date", since);
    if (until) query = query.lte("date", until);

    const { data, error } = await query;
    if (error) return err(error.message, 500);
    return json({ data, count: data?.length });
  }

  // ── POST /sales ───────────────────────────────────────────────
  if (resource === "sales" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.product_id || !body?.quantity || !body?.total_ars) {
      return err("Required: product_id, quantity, total_ars", 400, "validation_error");
    }
    if (Number(body.quantity) <= 0) return err("quantity must be positive", 400, "validation_error");
    if (Number(body.total_ars) < 0) return err("total_ars cannot be negative", 400, "validation_error");
    if (!settings.user_id) return err("API key has no sale owner", 409, "sale_owner_missing");

    // La API key identifica la organización; nunca se deja que el JSON elija
    // otro tenant, un usuario distinto ni el nombre/costo de otro producto.
    // El importe puede venir de un canal externo, pero el producto debe ser
    // uno persistido de este Business Core.
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,name,total_cost_usd")
      .eq("id", body.product_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (productError) return err(productError.message, 500);
    if (!product) return err("Product not found", 404, "not_found");

    const quantity = Number(body.quantity);
    const total = Number(body.total_ars);
    const requestedUnitPrice = Number(body.unit_price_ars);
    const unitPrice = Number.isFinite(requestedUnitPrice) && requestedUnitPrice >= 0
      ? requestedUnitPrice
      : total / quantity;
    const costPerUnitUsd = Number(product.total_cost_usd || 0);
    const exchangeRate = Number(settings.exchange_rate || 1);
    const costOfGoodsArs = costPerUnitUsd * exchangeRate * quantity;
    const profitArs = total - costOfGoodsArs;

    // Esta escritura es de servidor para una integración con API key. El
    // trigger de `sales` crea/agrupa sale_transactions y aplica el cupo del
    // plan; no hay una ruta de navegador que pueda saltearlo.
    const { data, error } = await supabase.from("sales").insert({
      org_id: orgId,
      user_id: settings.user_id,
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price_ars: unitPrice,
      total_ars: total,
      cost_per_unit_usd: costPerUnitUsd,
      cost_of_goods_ars: costOfGoodsArs,
      profit_ars: profitArs,
      profit_usd: exchangeRate > 0 ? profitArs / exchangeRate : 0,
      customer_name: typeof body.customer_name === "string" ? body.customer_name.slice(0, 500) : null,
      paid: body.paid !== false,
      payment_method: typeof body.payment_method === "string" ? body.payment_method.slice(0, 100) : "efectivo",
      date: body.date || new Date().toISOString(),
      source: "api",
    }).select().single();
    if (error) return err(error.message, 500);
    return json({ data }, 201);
  }

  // ── GET /customers ────────────────────────────────────────────
  if (resource === "customers" && req.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") || "200"), 500);
    const search = url.searchParams.get("search");

    let query = supabase
      .from("customers" as any)
      .select("id,name,email,phone,created_at")
      .eq("org_id", orgId)
      .order("name")
      .limit(limit);

    if (search) query = (query as any).ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return err(error.message, 500);
    return json({ data, count: data?.length });
  }

  return err(
    `Unknown endpoint: ${req.method} /${resource || ""}. See documentation at /v1/`,
    404,
    "not_found",
  );
});
