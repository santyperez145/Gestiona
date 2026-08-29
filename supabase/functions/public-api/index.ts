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
 *   · POST /sales exige Idempotency-Key (primitiva H1): un retry devuelve la
 *     misma venta en vez de duplicarla;
 *   · sin CORS `*`: esta API es server-to-server, como la de Stripe. Invitar a
 *     usarla desde un navegador es invitar a exponer la key en el frontend de
 *     un tercero;
 *   · los errores de Postgres no se filtran al cliente, y un fallo de DB en el
 *     lookup de auth responde 503, no "key inválida".
 *
 * Endpoints (scope requerido):
 *   GET    /v1/products               products:read  (+stock:read / +costs:read)
 *   GET    /v1/products/:id           products:read  (+stock:read / +costs:read)
 *   GET    /v1/stock/:productId       stock:read
 *   PATCH  /v1/stock/:productId       stock:write     { quantity, reason }
 *   GET    /v1/sales                  sales:read
 *   POST   /v1/sales                  sales:write     (header Idempotency-Key)
 *   GET    /v1/customers              customers:read
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimiter.ts";
import {
  isIsoDateTime,
  isUuid,
  parsePageSize,
  parsePublicDecimal,
  publicApiHeaders,
  PUBLIC_API_ARS_DECIMALS,
  PUBLIC_API_LIFECYCLE,
  PUBLIC_API_MAX_ARS,
  PUBLIC_API_MAX_INTEGER,
  PUBLIC_API_MAX_PAGE_SIZE,
  PUBLIC_API_PATH_VERSION,
  PUBLIC_API_PUBLIC_ORIGIN,
  PUBLIC_API_USD_DECIMALS,
  PUBLIC_API_VERSION,
  roundDecimal,
  type PublicApiRateLimit,
} from "../_shared/publicApiContract.ts";

type JsonRecord = Record<string, unknown>;

function publicProduct(row: JsonRecord, includeStock: boolean, includeCosts: boolean): JsonRecord {
  const product: JsonRecord = {
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    sale_price_ars: roundDecimal(row.sale_price_ars, PUBLIC_API_ARS_DECIMALS),
    image_url: row.image_url ?? null,
    barcode: row.barcode ?? null,
  };
  if ("discount_price_ars" in row) {
    product.discount_price_ars = row.discount_price_ars == null
      ? null
      : roundDecimal(row.discount_price_ars, PUBLIC_API_ARS_DECIMALS);
  }
  if ("description" in row) product.description = row.description ?? null;
  if ("tax_rate" in row) product.tax_rate = row.tax_rate ?? null;
  if ("created_at" in row) product.created_at = row.created_at;
  if (includeStock) product.stock = Number(row.stock ?? 0);
  if (includeCosts) {
    if ("cost_usd" in row) product.cost_usd = roundDecimal(row.cost_usd, PUBLIC_API_USD_DECIMALS);
    if ("total_cost_usd" in row) product.total_cost_usd = roundDecimal(row.total_cost_usd, PUBLIC_API_USD_DECIMALS);
  }
  return product;
}

function publicSale(row: JsonRecord, includeCosts: boolean): JsonRecord {
  const sale: JsonRecord = {
    id: row.id,
    date: row.date,
    customer_name: row.customer_name ?? null,
    total_ars: roundDecimal(row.total_ars, PUBLIC_API_ARS_DECIMALS),
    payment_method: row.payment_method ?? row.method ?? null,
    product_id: row.product_id ?? null,
    product_name: row.product_name,
    quantity: Number(row.quantity ?? 0),
    paid: Boolean(row.paid),
    source: row.source ?? null,
  };
  if ("unit_price_ars" in row) {
    sale.unit_price_ars = roundDecimal(row.unit_price_ars, PUBLIC_API_ARS_DECIMALS);
  }
  if (includeCosts) {
    sale.cost_per_unit_usd = roundDecimal(row.cost_per_unit_usd, PUBLIC_API_USD_DECIMALS);
    sale.cost_of_goods_ars = roundDecimal(row.cost_of_goods_ars, PUBLIC_API_ARS_DECIMALS);
    sale.profit_ars = roundDecimal(row.profit_ars, PUBLIC_API_ARS_DECIMALS);
    sale.profit_usd = roundDecimal(row.profit_usd, PUBLIC_API_USD_DECIMALS);
  }
  return sale;
}

