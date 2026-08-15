/**
 * store-order-status-email — avisa que una orden ya salió o fue entregada.
 *
 * No es pública: a diferencia de la confirmación inicial, sólo personal de la
 * organización puede cambiar el estado. `requireUser` es esencial porque
 * RESEND_API_KEY representa crédito real y la anon key del storefront es
 * pública. La idempotencia vive en `store_order_status_email_log`: un doble
 * click, una recarga o un reintento no llena la casilla del comprador.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { requireUser } from "../_shared/requireUser.ts";
import { parseSmtpConfig, sendEmail } from "../_shared/smtpSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

type Event = "shipped" | "delivered";

function emailHtml(opts: {
  accent: string;
  storeName: string;
  orderNumber: string;
  event: Event;
  carrier?: string | null;
  tracking?: string | null;
  orderUrl?: string;
}) {
  const shipped = opts.event === "shipped";
  const title = shipped ? "Tu pedido ya está en camino" : "¡Tu pedido fue entregado!";
  const intro = shipped
    ? "Ya entregamos tu compra al transporte. Podés seguir su estado desde tu pedido."
    : "Tu compra figura como entregada. Si necesitás ayuda, escribinos y lo resolvemos.";
  const tracking = opts.tracking
    ? `<p style="margin:14px 0 0;font-size:14px;color:#555"><strong>Seguimiento:</strong> ${esc(opts.tracking)}${opts.carrier ? ` · ${esc(opts.carrier)}` : ""}</p>`
    : "";
  const cta = opts.orderUrl ? `<p style="text-align:center;margin:24px 0"><a href="${esc(opts.orderUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${esc(opts.accent)};color:#fff;font-weight:600;text-decoration:none;font-size:14px">Ver mi pedido</a></p>` : "";

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="font-size:20px;font-weight:700;text-align:center;margin:0 0 24px">${esc(opts.storeName)}</p>
  <h1 style="font-size:22px;margin:0 0 8px">${esc(title)}</h1>
  <p style="color:#555;line-height:1.5;margin:0">${esc(intro)}</p>
  <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-top:20px">
    <p style="margin:0;font-weight:600">Pedido ${esc(opts.orderNumber)}</p>
    ${tracking}
  </div>
  ${cta}
  <p style="color:#888;font-size:12px;text-align:center;line-height:1.5;margin:0">Aviso automático de ${esc(opts.storeName)}.</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth.response) return auth.response;

    const body = await req.json().catch(() => ({}));
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const event = body.event === "shipped" || body.event === "delivered" ? body.event as Event : null;
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.replace(/\/+$/, "") : "";
    if (!orderId || !event) return json({ error: "Faltan la orden o el evento de envío" }, 400);

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: order, error: orderError } = await admin
      .from("ecommerce_orders")
      .select("id, org_id, store_id, order_number, customer_email, fulfillment_status, tracking_number")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) return json({ error: "Orden no encontrada" }, 404);

    if (order.fulfillment_status !== event) {
      return json({ error: "La orden no está en el estado que se quiere avisar" }, 409);
    }

    // La matriz fina decide si puede operar ecommerce. No se reemplaza por una
    // lista de roles: `vendedor` puede despachar cuando la organización le dio
    // ese permiso, y un admin al que se le revocó el módulo no lo saltea.
    const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: canEdit } = await userClient.rpc("has_permission", {
      p_org_id: order.org_id,
      p_module: "ecommerce",
      p_action: "edit",
    });
    if (!canEdit) return json({ error: "No tenés permiso para avisar sobre esta orden" }, 403);

    const { data: existing } = await admin
      .from("store_order_status_email_log")
      .select("id, status, attempt_count")
      .eq("ecommerce_order_id", order.id)
      .eq("event", event)
      .maybeSingle();
    if (existing?.status === "sent") return json({ ok: true, duplicate: true });

    const attempts = Number(existing?.attempt_count ?? 0) + 1;
    const logPayload = {
      ecommerce_order_id: order.id,
      event,
      recipient_email: order.customer_email,
      status: "pending",
      attempt_count: attempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { error: logError } = existing
      ? await admin.from("store_order_status_email_log").update(logPayload).eq("id", existing.id)
      : await admin.from("store_order_status_email_log").insert(logPayload);
    if (logError) {
      console.error("store-order-status-email log:", logError.message);
      return json({ error: "No se pudo registrar el aviso" }, 500);
    }

    const [{ data: store }, { data: settings }, { data: delivery }] = await Promise.all([
      admin.from("ecommerce_stores").select("name, slug, primary_color").eq("id", order.store_id).maybeSingle(),
      admin.from("settings").select("smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_name, smtp_from_email, from_email").eq("org_id", order.org_id).maybeSingle(),
      admin.from("deliveries").select("carrier, external_tracking").eq("ecommerce_order_id", order.id).order("created_at").limit(1).maybeSingle(),
    ]);
    if (!store) return json({ error: "Tienda no encontrada" }, 404);

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const smtp = parseSmtpConfig(settings as Record<string, unknown> | null);
    const fromEmail = (settings as Record<string, unknown> | null)?.from_email
      || (settings as Record<string, unknown> | null)?.smtp_from_email
      || (settings as Record<string, unknown> | null)?.smtp_user
      || Deno.env.get("FROM_EMAIL")
      || "pedidos@resend.dev";
    const result = await sendEmail(smtp, resendKey, `${store.name} <${fromEmail}>`, {
      to: order.customer_email,
      subject: `${event === "shipped" ? "Tu pedido está en camino" : "Tu pedido fue entregado"} — ${order.order_number}`,
      html: emailHtml({
        accent: store.primary_color || "#111111",
        storeName: store.name,
        orderNumber: order.order_number,
        event,
        carrier: delivery?.carrier,
        tracking: delivery?.external_tracking || order.tracking_number,
        orderUrl: baseUrl ? `${baseUrl}/tienda/${store.slug}/orden/${order.order_number}` : undefined,
      }),
    });

    const saved = result.ok
      ? { status: "sent", provider: result.provider, last_error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: "failed", provider: result.provider, last_error: result.error ?? "No se pudo enviar el email", updated_at: new Date().toISOString() };
    await admin.from("store_order_status_email_log")
      .update(saved)
      .eq("ecommerce_order_id", order.id)
      .eq("event", event);

    if (!result.ok) return json({ error: result.error ?? "No se pudo enviar el aviso" }, 502);
    return json({ ok: true, provider: result.provider });
  } catch (error) {
    console.error("store-order-status-email:", error);
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});
