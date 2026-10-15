/**
 * send-supplier-po — Envía una orden de compra al proveedor por correo.
 *
 * Body: { orgId: string, orderId: string, to?: string }
 *
 * 2026-10-14 (funciones incoherentes): antes recibía UN producto armado en el
 * navegador (cantidad, costo en dólares, total) y le ponía un número
 * «PO-xxxxxx» que no existía en ningún lado; el modal de Proveedores metía el
 * resto de los productos en las notas, y «Enviar OC» en Órdenes de compra sólo
 * cambiaba el estado sin mandar nada. Ahora el correo sale de la orden
 * guardada: todos sus renglones, en su moneda, con subtotal, IVA, descuento y
 * total que calculó la base, su número, fecha esperada y condiciones. Al
 * enviarse, una orden en borrador pasa a «enviada» y queda la fecha de envío.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import { emailFailure } from "../_shared/emailErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Renglon = { product_name: string; sku: string | null; quantity_ordered: number; unit_cost: number; tax_rate: number; total_cost: number };

function formatoDe(moneda: string) {
  const usd = moneda.toUpperCase() === "USD";
  const n = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v: number) => `${usd ? "US$" : "$"} ${n.format(Number(v) || 0)}`;
}
const fecha = (d: string | null) => d
  ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" })
  : null;
const cantidad = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Number(n) || 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autenticado" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) return json({ error: "Token inválido o expirado" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { orgId, orderId, to } = await req.json();
    if (!UUID.test(String(orgId ?? "")) || !UUID.test(String(orderId ?? ""))) {
      return json({ error: "Faltan parámetros: orgId y orderId" }, 400);
    }
    const destinoPedido = String(to ?? "").trim().toLowerCase();
    if (destinoPedido && !EMAIL.test(destinoPedido)) return json({ error: "El correo del proveedor no es válido", code: "INVALID_EMAIL" }, 400);

    const { data: membership, error: membershipError } = await admin.from("memberships").select("role")
      .eq("org_id", orgId).eq("user_id", userRes.user.id).in("role", ["owner", "admin"]).maybeSingle();
    if (membershipError) {
      console.error("send-supplier-po membership:", membershipError);
      return json({ error: "No se pudo verificar tu permiso", code: "PERMISSION_CHECK_FAILED" }, 500);
    }
    if (!membership) return json({ error: "No tenés permiso para enviar órdenes de compra", code: "FORBIDDEN" }, 403);

    const { data: orden, error: ordenError } = await admin.from("purchase_orders")
      .select("id, org_id, order_number, supplier_id, supplier_name, supplier_email, status, currency, subtotal, tax_amount, discount_amount, total_amount, notes, expected_date, payment_terms, updated_at")
      .eq("id", orderId).eq("org_id", orgId).maybeSingle();
    if (ordenError) {
      console.error("send-supplier-po orden:", ordenError);
      return json({ error: "No se pudo leer la orden de compra", code: "ORDER_READ_FAILED" }, 500);
    }
    if (!orden) return json({ error: "La orden de compra no existe en este negocio", code: "NOT_FOUND" }, 404);
    if (!["draft", "sent", "confirmed"].includes(orden.status)) {
      return json({ error: "Sólo se envían órdenes en borrador, enviadas o confirmadas", code: "INVALID_STATUS" }, 409);
    }

    const { data: renglones, error: renglonesError } = await admin.from("purchase_order_items")
      .select("product_name, sku, quantity_ordered, unit_cost, tax_rate, total_cost")
      .eq("order_id", orderId).order("created_at");
    if (renglonesError) {
      console.error("send-supplier-po renglones:", renglonesError);
      return json({ error: "No se pudieron leer los productos de la orden", code: "ORDER_READ_FAILED" }, 500);
    }
    if (!renglones?.length) return json({ error: "La orden no tiene productos", code: "EMPTY_ORDER" }, 400);

    let destino = destinoPedido || String(orden.supplier_email ?? "").trim().toLowerCase();
    if (!destino && orden.supplier_id) {
      const { data: prov, error: provError } = await admin.from("suppliers").select("email").eq("id", orden.supplier_id).eq("org_id", orgId).maybeSingle();
      if (provError) console.error("send-supplier-po proveedor:", provError);
      destino = String(prov?.email ?? "").trim().toLowerCase();
    }
    if (!EMAIL.test(destino)) return json({ error: "La orden no tiene un correo del proveedor: cargalo para enviarla", code: "NO_EMAIL" }, 400);

    const smtpCfg = await smtpDeOrganizacion(orgId);
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!smtpCfg && !resendKey) return json({ error: "No hay proveedor de correo configurado. Configurá SMTP en Ajustes." }, 400);

    const [{ data: ajustes }, { data: org }] = await Promise.all([
      admin.from("settings").select("business_name").eq("org_id", orgId).maybeSingle(),
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]);
    const negocio = String(ajustes?.business_name || org?.name || "Nuestro negocio");
    const f = formatoDe(String(orden.currency || "ARS"));
    const hoy = fecha(new Date().toISOString());
    const esperada = fecha(orden.expected_date);

    const filas = (renglones as Renglon[]).map(r => `
        <tr>
          <td>${esc(r.product_name)}${r.sku ? `<div style="font-size:11px;color:#888">${esc(r.sku)}</div>` : ""}</td>
          <td style="text-align:right">${cantidad(r.quantity_ordered)}</td>
          <td style="text-align:right">${f(r.unit_cost)}</td>
          <td style="text-align:right">${Number(r.tax_rate) > 0 ? `${cantidad(r.tax_rate)} %` : "—"}</td>
          <td style="text-align:right">${f(r.total_cost)}</td>
        </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Orden de compra ${esc(orden.order_number)} — ${esc(negocio)}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f4f6; color: #1a1a2e; padding: 24px; margin: 0; }
  .c { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; }
  .h { padding: 24px 32px; border-bottom: 1px solid #e5e7eb; }
  .h h1 { font-size: 18px; margin: 0 0 4px; }
  .h p { font-size: 12px; color: #666; margin: 0; }
  .b { padding: 24px 32px; }
  .meta { display: flex; flex-wrap: wrap; gap: 24px; font-size: 13px; margin-bottom: 18px; }
  .meta div span { display: block; font-size: 10px; text-transform: uppercase; color: #999; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #777; border-bottom: 1px solid #ddd; padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .tot td { border: 0; padding: 4px 8px; }
  .notas { background: #f9fafb; border-left: 3px solid #999; padding: 10px 12px; font-size: 13px; color: #444; margin-top: 16px; white-space: pre-wrap; }
  .f { padding: 14px 32px; font-size: 11px; color: #999; border-top: 1px solid #e5e7eb; }
</style></head>
<body><div class="c">
  <div class="h"><h1>${esc(negocio)}</h1><p>Orden de compra ${esc(orden.order_number)} · ${esc(hoy)}</p></div>
  <div class="b">
    <div class="meta">
      <div><span>Proveedor</span><strong>${esc(orden.supplier_name || "—")}</strong></div>
      <div><span>Orden</span><strong>${esc(orden.order_number)}</strong></div>
      ${esperada ? `<div><span>Entrega esperada</span><strong>${esc(esperada)}</strong></div>` : ""}
      ${orden.payment_terms ? `<div><span>Condiciones</span><strong>${esc(orden.payment_terms)}</strong></div>` : ""}
    </div>
    <table>
      <thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Costo unit.</th><th style="text-align:right">IVA</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <table style="margin-top:10px">
      <tbody>
        <tr class="tot"><td style="text-align:right;color:#666">Subtotal</td><td style="text-align:right;width:140px">${f(orden.subtotal)}</td></tr>
        ${Number(orden.tax_amount) > 0 ? `<tr class="tot"><td style="text-align:right;color:#666">IVA</td><td style="text-align:right">${f(orden.tax_amount)}</td></tr>` : ""}
        ${Number(orden.discount_amount) > 0 ? `<tr class="tot"><td style="text-align:right;color:#666">Descuento</td><td style="text-align:right">− ${f(orden.discount_amount)}</td></tr>` : ""}
        <tr class="tot"><td style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${f(orden.total_amount)}</td></tr>
      </tbody>
    </table>
    ${orden.notes ? `<div class="notas">${esc(String(orden.notes).slice(0, 2000))}</div>` : ""}
    <p style="font-size:13px;color:#555;line-height:1.6;margin-top:18px">Por favor, confirmá la orden respondiendo este correo. Gracias.</p>
    <p style="font-size:13px;font-weight:600">${esc(negocio)}</p>
  </div>
  <div class="f">Orden generada con Nerqia.</div>
</div></body></html>`;

    const result = await sendEmail(
      smtpCfg,
      resendKey,
      (await remitenteDe("pedidos")).from,
      {
        to: destino,
        subject: `Orden de compra ${String(orden.order_number)} — ${negocio.slice(0, 80)}`,
        html,
      },
      { org_id: orgId, purchase_order: orden.order_number, message_type: "supplier_purchase_order" },
      // Cambia con cada envío (updated_at se mueve al registrarlo): un doble
      // clic no duplica y un reenvío deliberado sale.
      { idempotencyKey: `supplier-po/${orgId}/${orden.id}/${orden.updated_at}` },
    );
    if (!result.ok) return json(emailFailure(result, "merchant", "send-supplier-po"), 502);

    const cambios: Record<string, unknown> = { sent_at: new Date().toISOString() };
    if (orden.status === "draft") cambios.status = "sent";
    if (!orden.supplier_email) cambios.supplier_email = destino;
    const { error: estadoError } = await admin.from("purchase_orders").update(cambios).eq("id", orden.id).eq("org_id", orgId);
    if (estadoError) {
      // El correo ya salió: no se informa como falla, pero se avisa.
      console.error("send-supplier-po estado:", estadoError);
      return json({ success: true, to: destino, orderNumber: orden.order_number, statusUpdated: false });
    }
    console.log(`send-supplier-po: ${orden.order_number} to=${destino} provider=${result.provider}`);
    return json({ success: true, to: destino, orderNumber: orden.order_number, statusUpdated: true });
  } catch (err: unknown) {
    console.error("send-supplier-po error:", err);
    return json({ error: "No se pudo enviar la orden de compra. Intentá nuevamente.", code: "PURCHASE_ORDER_EMAIL_FAILED" }, 500);
  }
});
