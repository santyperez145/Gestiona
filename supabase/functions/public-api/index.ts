/**
 * Gestiona Public REST API — v1
 *
 * Authentication: Bearer gst_live_… — se hashea con SHA-256 y se busca en
 * `api_keys.key_hash`. La key NUNCA está guardada: sólo su hash.
 *
 * ── Lo que cambió el 2026-08-24, y por qué ────────────────────────────────
 *
 * La auditoría externa encontró (y se verificó) que la key vivía en texto
 * plano en `settings.api_key` — una tabla que TODO miembro de la organización
 * lee por RLS. Cualquier empleado podía copiarla y con ella crear ventas,
 * ajustar stock y rotar la key. Además se generaba en el navegador.
 *
 * Ahora:
 *   · la key se emite server-side (`api_key_emitir`), se muestra una vez y
 *     acá sólo llega su hash;
 *   · cada key tiene SCOPES: una integración de sólo lectura no puede escribir
 *     stock aunque le roben la key;
 *   · el costo (`cost_usd`) sólo sale con el scope `costs:read` — el costo de
 *     la mercadería es el dato más sensible del negocio;
 *   · POST /sales acepta Idempotency-Key (primitiva H1): un retry devuelve la
 *     misma venta en vez de duplicarla;
 *   · sin CORS `*`: esta API es server-to-server, como la de Stripe. Invitar a
 *     usarla desde un navegador es invitar a exponer la key en el frontend de
 *     un tercero;
 *   · los errores de Postgres no se filtran al cliente, y un fallo de DB en el
 *     lookup de auth responde 503, no "key inválida".
 *
 * Endpoints (scope requerido):
 *   GET    /v1/products               products:read  (+costs:read para cost_usd)
 *   GET    /v1/products/:id           products:read  (+costs:read para costos)
 *   GET    /v1/stock/:productId       stock:read
 *   PATCH  /v1/stock/:productId       stock:write     { quantity, reason }
 *   GET    /v1/sales                  sales:read
 *   POST   /v1/sales                  sales:write     (header Idempotency-Key)
 *   GET    /v1/customers              customers:read
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const API_VERSION = "1";

function baseHeaders() {
  return {
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

/** Error de base SIN filtrar el mensaje interno de Postgres al cliente. */
function dbErr(requestId: string, detail: string) {
  // El detalle va al log de la función, donde lo ve quien opera; al cliente le
  // llega el request id para reportarlo. Un mensaje de Postgres crudo filtra
  // nombres de constraints, triggers y columnas.
  console.error(`[public-api] ${requestId}: ${detail}`);
  return err(`Internal error (request ${requestId})`, 500, "internal_error");
}

