/**
 * Puerta autenticada para probar y reintentar webhooks salientes.
 *
 * El navegador nunca recibe el secret ni llama al endpoint del comercio. Las
 * ventas salen exclusivamente por la outbox transaccional; permitir además un
 * dispatch manual duplicaría eventos. Pruebas y reintentos requieren owner/admin.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { deliverOutboundEvent } from "../_shared/outboundWebhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type Body = {
  action?: "test" | "retry";
  orgId?: string;
  webhookId?: string;
  deliveryId?: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método no permitido" }, 405);
  if (checkRateLimit(req, "send-webhook", { max: 30, windowMs: 60_000 })) return rateLimitResponse();

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null) as Body | null;
  const action = body?.action;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (!UUID.test(orgId) || !action || !["test", "retry"].includes(action)) {
    return response({ error: "Organización y acción válidas son obligatorias" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return response({ error: "Servicio no configurado" }, 503);

  const admin = createClient(supabaseUrl, serviceRole);
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("send-webhook membership:", membershipError);
    return response({ error: "No se pudo verificar el permiso" }, 500);
  }
  if (!membership) return response({ error: "No pertenecés a esta organización" }, 403);

  try {
    if (action === "test") {
      if (!["owner", "admin"].includes(membership.role)) {
        return response({ error: "Sólo dueños o administradores pueden probar endpoints" }, 403);
      }
      const webhookId = typeof body?.webhookId === "string" ? body.webhookId : "";
      if (!UUID.test(webhookId)) return response({ error: "Webhook inválido" }, 400);

      const results = await deliverOutboundEvent(admin, {
        orgId,
        webhookId,
        includeInactive: true,
        event: "test.ping",
        data: {
          message: "Prueba firmada desde Nerqia",
        },
      });
      if (!results.length) return response({ error: "Webhook inexistente" }, 404);
      return response({ delivered: results[0].delivered, results });
    }

    if (action === "retry") {
      if (!["owner", "admin"].includes(membership.role)) {
        return response({ error: "Sólo dueños o administradores pueden reintentar entregas" }, 403);
      }
      const deliveryId = typeof body?.deliveryId === "string" ? body.deliveryId : "";
      if (!UUID.test(deliveryId)) return response({ error: "Entrega inválida" }, 400);

      const { data: previous, error } = await admin
        .from("webhook_deliveries")
        .select("webhook_id, event, payload")
        .eq("id", deliveryId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!previous?.webhook_id) return response({ error: "La entrega no tiene un endpoint recuperable" }, 409);
      if (!["sale.created", "automation.triggered", "test.ping"].includes(previous.event)) {
        return response({ error: "El evento legado no admite reintento" }, 409);
      }

      const previousPayload = previous.payload as { id?: unknown; data?: unknown } | null;
      const previousEventId = typeof previousPayload?.id === "string" && UUID.test(previousPayload.id)
        ? previousPayload.id
        : undefined;
      const results = await deliverOutboundEvent(admin, {
        orgId,
        webhookId: previous.webhook_id,
        includeInactive: true,
        eventId: previousEventId,
        event: previous.event,
        data: previousPayload?.data ?? {},
      });
      if (!results.length) return response({ error: "Webhook inexistente" }, 404);
      return response({ delivered: results.every((result) => result.delivered), results });
    }

    return response({ error: "Acción no soportada" }, 400);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("send-webhook:", detail);
    return response({ error: "No se pudo procesar el webhook" }, 500);
  }
});
