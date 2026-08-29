/**
 * Consumidor durable de `venta.registrada`.
 *
 * Postgres crea la fila de outbox en la misma transacción que el ticket. Esta
 * función no acepta dinero ni ids elegidos por un navegador: valida el Domain
 * Event, resuelve la suscripción server-managed y vuelve a leer las líneas.
 * Devuelve 2xx sólo cuando la entrega terminó o el endpoint fue desactivado;
 * cualquier fallo recuperable vuelve a la outbox con su backoff canónico.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { exigirCron } from "../_shared/cronAuth.ts";
import { deliverOutboundEvent } from "../_shared/outboundWebhook.ts";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type OutboxPayload = {
  event_id?: string;
  subscription_id?: string;
  event_type?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  org_id?: string;
};

type SubscriptionConfig = { webhook_id?: unknown } | null;

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Método no permitido" }, 405);

  const gate = exigirCron(req, jsonHeaders);
  if (gate) return gate;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return response({ error: "Servicio no configurado" }, 503);
  }

  const payload = await req.json().catch(() => null) as OutboxPayload | null;
  const eventId = typeof payload?.event_id === "string" ? payload.event_id : "";
  const subscriptionId = typeof payload?.subscription_id === "string"
    ? payload.subscription_id
    : "";
  const orgId = typeof payload?.org_id === "string" ? payload.org_id : "";
  const transactionId = typeof payload?.aggregate_id === "string"
    ? payload.aggregate_id
    : "";

  if (
    !UUID.test(eventId) || !UUID.test(subscriptionId) || !UUID.test(orgId) ||
    !UUID.test(transactionId) || payload?.event_type !== "venta.registrada" ||
    payload?.aggregate_type !== "venta"
  ) {
    return response({ error: "Evento durable inválido" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: domainEvent, error: eventError } = await admin
      .from("domain_events")
      .select("id, org_id, aggregate_type, aggregate_id, event_type, occurred_at")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) throw eventError;
    if (
      !domainEvent || domainEvent.org_id !== orgId ||
      domainEvent.aggregate_type !== "venta" ||
      domainEvent.aggregate_id !== transactionId ||
      domainEvent.event_type !== "venta.registrada"
    ) {
      return response({ error: "El evento no coincide con la historia durable" }, 409);
    }

    const { data: subscription, error: subscriptionError } = await admin
      .from("event_subscriptions")
      .select("id, org_id, destino, objetivo, config, is_active")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!subscription) return response({ skipped: true, reason: "subscription_removed" });
    if (
      subscription.org_id !== orgId || subscription.destino !== "edge_function" ||
      subscription.objetivo !== "dispatch-outbound-webhook"
    ) {
      return response({ error: "La suscripción no corresponde al dispatcher" }, 409);
    }
    if (!subscription.is_active) {
      return response({ skipped: true, reason: "subscription_inactive" });
    }

    const config = subscription.config as SubscriptionConfig;
    const webhookId = typeof config?.webhook_id === "string" ? config.webhook_id : "";
    if (!UUID.test(webhookId)) {
      return response({ error: "La suscripción no referencia un endpoint válido" }, 409);
    }

    // Las líneas se leen después del commit. El trigger emite al crear el padre,
    // cuando todavía no existen; una cola sin líneas es un estado recuperable y
    // no debe convertirse en un webhook vacío marcado como entregado.
    const { data: sales, error: salesError } = await admin
      .from("sales")
      .select(
        "id, sale_transaction_id, product_id, product_name, quantity, unit_price_ars, total_ars, customer_id, customer_name, date, paid, payment_method, source, seller_name",
      )
      .eq("org_id", orgId)
      .eq("sale_transaction_id", transactionId)
      .order("date", { ascending: true });
    if (salesError) throw salesError;
    if (!sales?.length) {
      return response({ error: "La venta todavía no tiene renglones confirmados" }, 409);
    }

    const results = await deliverOutboundEvent(admin, {
      orgId,
      webhookId,
      eventId,
      attemptsAllowed: 1,
      event: "sale.created",
      data: {
        transaction_id: transactionId,
        occurred_at: domainEvent.occurred_at,
        lines: sales,
        total_ars: sales.reduce(
          (sum: number, sale: { total_ars?: number | string | null }) =>
            sum + Number(sale.total_ars || 0),
          0,
        ),
      },
    });

    // La configuración pudo desactivarse o borrarse después de encolar. Eso es
    // una decisión del comercio, no un incidente para reintentar.
    if (!results.length) return response({ skipped: true, reason: "endpoint_inactive" });

    const delivered = results.every((result) => result.delivered);
    return response(
      { event_id: eventId, delivered, results },
      delivered ? 200 : 502,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("dispatch-outbound-webhook:", detail);
    return response({ error: "No se pudo despachar el webhook" }, 500);
  }
});