async function sha256hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const appOrigin = (Deno.env.get("PUBLIC_APP_URL") || PUBLIC_API_PUBLIC_ORIGIN).replace(/\/$/, "");
  const requestContext: { rateLimit?: PublicApiRateLimit } = {};
  const headers = (extra?: Record<string, string>) => publicApiHeaders({
    requestId,
    origin: appOrigin,
    rateLimit: requestContext.rateLimit,
    lifecycle: PUBLIC_API_LIFECYCLE[PUBLIC_API_PATH_VERSION],
    extra,
  });
  const json = (data: unknown, status = 200, extra?: Record<string, string>) =>
    new Response(JSON.stringify(data), { status, headers: headers(extra) });
  const err = (message: string, status = 400, code?: string, extra?: Record<string, string>) =>
    json({ error: message, ...(code ? { code } : {}), request_id: requestId }, status, extra);
  const dbErr = (detail: string, status = 500) => {
    // El detalle queda en logs y el id que recibe el integrador es exactamente
    // el mismo. Antes cada helper generaba otro X-Request-Id y era imposible
    // correlacionar un 500 con su traza.
    console.error(`[public-api] ${requestId}: ${detail}`);
    return err(`Internal error (request ${requestId})`, status, "internal_error");
  };

  // Sin CORS permisivo a propósito: API server-to-server. Un preflight de
  // navegador no recibe Allow-Origin y el browser bloquea — que es el
  // comportamiento deseado, igual que la API de Stripe.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  // Escudo barato pre-auth contra fuerza bruta. El cupo contractual se aplica
  // despues por key, en Postgres y entre todas las instancias.
  if (checkRateLimit(req, "public-api-preauth", { max: 5_000, windowMs: 60_000 })) {
    return err("Too many requests. Please try again later.", 429, "rate_limit_exceeded", {
      "Retry-After": "60",
    });
  }

  const url = new URL(req.url);

  const rawPath = url.pathname.replace(/.*\/public-api\/?/, "");
  const versionPrefix = `${PUBLIC_API_PATH_VERSION}/`;
  // La version es parte obligatoria del path. Aceptar /products como alias de
  // /v1/products haria imposible retirarlo o cambiar su semantica sin romper
  // clientes invisibles.
  if (!rawPath.startsWith(versionPrefix)) {
    return err(
      `Versioned path required. Use /${PUBLIC_API_PATH_VERSION}/…`,
      404,
      "unknown_version",
    );
  }
  const withoutVersion = rawPath.slice(versionPrefix.length);
  const segments = withoutVersion.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) {
    return err(`Unknown endpoint: ${req.method} /${withoutVersion}`, 404, "not_found");
  }
  const [resource, resourceId] = segments;

  // ── Auth: hash de la key contra api_keys ─────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const authMatch = authHeader.match(/^Bearer\s+(\S+)$/i);
  const apiKey = authMatch?.[1] ?? "";
  if (!apiKey) return err("Authorization header required (Bearer <api_key>)", 401, "auth_required");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const keyHash = await sha256hex(apiKey);
  const { data: keyRow, error: keyErr } = await supabase
    .from("api_keys")
    .select("id, org_id, scopes, revoked_at, expires_at, rate_limit_rpm")
    .eq("key_hash", keyHash)
    .maybeSingle();

  // Un fallo de DB NO es "key inválida": son problemas opuestos, y confundir
  // los deja al integrador revisando su key mientras la base está caída.
  if (keyErr) return dbErr(`auth lookup: ${keyErr.message}`, 503);
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

  // El limite anunciado por la key ahora es durable y atomico. Si la autoridad
  // de cupo no responde, la API falla cerrado con 503; no inventa capacidad.
  const { data: quotaData, error: quotaError } = await supabase.rpc("api_key_consumir_cupo", {
    p_key_id: keyRow.id,
  });
  if (quotaError) return dbErr(`rate limit: ${quotaError.message}`, 503);
  const quota = quotaData as {
    allowed?: unknown;
    limit?: unknown;
    remaining?: unknown;
    reset_at?: unknown;
  } | null;
  if (!quota || typeof quota.allowed !== "boolean") return dbErr("rate limit: invalid response", 503);
  requestContext.rateLimit = {
    limit: Number(quota.limit),
    remaining: Number(quota.remaining),
    resetAt: Number(quota.reset_at),
  };
  if (![requestContext.rateLimit.limit, requestContext.rateLimit.remaining, requestContext.rateLimit.resetAt].every(Number.isFinite)) {
    return dbErr("rate limit: non-numeric response", 503);
  }
  if (!quota.allowed) {
    const retryAfter = Math.max(1, requestContext.rateLimit.resetAt - Math.floor(Date.now() / 1_000));
    return err("API key rate limit exceeded", 429, "rate_limit_exceeded", {
      "Retry-After": String(retryAfter),
    });
  }

  // El dueño operativo de los ajustes sale de settings, buscado por la
  // organización YA autenticada — nunca al revés.
  const { data: settings, error: settingsErr } = await supabase
    .from("settings")
    .select("user_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (settingsErr) return dbErr(`settings lookup: ${settingsErr.message}`, 503);

  // ── GET /products ────────────────────────────────────────────
  if (resource === "products" && !resourceId && req.method === "GET") {
    if (!tiene("products:read")) return sinScope("products:read");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    if (category && category.length > 200) return err("category must not exceed 200 characters", 400, "validation_error");
    if (search && search.length > 200) return err("search must not exceed 200 characters", 400, "validation_error");
    const limitParam = parsePageSize(url.searchParams.get("limit"));
    if (limitParam == null) {
      return err(`limit must be an integer between 1 and ${PUBLIC_API_MAX_PAGE_SIZE}`, 400, "validation_error");
    }

    // Stock y costo son permisos separados del catalogo. Antes products:read
    // filtraba stock aunque la key no tuviera stock:read.
    const columnas = [
      "id", "name", "category", "sale_price_ars", "image_url", "barcode",
      ...(tiene("stock:read") ? ["stock"] : []),
      ...(tiene("costs:read") ? ["cost_usd"] : []),
    ].join(",");

    let query = supabase
      .from("products")
      .select(columnas)
      .eq("org_id", orgId)
      .order("name")
      .limit(limitParam);

    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return dbErr(error.message);
    const safeData = (data ?? []).map((row) => publicProduct(
      row as unknown as JsonRecord,
      tiene("stock:read"),
      tiene("costs:read"),
    ));
    return json({ data: safeData, count: safeData.length, version: PUBLIC_API_VERSION });
  }

  // ── GET /products/:id ────────────────────────────────────────
  if (resource === "products" && resourceId && req.method === "GET") {
    if (!tiene("products:read")) return sinScope("products:read");
    if (!isUuid(resourceId)) return err("productId must be a UUID", 400, "validation_error");
    // Lista explícita, no select("*"): con el asterisco, cualquier columna
    // sensible que se agregue mañana se filtra sola a las integraciones.
    const columnas = [
      "id", "name", "category", "sale_price_ars", "discount_price_ars",
      "image_url", "barcode", "description", "tax_rate", "created_at",
      ...(tiene("stock:read") ? ["stock"] : []),
      ...(tiene("costs:read") ? ["cost_usd", "total_cost_usd"] : []),
    ].join(",");
    const { data, error } = await supabase
      .from("products").select(columnas).eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return dbErr(error.message);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data: publicProduct(
      data as unknown as JsonRecord,
      tiene("stock:read"),
      tiene("costs:read"),
    ) });
  }

  // ── GET /stock/:productId ────────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "GET") {
    if (!tiene("stock:read")) return sinScope("stock:read");
    if (!isUuid(resourceId)) return err("productId must be a UUID", 400, "validation_error");
    const { data, error } = await supabase
      .from("products").select("id,name,stock").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (error) return dbErr(error.message);
    if (!data) return err("Product not found", 404, "not_found");
    return json({ data });
  }

  // ── PATCH /stock/:productId ──────────────────────────────────
  if (resource === "stock" && resourceId && req.method === "PATCH") {
    if (!tiene("stock:write")) return sinScope("stock:write");
    if (!isUuid(resourceId)) return err("productId must be a UUID", 400, "validation_error");
    const body = await req.json().catch(() => ({}));
    const qty = body.quantity;
    if (typeof qty !== "number" || !Number.isFinite(qty)) return err("quantity must be a number", 400, "validation_error");
    if (qty < 0) return err("quantity cannot be negative", 400, "validation_error");
    if (!Number.isInteger(qty) || qty > PUBLIC_API_MAX_INTEGER) {
      return err(`quantity must be an integer no greater than ${PUBLIC_API_MAX_INTEGER}`, 400, "validation_error");
    }
    if (body.reason != null && typeof body.reason !== "string") {
      return err("reason must be a string", 400, "validation_error");
    }
    if (typeof body.reason === "string" && body.reason.length > 500) {
      return err("reason must not exceed 500 characters", 400, "validation_error");
    }
    // La API fija un conteo absoluto, pero el delta y el asiento de Kardex los
    // calcula `adjust_stock` dentro de la base: el cliente nunca escribe
    // products.stock. Verificar el producto antes importa porque la función
    // recibe service_role.
    const { data: product, error: productError } = await supabase
      .from("products").select("id").eq("id", resourceId).eq("org_id", orgId).maybeSingle();
    if (productError) return dbErr(productError.message);
    if (!product) return err("Product not found", 404, "not_found");
    if (!settings?.user_id) return err("API key has no stock adjustment owner", 409, "stock_owner_missing");
    const { error } = await supabase.rpc("adjust_stock", {
      p_org_id: orgId,
      p_product_id: product.id,
      p_variant_id: null,
      p_new_stock: qty,
      p_notes: typeof body.reason === "string" ? body.reason : "Ajuste vía API pública",
      p_created_by: settings.user_id,
    });
    if (error) return dbErr(error.message);
    return json({ updated: true, productId: resourceId, stock: qty });
  }

  // ── GET /sales ────────────────────────────────────────────────
  if (resource === "sales" && !resourceId && req.method === "GET") {
    if (!tiene("sales:read")) return sinScope("sales:read");
    const limit = parsePageSize(url.searchParams.get("limit"), 50, 200);
    if (limit == null) return err("limit must be an integer between 1 and 200", 400, "validation_error");
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    if (since && !isIsoDateTime(since)) return err("since must be an ISO 8601 date-time", 400, "validation_error");
    if (until && !isIsoDateTime(until)) return err("until must be an ISO 8601 date-time", 400, "validation_error");
    if (since && until && Date.parse(since) > Date.parse(until)) {
      return err("since must be before or equal to until", 400, "validation_error");
    }

    let query = supabase
      .from("sales")
      .select("id,date,customer_name,total_ars,payment_method,product_id,product_name,quantity,paid,source,unit_price_ars")
      .eq("org_id", orgId)
      .order("date", { ascending: false })
      .limit(limit);

    if (since) query = query.gte("date", since);
    if (until) query = query.lte("date", until);

    const { data, error } = await query;
    if (error) return dbErr(error.message);
    const safeData = (data ?? []).map((row) => publicSale(row as unknown as JsonRecord, false));
    return json({ data: safeData, count: safeData.length });
  }

  // ── POST /sales ───────────────────────────────────────────────
  if (resource === "sales" && !resourceId && req.method === "POST") {
    if (!tiene("sales:write")) return sinScope("sales:write");
    const body = await req.json().catch(() => null);
    if (!body?.product_id || body?.quantity === undefined || body?.total_ars === undefined) {
      return err("Required: product_id, quantity, total_ars", 400, "validation_error");
    }
    if (!isUuid(body.product_id)) return err("product_id must be a UUID", 400, "validation_error");
    const quantity = body.quantity;
    const total = parsePublicDecimal(body.total_ars, PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS);
    // Entero y finito, igual que el PATCH de stock. Antes "abc" pasaba el
    // truthy check, NaN <= 0 daba false, y se insertaba quantity NaN.
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > PUBLIC_API_MAX_INTEGER) {
      return err(`quantity must be a positive integer no greater than ${PUBLIC_API_MAX_INTEGER}`, 400, "validation_error");
    }
    if (total == null) {
      return err("total_ars must be a non-negative ARS amount with at most 2 decimals", 400, "validation_error");
    }
    if (!settings?.user_id) return err("API key has no sale owner", 409, "sale_owner_missing");

    const unitPrice = body.unit_price_ars === undefined
      ? roundDecimal(total / quantity, PUBLIC_API_ARS_DECIMALS)
      : parsePublicDecimal(body.unit_price_ars, PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS);
    if (unitPrice == null) {
      return err("unit_price_ars must be a non-negative ARS amount with at most 2 decimals", 400, "validation_error");
    }
    if (body.customer_name != null && typeof body.customer_name !== "string") {
      return err("customer_name must be a string", 400, "validation_error");
    }
    if (typeof body.customer_name === "string" && body.customer_name.length > 500) {
      return err("customer_name must not exceed 500 characters", 400, "validation_error");
    }
    if (body.paid != null && typeof body.paid !== "boolean") {
      return err("paid must be a boolean", 400, "validation_error");
    }
    if (body.payment_method != null && (typeof body.payment_method !== "string" || !body.payment_method.trim())) {
      return err("payment_method must be a non-empty string", 400, "validation_error");
    }
    if (typeof body.payment_method === "string" && body.payment_method.length > 100) {
      return err("payment_method must not exceed 100 characters", 400, "validation_error");
    }
    if (body.date != null && !isIsoDateTime(body.date)) {
      return err("date must be an ISO 8601 date-time", 400, "validation_error");
    }
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() || null : null;
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : "efectivo";
    const paid = body.paid !== false;
    const saleDate = typeof body.date === "string" ? new Date(body.date).toISOString() : null;

    const idemKey = (req.headers.get("Idempotency-Key") || "").trim();
    if (!idemKey) return err("Idempotency-Key header required", 400, "idempotency_key_required");
    if (idemKey.length > 120) return err("Idempotency-Key must not exceed 120 characters", 400, "validation_error");

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
      .select("id")
      .eq("id", body.product_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (productError) return dbErr(productError.message);
    if (!product) return err("Product not found", 404, "not_found");

    // Reserva, insert, triggers de stock/outbox y cierre de idempotencia viven
    // en una sola transaccion de base. El Edge nunca escribe stock ni calcula
    // costos autoritativos. La respuesta se vuelve a allowlistear por scope:
    // ni siquiera un replay guardado puede filtrar margen a una key acotada.
    const { data: result, error } = await supabase.rpc("api_v1_crear_venta", {
      p_org_id: orgId,
      p_api_key_id: keyRow.id,
      p_product_id: product.id,
      p_quantity: quantity,
      p_total_ars: total,
      p_unit_price_ars: unitPrice,
      p_customer_name: customerName,
      p_paid: paid,
      p_payment_method: paymentMethod,
      p_date: saleDate,
      p_idempotency_key: idemKey,
    });
    if (error) {
      if (error.code === "23505") return err("Idempotency-Key already used with a different request", 409, "idempotency_conflict");
      if (error.code === "55006") return err("A request with this Idempotency-Key is in progress", 409, "idempotency_in_progress");
      if (error.code === "P0002") return err("Product not found", 404, "not_found");
      if (error.code === "42501") return sinScope("sales:write");
      return dbErr(`create sale: ${error.message}`);
    }
    const rpcResult = result as { data?: JsonRecord; idempotent_replay?: boolean } | null;
    if (!rpcResult?.data) return dbErr("create sale: invalid response");
    const safeSale = publicSale(rpcResult.data, tiene("costs:read"));
    return json(
      { data: safeSale, idempotent_replay: rpcResult.idempotent_replay === true },
      rpcResult.idempotent_replay ? 200 : 201,
    );
  }

  // ── GET /customers ────────────────────────────────────────────
  if (resource === "customers" && !resourceId && req.method === "GET") {
    if (!tiene("customers:read")) return sinScope("customers:read");
    const limit = parsePageSize(url.searchParams.get("limit"), 200);
    if (limit == null) {
      return err(`limit must be an integer between 1 and ${PUBLIC_API_MAX_PAGE_SIZE}`, 400, "validation_error");
    }
    const search = url.searchParams.get("search");
    if (search && search.length > 200) return err("search must not exceed 200 characters", 400, "validation_error");

    let query = supabase
      .from("customers" as never)
      .select("id,name,email,phone,created_at")
      .eq("org_id", orgId)
      .order("name")
      .limit(limit);

    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    if (error) return dbErr(error.message);
    const safeData = data ?? [];
    return json({ data: safeData, count: safeData.length });
  }

  return err(
    `Unknown endpoint: ${req.method} /${resource || ""}`,
    404,
    "not_found",
  );
});
