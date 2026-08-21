/**
 * meli-webhook — recibe notificaciones de órdenes de MercadoLibre.
 *
 * El POST sólo es una señal y jamás alimenta una venta directamente. La
 * notificación se encola, responde 200 y la tarea de fondo vuelve a consultar
 * GET /orders/{id} con el OAuth del vendedor. Recién esa respuesta oficial se
 * guarda en `meli_orders`; importar al Business Core sigue siendo el RPC
 * explícito, atómico e idempotente de meli-sync.
 *
 * MercadoLibre no manda una sesión de Supabase, por eso esta función se
 * despliega sin verify_jwt. La autoridad viene de que el recurso consultado
 * debe pertenecer al `meli_user_id` conectado, no del body público.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

// Disponible en Supabase Edge Runtime; Deno local no lo declara por defecto.
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const API = "https://api.mercadolibre.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

interface Connection {
  org_id: string;
  meli_user_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  site_id: string;
}

interface QueuedEvent {
  id: string;
  org_id: string;
  meli_user_id: number;
  resource: string;
}

const meli = (token: string, path: string, init: RequestInit = {}) => fetch(`${API}${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  },
});

function orderIdFromResource(resource: unknown): string | null {
  if (typeof resource !== "string") return null;
  const match = resource.match(/^\/orders\/(\d+)$/);
  return match?.[1] ?? null;
}

function asPositiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function notificationId(payload: Record<string, unknown>, topic: string, resource: string, meliUserId: number) {
  const externalId = payload._id ?? payload.id;
  if (typeof externalId === "string" && externalId.length > 0 && externalId.length <= 200) {
    return externalId;
  }
  // Algunas variantes históricas del callback no incluyen `_id`. La clave
  // derivada conserva idempotencia sin guardar el body crudo ni PII.
  return `derived:${await sha256([topic, resource, String(meliUserId), String(payload.sent ?? "")].join("\n"))}`;
}

async function getToken(admin: any, orgId: string): Promise<Connection> {
  const { data: conn, error } = await admin
    .from("meli_connections")
    .select("org_id, meli_user_id, access_token, refresh_token, expires_at, site_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn?.access_token || !conn?.refresh_token || !conn?.meli_user_id) {
    throw new Error("La organización ya no tiene una conexión MercadoLibre válida");
  }

  const msLeft = new Date(conn.expires_at).getTime() - Date.now();
  if (msLeft > 10 * 60 * 1000) return conn as Connection;

  const refresh = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requireEnv("MELI_CLIENT_ID"),
      client_secret: requireEnv("MELI_CLIENT_SECRET"),
      refresh_token: conn.refresh_token,
    }),
  });
  const refreshed = await refresh.json().catch(() => null);
  if (!refresh.ok || !refreshed?.access_token) {
    throw new Error("No se pudo renovar el token de MercadoLibre");
  }

  const updated = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (refreshed.expires_in ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await admin.from("meli_connections").update(updated).eq("org_id", orgId);
  if (updateError) throw new Error(updateError.message);
  return { ...conn, ...updated } as Connection;
}

function sellerShippingCost(costs: any, sellerId: number): number {
  const senders = Array.isArray(costs?.senders) ? costs.senders : [];
  const sender = senders.find((entry: any) => String(entry?.user_id) === String(sellerId));
  const cost = Number(sender?.cost);
  if (!sender || !Number.isFinite(cost) || cost < 0) {
    throw new Error("MercadoLibre no informó un costo de envío válido para el vendedor");
  }
  return cost;
}

function orderRow(orgId: string, order: any) {
  return {
    org_id: orgId,
    meli_order_id: order.id,
    status: order.status ?? null,
    buyer_nickname: order.buyer?.nickname ?? null,
    total_ars: order.total_amount ?? null,
    items: (order.order_items ?? []).map((item: any) => ({
      title: item.item?.title,
      item_id: item.item?.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      sale_fee: item.sale_fee ?? null,
    })),
    shipment_id: order.shipping?.id != null ? String(order.shipping.id) : null,
    shipping_cost_currency: typeof order.currency_id === "string" ? order.currency_id : null,
    date_created: order.date_created ?? null,
    raw: order,
  };
}

async function markEvent(admin: any, eventId: string, values: Record<string, unknown>) {
  const { error } = await admin.from("meli_webhook_events").update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq("id", eventId);
  if (error) throw new Error(`No se pudo registrar el estado del webhook: ${error.message}`);
}

async function processEvent(admin: any, eventId: string) {
  const { data: event, error: claimError } = await admin
    .from("meli_webhook_events")
    .update({ status: "processing", processing_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "queued")
    .select("id, org_id, meli_user_id, resource")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!event) return; // otro intento sano ya tomó o terminó esta misma señal

  try {
    const queued = event as QueuedEvent;
    const orderId = orderIdFromResource(queued.resource);
    if (!orderId) throw new Error("El recurso encolado no es una orden válida");

    const connection = await getToken(admin, queued.org_id);
    if (Number(connection.meli_user_id) !== Number(queued.meli_user_id)) {
      throw new Error("La cuenta MercadoLibre conectada cambió antes de procesar la notificación");
    }

    const response = await meli(connection.access_token, `/orders/${encodeURIComponent(orderId)}`);
    const order = await response.json().catch(() => null);
    if (!response.ok || !order?.id) {
      throw new Error(order?.message ?? `MercadoLibre no devolvió la orden (${response.status})`);
    }
    if (String(order.id) !== orderId || String(order.seller?.id) !== String(connection.meli_user_id)) {
      throw new Error("La orden oficial no pertenece al vendedor conectado");
    }

    const { error: upsertError } = await admin.from("meli_orders").upsert(orderRow(queued.org_id, order), {
      onConflict: "org_id,meli_order_id",
    });
    if (upsertError) throw new Error(upsertError.message);

    // Si ML ya tiene el shipment, la misma notificación deja listo también el
    // costo que absorbe el vendedor. NULL sigue significando que ML aún no lo
    // informó; nunca se inventa un cero para completar el margen.
    const shipmentId = order.shipping?.id != null ? String(order.shipping.id) : null;
    if (String(order.status ?? "").toLowerCase() === "paid" && shipmentId) {
      const { data: storedOrder, error: storedOrderError } = await admin
        .from("meli_orders")
        .select("id, seller_shipping_cost_ars")
        .eq("org_id", queued.org_id)
        .eq("meli_order_id", order.id)
        .maybeSingle();
      if (storedOrderError) throw new Error(storedOrderError.message);

      if (storedOrder && storedOrder.seller_shipping_cost_ars === null) {
        try {
          const shippingResponse = await meli(
            connection.access_token,
            `/shipments/${encodeURIComponent(shipmentId)}/costs`,
            { headers: { "x-format-new": "true" } },
          );
          const shipping = await shippingResponse.json().catch(() => null);
          if (!shippingResponse.ok) throw new Error(shipping?.message ?? `HTTP ${shippingResponse.status}`);

          const { error: shippingError } = await admin.rpc("apply_meli_shipping_cost", {
            p_org_id: queued.org_id,
            p_meli_order_id: storedOrder.id,
            p_seller_shipping_cost_ars: sellerShippingCost(shipping, Number(connection.meli_user_id)),
          });
          if (shippingError) throw new Error(shippingError.message);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error desconocido al consultar el envío";
          const { error: saveError } = await admin.from("meli_orders")
            .update({ shipping_cost_error: message.slice(0, 500) })
            .eq("id", storedOrder.id);
          if (saveError) throw new Error(`${message}; tampoco se pudo registrar: ${saveError.message}`);
        }
      }
    }

    await markEvent(admin, queued.id, {
      status: "processed",
      processed_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al procesar MercadoLibre";
    console.error("meli-webhook:", message);
    await markEvent(admin, eventId, { status: "failed", last_error: message.slice(0, 500) });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const payload = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "Notificación inválida" }, 400);
    }

    const notification = payload as Record<string, unknown>;
    const topic = typeof notification.topic === "string" ? notification.topic : "";
    // La aplicación puede estar suscripta a otros temas. Ignorarlos con 200
    // evita reintentos inútiles y reduce la superficie a las órdenes.
    if (topic !== "orders") return json({ ok: true, ignored: true });

    const resource = typeof notification.resource === "string" ? notification.resource : "";
    const orderId = orderIdFromResource(resource);
    const meliUserId = asPositiveInteger(notification.user_id);
    if (!orderId || !meliUserId) return json({ error: "Notificación de orden inválida" }, 400);

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: connections, error: connectionError } = await admin
      .from("meli_connections")
      .select("org_id")
      .eq("meli_user_id", meliUserId)
      .limit(2);
    if (connectionError) throw new Error(connectionError.message);
    if ((connections ?? []).length !== 1) {
      // Una desconexión posterior o una cuenta aún no vinculada no debe causar
      // reintentos eternos ni revelar qué vendedores usan la plataforma.
      return json({ ok: true, ignored: true });
    }

    const sentAt = typeof notification.sent === "string" && !Number.isNaN(Date.parse(notification.sent))
      ? new Date(notification.sent).toISOString()
      : null;
    const { data: eventId, error: enqueueError } = await admin.rpc("enqueue_meli_webhook_event", {
      p_org_id: connections![0].org_id,
      p_meli_user_id: meliUserId,
      p_notification_id: await notificationId(notification, topic, resource, meliUserId),
      p_topic: topic,
      p_resource: resource,
      p_notification_sent_at: sentAt,
    });
    if (enqueueError) throw new Error(enqueueError.message);

    if (eventId) {
      // La confirmación a ML no espera OAuth ni la API remota. waitUntil
      // mantiene el trabajo vivo y la fila deja evidencia/reintento si falla.
      EdgeRuntime.waitUntil(processEvent(admin, String(eventId)).catch(error => {
        console.error("meli-webhook: no se pudo cerrar la tarea en segundo plano", error);
      }));
    }
    return json({ ok: true, queued: Boolean(eventId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("meli-webhook:", message);
    return json({ error: "No se pudo recibir la notificación" }, 500);
  }
});
