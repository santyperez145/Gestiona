/**
 * Cobro QR dinámico de mostrador con Mercado Pago Orders API.
 *
 * El navegador no decide importe, comisión, stock ni estado del proveedor.
 * Prepara una sesión autenticada; esta Edge crea/consulta/cancela la order con
 * OAuth del comercio y la base registra el ticket sólo ante `processed`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import {
  fetchMercadoPagoOrder,
  mercadoPagoOrderInternals,
  MercadoPagoOrderError,
  reconcileMercadoPagoPosQrOrder,
  type JsonRecord,
} from "../_shared/mercadoPagoOrders.ts";
import { exigirCron } from "../_shared/cronAuth.ts";
import { requireUser } from "../_shared/requireUser.ts";

const MP_API = "https://api.mercadopago.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATES = new Set(["completed", "cancelled", "expired", "failed", "manual_review", "refunded"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const { asRecord, cleanText } = mercadoPagoOrderInternals;

function providerSnapshot(payload: JsonRecord) {
  const transactions = asRecord(payload.transactions);
  const payments = Array.isArray(transactions.payments) ? transactions.payments : [];
  const payment = asRecord(payments[0]);
  return {
    source: "mercadopago_orders_api",
    order_id: cleanText(payload.id, 180),
    order_status: cleanText(payload.status, 80),
    order_status_detail: cleanText(payload.status_detail, 120),
    payment_transaction_id: cleanText(payment.id, 180),
    payment_reference_id: cleanText(payment.reference_id, 180),
  };
}

async function mpJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<{ response: Response; payload: JsonRecord }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { response, payload: asRecord(await response.json().catch(() => ({}))) };
}

async function permission(
  // deno-lint-ignore no-explicit-any
  userClient: any,
  orgId: string,
  module: "sales" | "payments",
  action: "create" | "edit",
) {
  const { data, error } = await userClient.rpc("has_permission", {
    p_org_id: orgId,
    p_module: module,
    p_action: action,
  });
  if (error) throw error;
  return data === true;
}

async function readVisibleSession(
  // deno-lint-ignore no-explicit-any
  userClient: any,
  sessionId: string,
): Promise<JsonRecord | null> {
  const { data, error } = await userClient.rpc("pos_qr_session_response", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const value = asRecord(data);
  return value.session_id ? value : null;
}

async function readAdminSession(
  // deno-lint-ignore no-explicit-any
  admin: any,
  sessionId: string,
): Promise<JsonRecord | null> {
  const { data, error } = await admin.rpc("pos_qr_session_response", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const value = asRecord(data);
  return value.session_id ? value : null;
}

/**
 * Red de seguridad del webhook: vuelve a consultar Orders abiertas aunque Caja
 * haya cerrado. Sólo toma sesiones con id de proveedor persistido; un intento
 * ambiguo sin Order se recupera con acción humana usando la misma idempotencia.
 */
