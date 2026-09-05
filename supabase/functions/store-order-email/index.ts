/**
 * store-order-email — avisos por email de un pedido de la tienda online.
 *
 * Manda dos correos distintos:
 *   - al comprador: confirmación con el detalle y el número de pedido
 *   - al dueño: aviso de que entró una venta, con los datos de contacto
 *
 * Es pública porque la dispara el checkout de un visitante anónimo, pero exige
 * la capacidad opaca del pedido. Las llamadas internas se autentican con la
 * service role. Todo el contenido y la URL pública salen del servidor.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import { emailFailure } from "../_shared/emailErrors.ts";
import {
  claimStoreOrderEmail,
  finishStoreOrderEmail,
} from "../_shared/storeOrderEmailDelivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const money = (n: unknown) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
    .format(Number(n) || 0);

interface Item { name?: string; quantity?: number; unit_price?: number; total?: number }

/** Espejo de `esPedidoRetiro` / `storeOrderBuyerCopy.ts`. Deno no importa `@/`. */
function esPedidoRetiro(order: { carrier?: unknown; shipping_service?: unknown }) {
  const carrier = String(order?.carrier ?? "").toLowerCase().trim();
  const service = String(order?.shipping_service ?? "").toLowerCase().trim();
  return carrier === "retiro" || service === "sucursal";
}

function introPedidoPagado(esRetiro: boolean): string {
  return esRetiro
    ? "Te avisamos cuando el pedido esté listo para retirar."
    : "Ya estamos preparando tu envío. Te avisamos cuando salga.";
}

function etiquetaCostoEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro" : "Envío";
}

function etiquetaDireccionEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro en" : "Envío a";
}

