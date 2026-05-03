/**
 * Gestiona Public REST API
 *
 * Authentication: Bearer token = org API key stored in settings.api_key
 *
 * Endpoints:
 *   GET  /products          — list org products
 *   GET  /products/:id      — single product
 *   POST /sales             — create a sale (webhook-style)
 *   GET  /sales             — list recent sales (?limit=50&since=ISO_DATE)
 *   GET  /customers         — list customers
 *   GET  /stock/:productId  — get current stock for a product
 *   PATCH /stock/:productId — update stock { quantity, reason }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "public-api", { max: 120, windowMs: 60_000 })) return rateLimitResponse();

  const url = new URL(req.url);
  // path after /public-api/
  const segments = url.pathname.replace(/.*\/public-api\/?/, "").split("/").filter(Boolean);
  const [resource, resourceId] = segments;

  // ── Auth: validate API key ──────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = authHeader.replace(/^Bearer\s+/, "").trim();
  if (!apiKey) return err("Authorization header required (Bearer <api_key>)", 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await supabase
    .from("settings")
    .select("org_id, api_key")
    .eq("api_key", apiKey)
    .maybeSingle();

  if (!settings?.org_id) return err("Invalid API key", 401);
  const orgId = settings.org_id;

  // ── Route ───────────────────────────────────────────────────────────────────

  // GET /products
  if (resource === "products" && !resourceId && req.method === "GET") {
    const { data, error } = await supabase
      .from("products")
      .select("id,name,category,stock,cost_usd,sale_price_ars,image_url,barcode")
      .eq("org_id", orgId)
      .order("name");
    if (error) return err(error.message, 500);
    return json({ data });
  }

  // GET /products/:id
  if (resource === "products" && resourceId && req.method === "GET") {
    const { data, error } = await supabase
      .from("products").select("*").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Product not found", 404);
    return json({ data });
  }

  // GET /stock/:productId
  if (resource === "stock" && resourceId && req.method === "GET") {
    const { data, error } = await supabase
      .from("products").select("id,name,stock").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Product not found", 404);
    return json({ data });
  }

  // PATCH /stock/:productId  — { quantity: number, reason?: string }
  if (resource === "stock" && resourceId && req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const qty = Number(body.quantity);
    if (isNaN(qty)) return err("quantity must be a number");
    const { error } = await supabase
      .from("products").update({ stock: qty }).eq("id", resourceId).eq("org_id", orgId);
    if (error) return err(error.message, 500);
    return json({ updated: true, productId: resourceId, stock: qty });
  }

  // GET /sales?limit=50&since=ISO_DATE
  if (resource === "sales" && !resourceId && req.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);
    const since = url.searchParams.get("since");
    let query = supabase.from("sales").select("id,date,customer_name,total_ars,method,product_name,quantity").eq("org_id", orgId).order("date", { ascending: false }).limit(limit);
    if (since) query = query.gte("date", since);
    const { data, error } = await query;
    if (error) return err(error.message, 500);
    return json({ data, count: data?.length });
  }

  // POST /sales — create a sale externally
  if (resource === "sales" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.product_id || !body?.quantity || !body?.total_ars) {
      return err("Required: product_id, quantity, total_ars");
    }
    const { data, error } = await supabase.from("sales").insert({
      org_id: orgId,
      ...body,
      date: body.date || new Date().toISOString(),
      source: "api",
    }).select().single();
    if (error) return err(error.message, 500);
    return json({ data }, 201);
  }

  // GET /customers
  if (resource === "customers" && req.method === "GET") {
    const { data, error } = await supabase
      .from("customers" as any).select("id,name,email,phone,created_at").eq("org_id", orgId).order("name").limit(200);
    if (error) return err(error.message, 500);
    return json({ data });
  }

  return err(`Unknown endpoint: ${req.method} /${resource || ""}`, 404);
});
