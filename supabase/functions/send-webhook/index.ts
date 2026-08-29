/**
 * Puerta autenticada para entregar webhooks salientes.
 *
 * El navegador nunca recibe el secret ni llama al endpoint del comercio. Para
 * `sale.created` sólo manda ids: precios, cantidades y cliente se vuelven a
 * leer de la base antes de firmar. Pruebas y reintentos requieren owner/admin.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { deliverOutboundEvent } from "../_shared/outboundWebhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type Body = {
  action?: "dispatch" | "test" | "retry";
  orgId?: string;
  event?: "sale.created";
  saleIds?: string[];
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
  const action = body?.action || "dispatch";
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (!UUID.test(orgId) || !["dispatch", "test", "retry"].includes(action)) {
    return response({ error: "Organización y acción válidas son obligatorias" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !serviceRole || !anonKey) return response({ error: "Servicio no configurado" }, 503);

  const admin = createClient(supabaseUrl, serviceRole);
  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
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
          message: "Prueba firmada desde Gestiona",
          requested_by: auth.user.email,
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

      const previousPayload = previous.payload as { data?: unknown } | null;
      const results = await deliverOutboundEvent(admin, {
        orgId,
        webhookId: previous.webhook_id,
        includeInactive: true,
        event: previous.event,
        data: previousPayload?.data ?? {},
      });
      return response({ delivered: results.every((result) => result.delivered), results });
    }

    if (body?.event !== "sale.created") {
      return response({ error: "El navegador sólo puede emitir ventas confirmadas" }, 400);
    }
    const { data: canCreate, error: permissionError } = await authed.rpc("has_permission", {
      p_org_id: orgId,
      p_module: "pos",
      p_action: "create",
    });
    if (permissionError) {
      console.error("send-webhook permission:", permissionError);
      return response({ error: "No se pudo verificar el permiso de venta" }, 500);
    }
    if (!canCreate) return response({ error: "No tenés permiso para emitir eventos de venta" }, 403);

    const saleIds = [...new Set(Array.isArray(body.saleIds) ? body.saleIds : [])]
      .filter((id): id is string => typeof id === "string" && UUID.test(id))
      .slice(0, 50);
    if (!saleIds.length) return response({ error: "Faltan las ventas confirmadas" }, 400);

    // No se acepta dinero ni datos personales desde el request. El servidor
    // vuelve a leer sólo las columnas comerciales que el receptor necesita.
    const { data: sales, error: salesError } = await admin
      .from("sales")
      .select("id, sale_transaction_id, product_id, product_name, quantity, unit_price_ars, total_ars, customer_id, customer_name, date, paid, payment_method, source, seller_name")
      .eq("org_id", orgId)
      .in("id", saleIds);
    if (salesError) throw salesError;
    if (!sales?.length || sales.length !== saleIds.length) {
      return response({ error: "Una o más ventas no existen en la organización" }, 404);
    }

    const results = await deliverOutboundEvent(admin, {
      orgId,
      event: "sale.created",
      data: {
        transaction_id: sales[0].sale_transaction_id,
        lines: sales,
        total_ars: sales.reduce((sum, sale) => sum + Number(sale.total_ars || 0), 0),
      },
    });
    return response({
      skipped: results.length === 0,
      delivered: results.length > 0 && results.every((result) => result.delivered),
      results,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("send-webhook:", detail);
    return response({ error: "No se pudo procesar el webhook" }, 500);
  }
});