function itemsHtml(items: Item[], accent: string) {
  return items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">
        <span style="color:#888">${Number(i.quantity) || 1}×</span> ${esc(i.name)}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
        ${money(i.total)}
      </td>
    </tr>`).join("");
}

function layout(opts: {
  accent: string; storeName: string; title: string; intro: string;
  order: any; itemsRows: string; footer: string; ctaUrl?: string; ctaLabel?: string;
  extraHtml?: string;
  pickupAddress?: string | null;
  pickupInstructions?: string | null;
}) {
  const retiro = esPedidoRetiro(opts.order);
  const dir = opts.order.shipping_address ?? {};
  const dirEnvio = [dir.calle, dir.ciudad, dir.provincia, dir.cp].filter(Boolean).join(", ");
  const lugar = retiro
    ? (String(opts.pickupAddress ?? "").trim() || dirEnvio)
    : dirEnvio;
  const horario = retiro ? String(opts.pickupInstructions ?? "").trim() : "";
  const costoLabel = etiquetaCostoEntrega(retiro);
  const dirLabel = etiquetaDireccionEntrega(retiro);
  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:20px;font-weight:700">${esc(opts.storeName)}</div>
  </div>

  <h1 style="font-size:22px;margin:0 0 8px">${esc(opts.title)}</h1>
  <p style="color:#555;margin:0 0 20px;line-height:1.5">${opts.intro}</p>

  <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-bottom:20px">
    <p style="margin:0 0 12px;font-weight:600;font-size:14px">Pedido ${esc(opts.order.order_number)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${opts.itemsRows}</table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <tr><td style="color:#888">Subtotal</td><td style="text-align:right">${money(opts.order.subtotal)}</td></tr>
      <tr><td style="color:#888">${esc(costoLabel)}</td><td style="text-align:right">${Number(opts.order.shipping_cost) === 0 ? "Gratis" : money(opts.order.shipping_cost)}</td></tr>
      <tr><td style="font-weight:700;padding-top:6px">Total</td><td style="text-align:right;font-weight:700;padding-top:6px">${money(opts.order.total)}</td></tr>
    </table>
    ${lugar ? `<p style="margin:14px 0 0;font-size:13px;color:#555"><strong>${esc(dirLabel)}:</strong> ${esc(lugar)}${horario ? `<br>${esc(horario)}` : ""}</p>` : ""}
  </div>

  ${opts.extraHtml ?? ""}

  ${opts.ctaUrl ? `
  <div style="text-align:center;margin-bottom:20px">
    <a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${esc(opts.accent)};color:#fff;font-weight:600;text-decoration:none;font-size:14px">${esc(opts.ctaLabel)}</a>
  </div>` : ""}

  <p style="color:#888;font-size:12px;text-align:center;line-height:1.5;margin:0">${opts.footer}</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const { slug, orderNumber, accessToken } = await req.json();
    if (!slug || !orderNumber) return json({ error: "slug y orderNumber son requeridos" }, 400);

    const { data: store } = await admin
      .from("ecommerce_stores")
      .select("id, org_id, name, slug, primary_color, is_active, notification_email, pickup_address, pickup_instructions")
      .ilike("slug", slug)
      .maybeSingle();
    if (!store?.is_active) return json({ error: "Tienda no encontrada" }, 404);

    const { data: order } = await admin
      .from("ecommerce_orders")
      .select("id, order_number, customer_name, customer_email, customer_phone, items, subtotal, shipping_cost, total, payment_method, payment_status, shipping_address, public_access_token, carrier, shipping_service")
      .eq("store_id", store.id)
      .eq("order_number", orderNumber)
      .maybeSingle();
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const internal = bearer === serviceKey;
    if (!order || (!internal && order.public_access_token !== accessToken)) {
      return json({ error: "Pedido no encontrado o acceso inválido" }, 404);
    }

    const { data: settings } = await admin
      .from("settings")
      .select("bank_cbu, bank_alias, bank_name, bank_holder")
      .eq("org_id", store.org_id)
      .maybeSingle();

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const smtpCfg = await smtpDeOrganizacion(store.org_id);
    if (!smtpCfg?.host && !resendKey) {
      // Sin proveedor configurado no es un error del pedido: la compra ya se
      // hizo. Se informa y listo, para no romper el checkout.
      console.warn("store-order-email: email provider unavailable", { orgId: store.org_id, orderId: order.id });
      return json({ ok: true, emailRequested: true, emailDelivered: false });
    }

    const resendFrom = (await remitenteDe("pedidos")).from;
    const accent = store.primary_color || "#111111";
    const base = String(Deno.env.get("PUBLIC_BASE_URL") || "").replace(/\/+$/, "");
    const orderUrl = `${base}/tienda/${store.slug}/orden/${order.order_number}#access=${encodeURIComponent(order.public_access_token)}`;
    const rows = itemsHtml((order.items ?? []) as Item[], accent);

    const bankCbu = String(settings?.bank_cbu ?? "").trim();
    const bankAlias = String(settings?.bank_alias ?? "").trim();
    const bankHolder = String(settings?.bank_holder ?? "").trim();
    const bankName = String(settings?.bank_name ?? "").trim();
    const tieneDatosTransferencia = Boolean(bankCbu || bankAlias);
    const transferenciaPendiente = order.payment_method === "transferencia"
      && order.payment_status !== "paid"
      && tieneDatosTransferencia;
    const bloqueTransferencia = transferenciaPendiente ? `
  <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-bottom:20px;background:#fafafa">
    <p style="margin:0 0 8px;font-weight:600;font-size:14px">Datos para transferir</p>
    <p style="margin:0 0 10px;font-size:13px;color:#555">Transferí exactamente ${money(order.total)}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${bankHolder ? `<tr><td style="color:#888;padding:4px 0">Titular</td><td style="text-align:right;padding:4px 0">${esc(bankHolder)}</td></tr>` : ""}
      ${bankName ? `<tr><td style="color:#888;padding:4px 0">Banco</td><td style="text-align:right;padding:4px 0">${esc(bankName)}</td></tr>` : ""}
      ${bankCbu ? `<tr><td style="color:#888;padding:4px 0">CBU</td><td style="text-align:right;padding:4px 0;font-family:ui-monospace,monospace">${esc(bankCbu)}</td></tr>` : ""}
      ${bankAlias ? `<tr><td style="color:#888;padding:4px 0">Alias</td><td style="text-align:right;padding:4px 0">${esc(bankAlias)}</td></tr>` : ""}
    </table>
  </div>` : "";

    let buyerDelivered: boolean | null = null;

    // ── Al comprador ─────────────────────────────────────────────────────
    if (order.customer_email) {
      const pagado = order.payment_status === "paid";
      const buyerEvent = pagado ? "payment_confirmed" : "order_created";
      const claim = await claimStoreOrderEmail(admin, {
        orderId: order.id,
        audience: "buyer",
        event: buyerEvent,
        recipientEmail: order.customer_email,
      });
      if (claim.claimed) {
        const introPendiente = transferenciaPendiente
          ? "Recibimos tu pedido. Transferí el total con los datos de abajo; cuando acredite te avisamos."
          : "Recibimos tu pedido. Te escribimos para coordinar el pago y la entrega.";
        const result = await sendEmail(smtpCfg, resendKey, resendFrom, {
          to: order.customer_email,
          subject: `${pagado ? "Pago confirmado" : "Recibimos tu pedido"} — ${order.order_number}`,
          html: layout({
            accent, storeName: store.name,
            title: pagado ? "¡Pago confirmado!" : "¡Gracias por tu compra!",
            intro: pagado
              ? introPedidoPagado(esPedidoRetiro(order))
              : introPendiente,
            order, itemsRows: rows,
            extraHtml: bloqueTransferencia || undefined,
            pickupAddress: store.pickup_address,
            pickupInstructions: store.pickup_instructions,
            ctaUrl: base ? orderUrl : undefined,
            ctaLabel: "Ver mi pedido",
            footer: `Guardá este número: <strong>${esc(order.order_number)}</strong><br>${esc(store.name)}`,
          }),
        }, {
          order_id: order.id,
          audience: "buyer",
          event: buyerEvent,
        }, { idempotencyKey: claim.idempotencyKey });
        await finishStoreOrderEmail(admin, claim, result);
        buyerDelivered = result.ok;
        if (!result.ok) emailFailure(result, "customer", "store-order-email-buyer");
      } else {
        if (claim.duplicate) {
          buyerDelivered = true;
        } else if (claim.inProgress) {
          // Otra ejecución ya tiene el lease: no afirmamos entrega ni reenviamos.
          buyerDelivered = null;
        }
      }
    }

    // ── Al dueño ─────────────────────────────────────────────────────────
    const { data: owner } = await admin
      .from("memberships")
      .select("user_id")
      .eq("org_id", store.org_id)
      .eq("role", "owner")
      .order("joined_at")
      .limit(1)
      .maybeSingle();

    // Preferencia: la casilla de ventas de la tienda; si no, el email del dueño.
    let ownerEmail = (store as any).notification_email || "";
    if (!ownerEmail && owner?.user_id) {
      const { data: u } = await admin.auth.admin.getUserById(owner.user_id);
      ownerEmail = u?.user?.email ?? "";
    }

    if (ownerEmail) {
      const contacto = [
        order.customer_name,
        order.customer_email,
        order.customer_phone,
      ].filter(Boolean).map(esc).join(" · ");

      const claim = await claimStoreOrderEmail(admin, {
        orderId: order.id,
        audience: "merchant",
        event: "order_created",
        recipientEmail: ownerEmail,
      });
      if (claim.claimed) {
        const result = await sendEmail(smtpCfg, resendKey, resendFrom, {
          to: ownerEmail,
          subject: `Nueva venta ${money(order.total)} — ${order.order_number}`,
          html: layout({
            accent, storeName: store.name,
            title: "Entró un pedido nuevo",
            intro: `<strong>${contacto}</strong><br>Medio de pago: ${esc(order.payment_method)} · Estado: ${esc(order.payment_status)}`,
            order, itemsRows: rows,
            pickupAddress: store.pickup_address,
            pickupInstructions: store.pickup_instructions,
            ctaUrl: base ? `${base}/tienda-online` : undefined,
            ctaLabel: "Ver en el panel",
            footer: "Aviso automático de tu tienda online.",
          }),
        }, {
          order_id: order.id,
          audience: "merchant",
          event: "order_created",
        }, { idempotencyKey: claim.idempotencyKey });
        await finishStoreOrderEmail(admin, claim, result);
        if (!result.ok) emailFailure(result, "merchant", "store-order-email-merchant");
      }
    }

    return json({ ok: true, emailRequested: true, emailDelivered: buyerDelivered });
  } catch (e) {
    console.error("store-order-email error:", e);
    return json({
      error: "No pudimos preparar el aviso por correo. Tu pedido sigue confirmado.",
      public_message: "No pudimos preparar el aviso por correo. Tu pedido sigue confirmado.",
      code: "ORDER_EMAIL_FAILED",
    }, 500);
  }
});