async function sha256hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  // Sin CORS permisivo a propósito: API server-to-server. Un preflight de
  // navegador no recibe Allow-Origin y el browser bloquea — que es el
  // comportamiento deseado, igual que la API de Stripe.
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (checkRateLimit(req, "public-api", { max: 120, windowMs: 60_000 })) return rateLimitResponse();

  const requestId = crypto.randomUUID();
  const url = new URL(req.url);

  const rawPath = url.pathname.replace(/.*\/public-api\/?/, "");
  const withoutVersion = rawPath.replace(/^v1\//, "");
  // Sólo v1 existe. /v2/ tiene que dar 404, no mapear en silencio al handler
  // de v1: si algún día hay v2, un cliente que ya usaba esa URL recibiría otra
  // semántica sin enterarse.
  if (/^v\d+\//.test(withoutVersion)) {
    return err(`Unknown API version. Only v1 exists.`, 404, "unknown_version");
  }
  const segments = withoutVersion.split("/").filter(Boolean);
  const [resource, resourceId] = segments;

  // ── Auth: hash de la key contra api_keys ─────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) return err("Authorization header required (Bearer <api_key>)", 401, "auth_required");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const keyHash = await sha256hex(apiKey);
  const { data: keyRow, error: keyErr } = await supabase
    .from("api_keys")
    .select("id, org_id, scopes, revoked_at, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  // Un fallo de DB NO es "key inválida": son problemas opuestos, y confundir
  // los deja al integrador revisando su key mientras la base está caída.
  if (keyErr) return dbErr(requestId, `auth lookup: ${keyErr.message}`);
  if (!keyRow) return err("Invalid API key", 401, "invalid_api_key");
  if (keyRow.revoked_at) return err("API key revoked", 401, "revoked_api_key");
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return err("API key expired", 401, "expired_api_key");
  }

  const orgId = keyRow.org_id as string;
  const scopes: string[] = Array.isArray(keyRow.scopes) ? keyRow.scopes : [];
  const tiene = (scope: string) => scopes.includes(scope);
  const sinScope = (scope: string) =>
    err(`This key lacks the '${scope}' scope`, 403, "insufficient_scope");

  // Registro de uso, fire-and-forget: que falle el contador no puede frenar
  // una request que ya autenticó.
  supabase.rpc("api_key_tocar", { p_key_id: keyRow.id }).then(() => {}, () => {});

  // El dueño operativo de las escrituras y el tipo de cambio salen de
  // settings, buscados por la organización YA autenticada — nunca al revés.
  const { data: settings, error: settingsErr } = await supabase
    .from("settings")
    .select("user_id, exchange_rate")
    .eq("org_id", orgId)
    .maybeSingle();
  if (settingsErr) return dbErr(requestId, `settings lookup: ${settingsErr.message}`);

  // ── GET /products ────────────────────────────────────────────
  if (resource === "products" && !resourceId && req.method === "GET") {
    if (!tiene("products:read")) return sinScope("products:read");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    const limitParam = Math.min(Number(url.searchParams.get("limit") || "100"), 500);

    // El costo sólo viaja con su scope: es el dato más sensible del negocio.
    const columnas = tiene("costs:read")
      ? "id,name,category,stock,cost_usd,sale_price_ars,image_url,barcode"
      : "id,name,category,stock,sale_price_ars,image_url,barcode";

    let query = supabase
      .from("products")
      .select(columnas)
      .eq("org_id", orgId)
      .order("name")
      .limit(limitParam);

    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return dbErr(requestId, error.message);
    return json({ data, count: data?.length, version: API_VERSION });
  }

  // ── GET /products/:id ────────────────────────────────────────
  if (resource === "products" && resourceId && req.method === "GET") {
    if (!tiene("products:read")) return sinScope("products:read");
    // Lista explícita, no select("*"): con el asterisco, cualquier columna
    // sensible que se agregue mañana se filtra sola a las integraciones.
    const columnas = tiene("costs:read")
      ? "id,name,category,stock,cost_usd,total_cost_usd,sale_price_ars,discount_price_ars,image_url,barcode,description,tax_rate,created_at"
      : "id,name,category,stock,sale_price_ars,discount_price_ars,image_url,barcode,description,created_at";
    const { data, error } = await supabase
      .from("products").select(columnas).eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return dbErr(requestId, error.message);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data });
  }

  // ── GET /stock/:productId ────────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "GET") {
    if (!tiene("stock:read")) return sinScope("stock:read");
    const { data, error } = await supabase
      .from("products").select("id,name,stock").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return dbErr(requestId, error.message);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data });
  }

  // ── PATCH /stock/:productId ──────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "PATCH") {
    if (!tiene("stock:write")) return sinScope("stock:write");
    const body = await req.json().catch(() => ({}));
    const qty = Number(body.quantity);
    if (isNaN(qty)) return err("quantity must be a number", 400, "validation_error");
    if (qty < 0) return err("quantity cannot be negative", 400, "validation_error");
    if (!Number.isInteger(qty)) return err("quantity must be an integer", 400, "validation_error");
    // La API fija un conteo absoluto, pero el delta y el asiento de Kardex los
    // calcula `adjust_stock` dentro de la base: el cliente nunca escribe
    // products.stock. Verificar el producto antes importa porque la función
    // recibe service_role.
    const { data: product, error: productError } = await supabase
      .from("products").select("id").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (productError) return dbErr(requestId, productError.message);
    if (!product) return err("Product not found", 404, "not_found");
    if (!settings?.user_id) return err("API key has no stock adjustment owner", 409, "stock_owner_missing");
    const { error } = await supabase.rpc("adjust_stock", {
      p_org_id: orgId,
      p_product_id: product.id,
      p_variant_id: null,
      p_new_stock: qty,
      p_notes: typeof body.reason === "string" ? body.reason.slice(0, 500) : "Ajuste vía API pública",
      p_created_by: settings.user_id,
    });
    if (error) return dbErr(requestId, error.message);
    return json({ updated: true, productId: resourceId, stock: qty });
  }

  // ── GET /sales ────────────────────────────────────────────────
  if (resource === "sales" && !resourceId && req.method === "GET") {
    if (!tiene("sales:read")) return sinScope("sales:read");
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
    if (error) return dbErr(requestId, error.message);
    return json({ data, count: data?.length });
  }

  // ── POST /sales ───────────────────────────────────────────────
  if (resource === "sales" && !resourceId && req.method === "POST") {
    if (!tiene("sales:write")) return sinScope("sales:write");
    const body = await req.json().catch(() => null);
    if (!body?.product_id || body?.quantity === undefined || body?.total_ars === undefined) {
      return err("Required: product_id, quantity, total_ars", 400, "validation_error");
    }
    const quantity = Number(body.quantity);
    const total = Number(body.total_ars);
    // Entero y finito, igual que el PATCH de stock. Antes "abc" pasaba el
    // truthy check, NaN <= 0 daba false, y se insertaba quantity NaN.
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return err("quantity must be a positive integer", 400, "validation_error");
    }
    if (!Number.isFinite(total) || total < 0) {
      return err("total_ars must be a non-negative number", 400, "validation_error");
    }
    if (!settings?.user_id) return err("API key has no sale owner", 409, "sale_owner_missing");

    // La API key identifica la organización; el JSON nunca elige otro tenant,
    // otro usuario ni el nombre/costo de otro producto.
    //
    // Esta búsqueda va ANTES de reservar la clave de idempotencia, y el orden
    // importa: si un product_id inexistente reservaba primero, el 404 dejaba la
    // clave en `en_curso` y el reintento —incluso ya corregido— chocaba 24 h
    // contra un 409 por una request que nunca escribió nada. Stripe lo dice
    // explícito: un fallo de validación no guarda resultado idempotente.
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,name,total_cost_usd")
      .eq("id", body.product_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (productError) return dbErr(requestId, productError.message);
    if (!product) return err("Product not found", 404, "not_found");

    // Idempotencia con clave del cliente, como Stripe (primitiva H1). Un retry
    // de red con la misma clave devuelve la MISMA venta en vez de duplicarla —
    // y el trigger de sales no vuelve a descontar stock. Desde acá hasta el
    // insert no puede haber ningún `return` que no libere la clave.
    const idemKey = (req.headers.get("Idempotency-Key") || "").trim().slice(0, 120);
    if (idemKey) {
      const { data: reserva, error: idemErr } = await supabase.rpc("idempotencia_reservar", {
        p_org: orgId,
        p_operacion: "api_create_sale",
        p_clave: idemKey,
        p_payload: { product_id: body.product_id, quantity, total_ars: total },
      });
      if (idemErr) {
        // 23505 = misma clave con otro pedido; 55006 = en curso. Los demás son
        // fallos de infraestructura.
        if (idemErr.code === "23505") return err("Idempotency-Key already used with a different request", 409, "idempotency_conflict");
        if (idemErr.code === "55006") return err("A request with this Idempotency-Key is in progress", 409, "idempotency_in_progress");
        return dbErr(requestId, `idempotency: ${idemErr.message}`);
      }
      const r = reserva as { ejecutar?: boolean; respuesta?: unknown } | null;
      if (r && r.ejecutar === false) {
        return json({ data: r.respuesta, idempotent_replay: true }, 200);
      }
    }

    const requestedUnitPrice = Number(body.unit_price_ars);
    const unitPrice = Number.isFinite(requestedUnitPrice) && requestedUnitPrice >= 0
      ? requestedUnitPrice
      : total / quantity;
    const costPerUnitUsd = Number(product.total_cost_usd || 0);
    const exchangeRate = Number(settings?.exchange_rate || 1);
    const costOfGoodsArs = costPerUnitUsd * exchangeRate * quantity;
    const profitArs = total - costOfGoodsArs;

    // Escritura de servidor para una integración con API key y scope
    // sales:write. El trigger de `sales` crea/agrupa sale_transactions y
    // aplica el cupo del plan.
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

    if (error) {
      if (idemKey) {
        await supabase.rpc("idempotencia_fallar", {
          p_org: orgId, p_operacion: "api_create_sale", p_clave: idemKey,
          p_error: error.message,
        }).then(() => {}, () => {});
      }
      return dbErr(requestId, error.message);
    }

    if (idemKey) {
      await supabase.rpc("idempotencia_completar", {
        p_org: orgId, p_operacion: "api_create_sale", p_clave: idemKey,
        p_respuesta: data,
      }).then(() => {}, () => {});
    }
    return json({ data }, 201);
  }

  // ── GET /customers ────────────────────────────────────────────
  if (resource === "customers" && !resourceId && req.method === "GET") {
    if (!tiene("customers:read")) return sinScope("customers:read");
    const limit = Math.min(Number(url.searchParams.get("limit") || "200"), 500);
    const search = url.searchParams.get("search");

    let query = supabase
      .from("customers" as never)
      .select("id,name,email,phone,created_at")
      .eq("org_id", orgId)
      .order("name")
      .limit(limit);

    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return dbErr(requestId, error.message);
    return json({ data, count: data?.length });
  }

  return err(
    `Unknown endpoint: ${req.method} /${resource || ""}`,
    404,
    "not_found",
  );
});