async function reconcileOpenOrders(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<Response> {
  const { data: expiredOrphans, error: expireError } = await admin.rpc("pos_qr_expire_orphans");
  if (expireError) throw expireError;

  const { data, error } = await admin
    .from("pos_qr_sessions")
    .select("id,org_id,state,provider_order_id")
    .in("state", ["pending", "accredited", "finalizing"])
    .not("provider_order_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    org_id: string;
    state: string;
    provider_order_id: string;
  }>;
  const credentialsByOrg = new Map<string, Awaited<ReturnType<typeof getMpCredentials>>>();
  const result = {
    examined: rows.length,
    completed: 0,
    stillOpen: 0,
    terminal: 0,
    errors: 0,
    expiredOrphans: Number(expiredOrphans ?? 0),
    truncated: rows.length === 25,
  };

  const reconcileOne = async (row: typeof rows[number]) => {
    try {
      let credentials = credentialsByOrg.get(row.org_id);
      if (credentials === undefined) {
        credentials = await getMpCredentials(admin, row.org_id);
        credentialsByOrg.set(row.org_id, credentials);
      }
      if (!credentials) throw new Error("Mercado Pago no está conectado para la organización");
      const order = await fetchMercadoPagoOrder(credentials.accessToken, row.provider_order_id);
      const session = await reconcileMercadoPagoPosQrOrder(
        admin, credentials.accessToken, row.id, order,
      );
      if (session.state === "completed") result.completed += 1;
      else if (TERMINAL_STATES.has(String(session.state))) result.terminal += 1;
      else result.stillOpen += 1;
    } catch (reconcileError) {
      result.errors += 1;
      console.error(`mercadopago-pos-qr cron session ${row.id}:`, reconcileError);
    }
  };

  // Lotes pequeños: evita serializar 25 timeouts y también una ráfaga amplia
  // contra Mercado Pago cuando hay varias cajas operando a la vez.
  for (let start = 0; start < rows.length; start += 5) {
    await Promise.all(rows.slice(start, start + 5).map(reconcileOne));
  }

  return json({ ok: result.errors === 0, mode: "cron-reconcile", ...result });
}

function amountText(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El total server-side del QR es inválido");
  return (Math.round(amount * 100) / 100).toFixed(2);
}

async function createOrder(
  // deno-lint-ignore no-explicit-any
  admin: any,
  accessToken: string,
  externalPosId: string,
  session: JsonRecord,
): Promise<Response> {
  const sessionId = String(session.session_id);
  const total = amountText(session.amount);
  const platformFee = Number(session.platform_fee ?? 0);
  const items = (Array.isArray(session.items) ? session.items : []).map((raw) => {
    const item = asRecord(raw);
    return {
      title: cleanText(item.title, 120) ?? "Producto",
      unit_price: amountText(item.unit_price),
      quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
    };
  });
  const body = {
    type: "qr",
    total_amount: total,
    description: "Venta presencial Gestiona",
    external_reference: `posqr_${sessionId.replaceAll("-", "")}`,
    expiration_time: "PT15M",
    ...(platformFee > 0 ? { marketplace_fee: amountText(platformFee) } : {}),
    config: { qr: { external_pos_id: externalPosId, mode: "dynamic" } },
    transactions: { payments: [{ amount: total }] },
    ...(items.length ? { items } : {}),
  };

  let result: { response: Response; payload: JsonRecord };
  try {
    result = await mpJson(`${MP_API}/v1/orders`, accessToken, {
      method: "POST",
      headers: { "X-Idempotency-Key": String(session.payment_attempt_id) },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("mercadopago-pos-qr create network:", error);
    return json({
      error: "Mercado Pago no respondió. Podés reintentar: la clave idempotente evita duplicar el cobro.",
      code: "MP_NETWORK_RETRYABLE",
      retryable: true,
      session,
    }, 503);
  }

  const orderId = cleanText(result.payload.id, 180);
  const qrData = cleanText(asRecord(result.payload.type_response).qr_data, 4_000);
  if (!result.response.ok || !orderId || !qrData) {
    console.error("mercadopago-pos-qr create provider:", result.response.status, result.payload);
    const ambiguous = result.response.status === 409 || result.response.status >= 500;
    if (!ambiguous) {
      const { error } = await admin.rpc("pos_qr_provider_failed", {
        p_session_id: sessionId,
        p_reason: cleanText(result.payload.message ?? result.payload.error, 500)
          ?? `Mercado Pago rechazó la order (${result.response.status})`,
        p_raw: providerSnapshot(result.payload),
      });
      if (error) console.error("pos_qr_provider_failed:", error);
    }
    return json({
      error: ambiguous
        ? "Mercado Pago no confirmó si creó el QR. Reintentá sin cambiar el carrito."
        : "Mercado Pago rechazó la creación del QR. Revisá la caja configurada.",
      code: ambiguous ? "MP_CREATE_AMBIGUOUS" : "MP_CREATE_REJECTED",
      retryable: ambiguous,
      providerStatus: result.response.status,
    }, ambiguous ? 503 : 422);
  }

  const { data: saved, error: savedError } = await admin.rpc("pos_qr_provider_created", {
    p_session_id: sessionId,
    p_provider_order_id: orderId,
    p_qr_data: qrData,
    p_provider_status: cleanText(result.payload.status, 80) ?? "created",
    p_raw: providerSnapshot(result.payload),
  });
  if (savedError) throw savedError;

  const state = cleanText(result.payload.status, 80)?.toLowerCase();
  const reconciled = state && state !== "created"
    ? await reconcileMercadoPagoPosQrOrder(admin, accessToken, sessionId, result.payload)
    : asRecord(saved);
  return json({ ok: true, session: reconciled });
}

async function findStore(
  accessToken: string,
  userId: string,
  externalStoreId: string,
): Promise<JsonRecord | null> {
  try {
    const { response, payload } = await mpJson(
      `${MP_API}/users/${encodeURIComponent(userId)}/stores/search?external_id=${encodeURIComponent(externalStoreId)}`,
      accessToken,
    );
    if (!response.ok) return null;
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.length ? asRecord(results[0]) : null;
  } catch {
    return null;
  }
}

async function findPos(
  accessToken: string,
  externalPosId: string,
  storeId: string,
): Promise<JsonRecord | null> {
  try {
    const { response, payload } = await mpJson(
      `${MP_API}/v2/pos?external_id=${encodeURIComponent(externalPosId)}&store_id=${encodeURIComponent(storeId)}&limit=1`,
      accessToken,
    );
    if (!response.ok) return null;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows.length ? asRecord(rows[0]) : null;
  } catch {
    return null;
  }
}

async function setupPos(
  // deno-lint-ignore no-explicit-any
  admin: any,
  accessToken: string,
  connection: JsonRecord,
  orgId: string,
  body: JsonRecord,
): Promise<Response> {
  const userId = cleanText(connection.external_id, 80);
  const storeName = cleanText(body.storeName, 60);
  const streetName = cleanText(body.streetName, 120);
  const streetNumber = cleanText(body.streetNumber, 20);
  const cityName = cleanText(body.cityName, 100);
  const stateName = cleanText(body.stateName, 100);
  const reference = cleanText(body.reference, 120);
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!userId || !storeName || !streetName || !streetNumber || !cityName || !stateName
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return json({
      error: "Completá nombre, domicilio y coordenadas reales de la sucursal.",
      code: "INVALID_STORE_LOCATION",
    }, 400);
  }

  const compactOrg = orgId.replaceAll("-", "");
  const externalStoreId = cleanText(connection.mp_external_store_id, 60) ?? `GES${compactOrg}`;
  const externalPosId = cleanText(connection.mp_external_pos_id, 40) ?? `GESPOS${compactOrg}`;
  let storeId = cleanText(connection.mp_store_id, 180);

  if (!storeId) {
    const existing = await findStore(accessToken, userId, externalStoreId);
    storeId = cleanText(existing?.id, 180);
  }
  if (!storeId) {
    const storeResult = await mpJson(
      `${MP_API}/users/${encodeURIComponent(userId)}/stores`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          name: storeName,
          external_id: externalStoreId,
          location: {
            street_number: streetNumber,
            street_name: streetName,
            city_name: cityName,
            state_name: stateName,
            latitude,
            longitude,
            ...(reference ? { reference } : {}),
          },
        }),
      },
    );
    storeId = cleanText(storeResult.payload.id, 180);
    if (!storeResult.response.ok || !storeId) {
      console.error("mercadopago-pos-qr store:", storeResult.response.status, storeResult.payload);
      return json({
        error: "Mercado Pago no pudo registrar la sucursal. Verificá domicilio y coordenadas.",
        code: "MP_STORE_REJECTED",
      }, 422);
    }
    await admin.from("payment_connections").update({
      mp_store_id: storeId,
      mp_external_store_id: externalStoreId,
      updated_at: new Date().toISOString(),
    }).eq("org_id", orgId).eq("provider", "mercadopago");
  }

  const posName = cleanText(`Caja ${storeName}`.replace(/[^A-Za-z0-9 _-]/g, ""), 45) ?? "Caja Gestiona";
  const existingPos = await findPos(accessToken, externalPosId, storeId);
  const existingPosId = cleanText(existingPos?.id, 180);
  if (existingPosId) {
    const existingStatus = cleanText(existingPos?.status, 40) ?? "active";
    const { error: saveExistingError } = await admin.rpc("pos_qr_save_provider_pos", {
      p_org_id: orgId,
      p_store_id: storeId,
      p_external_store_id: externalStoreId,
      p_pos_id: existingPosId,
      p_external_pos_id: externalPosId,
      p_status: existingStatus,
    });
    if (saveExistingError) throw saveExistingError;
    return json({ ok: true, qrPosReady: existingStatus === "active", status: existingStatus, reused: true });
  }

  const posResult = await mpJson(`${MP_API}/v2/pos`, accessToken, {
    method: "POST",
    headers: { "X-Idempotency-Key": orgId },
    body: JSON.stringify({
      name: posName,
      store_id: storeId,
      external_id: externalPosId,
      config: { qr: { operating_mode: "pdv" } },
    }),
  });
  const posId = cleanText(posResult.payload.id, 180);
  const posStatus = cleanText(posResult.payload.status, 40) ?? "active";
  if (!posResult.response.ok || !posId) {
    console.error("mercadopago-pos-qr pos:", posResult.response.status, posResult.payload);
    return json({
      error: "La sucursal quedó registrada, pero Mercado Pago no pudo crear la caja. Podés reintentar.",
      code: "MP_POS_RETRYABLE",
      retryable: true,
    }, 503);
  }

  const { error: saveError } = await admin.rpc("pos_qr_save_provider_pos", {
    p_org_id: orgId,
    p_store_id: storeId,
    p_external_store_id: externalStoreId,
    p_pos_id: posId,
    p_external_pos_id: externalPosId,
    p_status: posStatus,
  });
  if (saveError) throw saveError;
  return json({ ok: true, qrPosReady: posStatus === "active", status: posStatus });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const action = cleanText(body.action, 30) ?? "create";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // El cron de Postgres no tiene usuario. Un action escrito por el navegador
    // no alcanza: la cabecera privada del vault es obligatoria y se valida
    // antes de consultar credenciales o tocar sesiones de cualquier tenant.
    if (action === "cron-reconcile" || req.headers.has("x-cron-secret")) {
      const cronGate = exigirCron(req, corsHeaders);
      if (cronGate) return cronGate;
      return await reconcileOpenOrders(admin);
    }

    const auth = await requireUser(req, corsHeaders);
    if (auth.response) return auth.response;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    if (action === "create" || action === "setup") {
      const orgId = cleanText(body.orgId, 80);
      if (!orgId || !UUID_RE.test(orgId)) return json({ error: "Organización inválida" }, 400);
      const canProceed = action === "setup"
        ? await permission(userClient, orgId, "payments", "edit")
        : await permission(userClient, orgId, "sales", "create");
      if (!canProceed) return json({ error: "No tenés permiso para operar este cobro" }, 403);

      const credentials = await getMpCredentials(admin, orgId);
      if (!credentials) {
        return json({
          error: "Conectá Mercado Pago por OAuth desde Integraciones antes de cobrar.",
          code: "MP_NOT_CONNECTED",
        }, 422);
      }
      const { data: connectionData, error: connectionError } = await admin
        .from("payment_connections")
        .select("external_id, mp_store_id, mp_external_store_id, mp_pos_id, mp_external_pos_id, mp_pos_status")
        .eq("org_id", orgId)
        .eq("provider", "mercadopago")
        .maybeSingle();
      if (connectionError) throw connectionError;
      const connection = asRecord(connectionData);

      if (action === "setup") {
        return await setupPos(admin, credentials.accessToken, connection, orgId, body);
      }
      const externalPosId = cleanText(connection.mp_external_pos_id, 40);
      if (!externalPosId || connection.mp_pos_status !== "active") {
        return json({
          error: "Configurá la sucursal y caja de Mercado Pago para habilitar QR.",
          code: "POS_SETUP_REQUIRED",
        }, 422);
      }
      const clientKey = cleanText(body.clientKey, 80);
      if (!clientKey || !UUID_RE.test(clientKey) || !Array.isArray(body.sales)) {
        return json({ error: "El carrito o la clave del cobro no son válidos" }, 400);
      }
      const { data: prepared, error: prepareError } = await userClient.rpc("pos_qr_session_prepare", {
        p_org_id: orgId,
        p_sales: body.sales,
        p_client_key: clientKey,
      });
      if (prepareError) throw prepareError;
      const session = asRecord(prepared);
      const state = cleanText(session.state, 40) ?? "preparing";
      if (TERMINAL_STATES.has(state)) return json({ ok: state === "completed", session });
      const providerOrderId = cleanText(session.provider_order_id, 180);
      if (providerOrderId) {
        const order = await fetchMercadoPagoOrder(credentials.accessToken, providerOrderId);
        const reconciled = await reconcileMercadoPagoPosQrOrder(
          admin, credentials.accessToken, String(session.session_id), order,
        );
        return json({ ok: true, session: reconciled });
      }
      return await createOrder(admin, credentials.accessToken, externalPosId, session);
    }

    if (action === "recover") {
      const orgId = cleanText(body.orgId, 80);
      if (!orgId || !UUID_RE.test(orgId)) return json({ error: "Organización inválida" }, 400);
      if (!await permission(userClient, orgId, "sales", "create")) {
        return json({ error: "No tenés permiso para recuperar cobros de esta caja" }, 403);
      }

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
      const { data: candidates, error: candidatesError } = await admin
        .from("pos_qr_sessions")
        .select("id,state,provider_order_id,created_at")
        .eq("org_id", orgId)
        .eq("created_by", auth.user.id)
        .gte("created_at", since)
        .or("state.in.(preparing,pending,accredited,finalizing),and(state.eq.completed,cashier_acknowledged_at.is.null)")
        .order("created_at", { ascending: false })
        .limit(12);
      if (candidatesError) throw candidatesError;

      let credentials: Awaited<ReturnType<typeof getMpCredentials>> | undefined;
      const sessions: JsonRecord[] = [];
      for (const rawCandidate of candidates ?? []) {
        const candidate = asRecord(rawCandidate);
        const sessionId = String(candidate.id);
        const state = String(candidate.state);
        const providerOrderId = cleanText(candidate.provider_order_id, 180);
        let session: JsonRecord | null = null;

        if (providerOrderId && !TERMINAL_STATES.has(state)) {
          try {
            credentials ??= await getMpCredentials(admin, orgId);
            if (credentials) {
              const order = await fetchMercadoPagoOrder(credentials.accessToken, providerOrderId);
              session = await reconcileMercadoPagoPosQrOrder(
                admin, credentials.accessToken, sessionId, order,
              );
            }
          } catch (recoveryError) {
            // La sesión no desaparece si Mercado Pago está transitoriamente
            // caído: Caja la muestra y permite reintentar sin duplicar cobro.
            console.error(`mercadopago-pos-qr recover session ${sessionId}:`, recoveryError);
          }
        }
        session ??= await readAdminSession(admin, sessionId);
        if (session && (
          session.state === "completed"
          || !TERMINAL_STATES.has(String(session.state))
        )) sessions.push(session);
      }

      return json({ ok: true, sessions });
    }

    if (action === "acknowledge") {
      const sessionId = cleanText(body.sessionId, 80);
      if (!sessionId || !UUID_RE.test(sessionId)) return json({ error: "Sesión QR inválida" }, 400);
      const session = await readVisibleSession(userClient, sessionId);
      if (!session) return json({ error: "Sesión QR inexistente" }, 404);
      const orgId = String(session.org_id);
      if (!await permission(userClient, orgId, "sales", "create")) {
        return json({ error: "No tenés permiso para reconocer este cobro" }, 403);
      }
      if (session.state !== "completed") {
        return json({ error: "Sólo se puede reconocer una venta QR completada" }, 409);
      }
      const { error } = await admin
        .from("pos_qr_sessions")
        .update({ cashier_acknowledged_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("org_id", orgId)
        .is("cashier_acknowledged_at", null);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "status" || action === "cancel" || action === "resume") {
      const sessionId = cleanText(body.sessionId, 80);
      if (!sessionId || !UUID_RE.test(sessionId)) return json({ error: "Sesión QR inválida" }, 400);
      const session = await readVisibleSession(userClient, sessionId);
      if (!session) return json({ error: "Sesión QR inexistente" }, 404);
      const orgId = String(session.org_id);
      if (!await permission(userClient, orgId, "sales", "create")) {
        return json({ error: "No tenés permiso para operar este cobro" }, 403);
      }
      const providerOrderId = cleanText(session.provider_order_id, 180);
      if (TERMINAL_STATES.has(String(session.state))) {
        return json({ ok: session.state === "completed", session });
      }

      if (!providerOrderId && action === "cancel") {
        const { data: cancelled, error: cancelError } = await admin.rpc("pos_qr_cancel_uncreated", {
          p_session_id: sessionId,
        });
        if (cancelError) throw cancelError;
        return json({ ok: true, session: asRecord(cancelled) });
      }

      const credentials = await getMpCredentials(admin, orgId);
      if (!credentials) return json({ error: "Mercado Pago ya no está conectado", code: "MP_NOT_CONNECTED" }, 422);

      if (!providerOrderId && action === "resume") {
        const { data: connectionData, error: connectionError } = await admin
          .from("payment_connections")
          .select("mp_external_pos_id,mp_pos_status")
          .eq("org_id", orgId)
          .eq("provider", "mercadopago")
          .maybeSingle();
        if (connectionError) throw connectionError;
        const connection = asRecord(connectionData);
        const externalPosId = cleanText(connection.mp_external_pos_id, 40);
        if (!externalPosId || connection.mp_pos_status !== "active") {
          return json({ error: "La caja de Mercado Pago ya no está activa", code: "POS_SETUP_REQUIRED" }, 422);
        }
        return await createOrder(admin, credentials.accessToken, externalPosId, session);
      }

      if (!providerOrderId) {
        return json({ ok: false, session });
      }

      let order: JsonRecord;
      if (action === "cancel") {
        const cancel = await mpJson(
          `${MP_API}/v1/orders/${encodeURIComponent(providerOrderId)}/cancel`,
          credentials.accessToken,
          { method: "POST", headers: { "X-Idempotency-Key": sessionId } },
        );
        if (!cancel.response.ok) {
          console.warn("mercadopago-pos-qr cancel:", cancel.response.status, cancel.payload);
          order = await fetchMercadoPagoOrder(credentials.accessToken, providerOrderId);
        } else {
          order = cancel.payload;
        }
      } else {
        order = await fetchMercadoPagoOrder(credentials.accessToken, providerOrderId);
      }
      const reconciled = await reconcileMercadoPagoPosQrOrder(
        admin, credentials.accessToken, sessionId, order,
      );
      return json({ ok: reconciled.state === "completed", session: reconciled });
    }

    return json({ error: "Acción no soportada" }, 400);
  } catch (error) {
    if (error instanceof MercadoPagoOrderError) {
      console.error("mercadopago-pos-qr order:", error.status, error.payload);
      return json({ error: "No se pudo consultar el estado del QR", retryable: true }, 502);
    }
    console.error("mercadopago-pos-qr:", error);
    return json({ error: "No se pudo operar el cobro QR" }, 500);
  }
});
