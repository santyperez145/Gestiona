/**
 * store-order-status-email — avisa al comprador sobre un cambio de estado.
 *
 * Eventos:
 *   - payment_confirmed: cobro manual (transferencia/efectivo) acreditado
 *   - shipped / delivered: despacho o entrega
 *
 * No es pública: `requireUser` + permiso ecommerce.edit. La idempotencia vive
 * en claim SQL atómico. MP ya dispara payment_confirmed vía store-order-email;
 * sin este camino el checkout prometía «te avisamos» y Marcar cobrado no
 * mandaba nada (ATM / transferencia).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { requireUser } from "../_shared/requireUser.ts";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import {
  claimStoreOrderEmail,
  finishStoreOrderEmail,
  type StoreOrderEmailEvent,
} from "../_shared/storeOrderEmailDelivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

type StatusEvent = Extract<StoreOrderEmailEvent, "payment_confirmed" | "shipped" | "delivered">;

/** Espejo de `esPedidoRetiro` / `copyEstadoPedido` en storeOrderBuyerCopy.ts. */
function esPedidoRetiro(order: { carrier?: unknown; shipping_service?: unknown }) {
  const carrier = String(order?.carrier ?? "").toLowerCase().trim();
  const service = String(order?.shipping_service ?? "").toLowerCase().trim();
  return carrier === "retiro" || service === "sucursal";
}

function copyEstadoPedido(event: StatusEvent, esRetiro: boolean) {
  if (event === "payment_confirmed") {
    return {
      subject: "Pago confirmado",
      title: "¡Pago confirmado!",
      intro: "Ya acreditamos tu pago. Seguimos con la preparación de tu pedido.",
    };
  }
  if (esRetiro) {
    if (event === "delivered") {
      return {
        subject: "Tu pedido fue retirado",
        title: "¡Pedido retirado!",
        intro: "Registramos que retiraste tu compra. Si necesitás ayuda, escribinos.",
      };
    }
    return {
      subject: "Tu pedido está listo para retirar",
      title: "Tu pedido está listo para retirar",
      intro: "Ya podés pasar a buscarlo. Si necesitás ayuda, escribinos.",
    };
  }
  if (event === "shipped") {
    return {
      subject: "Tu pedido está en camino",
      title: "Tu pedido ya está en camino",
      intro: "Ya entregamos tu compra al transporte. Podés seguir su estado desde tu pedido.",
    };
  }
  return {
    subject: "Tu pedido fue entregado",
    title: "¡Tu pedido fue entregado!",
    intro: "Tu compra figura como entregada. Si necesitás ayuda, escribinos y lo resolvemos.",
  };
}

function emailHtml(opts: {
  accent: string;
  storeName: string;
  orderNumber: string;
  event: StatusEvent;
  esRetiro: boolean;
  carrier?: string | null;
  tracking?: string | null;
  orderUrl?: string;
}) {
  const copy = copyEstadoPedido(opts.event, opts.esRetiro);
  const tracking = opts.tracking
    ? `<p style="margin:14px 0 0;font-size:14px;color:#555"><strong>Seguimiento:</strong> ${esc(opts.tracking)}${opts.carrier ? ` · ${esc(opts.carrier)}` : ""}</p>`
    : "";
  const cta = opts.orderUrl ? `<p style="text-align:center;margin:24px 0"><a href="${esc(opts.orderUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${esc(opts.accent)};color:#fff;font-weight:600;text-decoration:none;font-size:14px">Ver mi pedido</a></p>` : "";

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="font-size:20px;font-weight:700;text-align:center;margin:0 0 24px">${esc(opts.storeName)}</p>
  <h1 style="font-size:22px;margin:0 0 8px">${esc(copy.title)}</h1>
  <p style="color:#555;line-height:1.5;margin:0">${esc(copy.intro)}</p>
  <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-top:20px">
    <p style="margin:0;font-weight:600">Pedido ${esc(opts.orderNumber)}</p>
    ${tracking}
  </div>
  ${cta}
  <p style="color:#888;font-size:12px;text-align:center;line-height:1.5;margin:0">Aviso automático de ${esc(opts.storeName)}.</p>
</div>`;
}

function parseEvent(raw: unknown): StatusEvent | null {
  if (raw === "payment_confirmed" || raw === "shipped" || raw === "delivered") {
    return raw;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth.response) return auth.response;

    const body = await req.json().catch(() => ({}));
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const event = parseEvent(body.event);
    const baseUrl = String(Deno.env.get("PUBLIC_BASE_URL") ?? "").replace(/\/+$/, "");
    if (!orderId || !event) return json({ error: "Faltan la orden o el evento" }, 400);

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: order, error: orderError } = await admin
      .from("ecommerce_orders")
      .select("id, org_id, store_id, order_number, customer_email, payment_status, fulfillment_status, tracking_number, public_access_token, carrier, shipping_service")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) return json({ error: "Orden no encontrada" }, 404);

    if (event === "payment_confirmed") {
      if (order.payment_status !== "paid") {
        return json({ error: "La orden todavía no figura como pagada" }, 409);
      }
    } else if (order.fulfillment_status !== event) {
      return json({ error: "La orden no está en el estado que se quiere avisar" }, 409);
    }

    const retiro = esPedidoRetiro(order);
    const copy = copyEstadoPedido(event, retiro);

    const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: canEdit } = await userClient.rpc("has_permission", {
      p_org_id: order.org_id,
      p_module: "ecommerce",
      p_action: "edit",
    });
    if (!canEdit) return json({ error: "No tenés permiso para avisar sobre esta orden" }, 403);

    const [{ data: store }, { data: delivery }] = await Promise.all([
      admin.from("ecommerce_stores").select("name, slug, primary_color").eq("id", order.store_id).maybeSingle(),
      event === "payment_confirmed"
        ? Promise.resolve({ data: null })
        : admin.from("deliveries").select("carrier, external_tracking").eq("ecommerce_order_id", order.id).order("created_at").limit(1).maybeSingle(),
    ]);
    if (!store) return json({ error: "Tienda no encontrada" }, 404);

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const smtp = await smtpDeOrganizacion(order.org_id);
    const resendFrom = (await remitenteDe("pedidos")).from;
    const claim = await claimStoreOrderEmail(admin, {
      orderId: order.id,
      audience: "buyer",
      event,
      recipientEmail: order.customer_email,
    });
    if (!claim.claimed) {
      return json({
        ok: true,
        duplicate: claim.duplicate,
        inProgress: claim.inProgress,
      });
    }

    const result = await sendEmail(smtp, resendKey, resendFrom, {
      to: order.customer_email,
      subject: `${copy.subject} — ${order.order_number}`,
      html: emailHtml({
        accent: store.primary_color || "#111111",
        storeName: store.name,
        orderNumber: order.order_number,
        event,
        esRetiro: retiro,
        carrier: delivery?.carrier,
        tracking: delivery?.external_tracking || order.tracking_number,
        orderUrl: baseUrl
          ? `${baseUrl}/tienda/${store.slug}/orden/${order.order_number}#access=${encodeURIComponent(order.public_access_token)}`
          : undefined,
      }),
    }, {
      order_id: order.id,
      audience: "buyer",
      event,
    }, { idempotencyKey: claim.idempotencyKey });
    await finishStoreOrderEmail(admin, claim, result);

    if (!result.ok) return json({ error: result.error ?? "No se pudo enviar el aviso" }, 502);
    return json({ ok: true, provider: result.provider });
  } catch (error) {
    console.error("store-order-status-email:", error);
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});
