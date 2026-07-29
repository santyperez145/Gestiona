/**
 * store-order-email — avisos por email de un pedido de la tienda online.
 *
 * Manda dos correos distintos:
 *   - al comprador: confirmación con el detalle y el número de pedido
 *   - al dueño: aviso de que entró una venta, con los datos de contacto
 *
 * Es pública porque la dispara el checkout de un visitante anónimo, pero no
 * recibe contenido del cliente: solo un slug y un número de pedido. Todo lo
 * que se manda sale de la base. Así nadie puede usar la función para enviar
 * correos arbitrarios desde tu dominio.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { sendEmail, parseSmtpConfig } from "../_shared/smtpSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
}) {
  const dir = opts.order.shipping_address ?? {};
  const dirTexto = [dir.calle, dir.ciudad, dir.provincia, dir.cp].filter(Boolean).join(", ");
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
      <tr><td style="color:#888">Envío</td><td style="text-align:right">${Number(opts.order.shipping_cost) === 0 ? "Gratis" : money(opts.order.shipping_cost)}</td></tr>
      <tr><td style="font-weight:700;padding-top:6px">Total</td><td style="text-align:right;font-weight:700;padding-top:6px">${money(opts.order.total)}</td></tr>
    </table>
    ${dirTexto ? `<p style="margin:14px 0 0;font-size:13px;color:#555"><strong>Envío a:</strong> ${esc(dirTexto)}</p>` : ""}
  </div>

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
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { slug, orderNumber, baseUrl } = await req.json();
    if (!slug || !orderNumber) return json({ error: "slug y orderNumber son requeridos" }, 400);

    const { data: store } = await admin
      .from("ecommerce_stores")
      .select("id, org_id, name, slug, primary_color, is_active, notification_email")
      .ilike("slug", slug)
      .maybeSingle();
    if (!store?.is_active) return json({ error: "Tienda no encontrada" }, 404);

    const { data: order } = await admin
      .from("ecommerce_orders")
      .select("*")
      .eq("store_id", store.id)
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (!order) return json({ error: "Pedido no encontrado" }, 404);

    const { data: settings } = await admin
      .from("settings")
      .select("*")
      .eq("org_id", store.org_id)
      .maybeSingle();

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const smtpCfg = parseSmtpConfig(settings as Record<string, unknown> | null);
    if (!smtpCfg?.host && !resendKey) {
      // Sin proveedor configurado no es un error del pedido: la compra ya se
      // hizo. Se informa y listo, para no romper el checkout.
      return json({ ok: false, reason: "sin proveedor de email configurado" });
    }

    const fromEmail = (settings as any)?.from_email || (settings as any)?.smtp_user
      || Deno.env.get("FROM_EMAIL") || "pedidos@resend.dev";
    const resendFrom = `${store.name} <${fromEmail}>`;
    const accent = store.primary_color || "#111111";
    const base = String(baseUrl || "").replace(/\/+$/, "");
    const orderUrl = `${base}/tienda/${store.slug}/orden/${order.order_number}`;
    const rows = itemsHtml((order.items ?? []) as Item[], accent);

    const results: Record<string, unknown> = {};

    // ── Al comprador ─────────────────────────────────────────────────────
    if (order.customer_email) {
      const pagado = order.payment_status === "paid";
      results.comprador = await sendEmail(smtpCfg, resendKey, resendFrom, {
        to: order.customer_email,
        subject: `${pagado ? "Pago confirmado" : "Recibimos tu pedido"} — ${order.order_number}`,
        html: layout({
          accent, storeName: store.name,
          title: pagado ? "¡Pago confirmado!" : "¡Gracias por tu compra!",
          intro: pagado
            ? "Ya estamos preparando tu envío. Te avisamos cuando salga."
            : "Recibimos tu pedido. Te escribimos para coordinar el pago y la entrega.",
          order, itemsRows: rows,
          ctaUrl: base ? orderUrl : undefined,
          ctaLabel: "Ver mi pedido",
          footer: `Guardá este número: <strong>${esc(order.order_number)}</strong><br>${esc(store.name)}`,
        }),
      });
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

      results.dueno = await sendEmail(smtpCfg, resendKey, resendFrom, {
        to: ownerEmail,
        subject: `Nueva venta ${money(order.total)} — ${order.order_number}`,
        html: layout({
          accent, storeName: store.name,
          title: "Entró un pedido nuevo",
          intro: `<strong>${contacto}</strong><br>Medio de pago: ${esc(order.payment_method)} · Estado: ${esc(order.payment_status)}`,
          order, itemsRows: rows,
          ctaUrl: base ? `${base}/tienda-online` : undefined,
          ctaLabel: "Ver en el panel",
          footer: "Aviso automático de tu tienda online.",
        }),
      });
    }

    return json({ ok: true, ...results });
  } catch (e) {
    console.error("store-order-email error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
