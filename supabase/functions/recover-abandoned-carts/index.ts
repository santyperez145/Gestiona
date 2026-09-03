/**
 * recover-abandoned-carts — email de recuperación de carritos abandonados.
 *
 * Corre por cron. Busca sesiones activas con email, sin aviso previo y con al
 * menos una hora de inactividad, y manda un correo con lo que la persona había
 * elegido más un link que le devuelve el carrito armado.
 *
 * Es de lo que más ventas recupera en un ecommerce: la persona ya eligió, solo
 * se distrajo.
 *
 * El aviso se manda UNA sola vez por carrito (`abandoned_email_sent`). Insistir
 * es la forma más rápida de que marquen el remitente como spam.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion, type SmtpConfig } from "../_shared/smtpSender.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const money = (n: unknown) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
    .format(Number(n) || 0);

interface Item { name?: string; quantity?: number; unit_price?: number; image_url?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const body = await req.json().catch(() => ({}));
    const horas = Number(body?.hours) || 1;
    const baseUrl = (body?.baseUrl || Deno.env.get("PUBLIC_BASE_URL") || "").replace(/\/+$/, "");

    const { data: carritos, error } = await admin.rpc("pending_abandoned_carts", { p_hours: horas });
    if (error) throw error;
    if (!carritos?.length) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, reason: "sin carritos pendientes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    let enviados = 0;
    const errores: string[] = [];

    const cacheSmtp = new Map<string, SmtpConfig | null>();
    const resendFrom = (await remitenteDe("marketing")).from;

    for (const c of carritos as any[]) {
      try {
        let smtpCfg = cacheSmtp.get(c.org_id);
        if (smtpCfg === undefined) {
          smtpCfg = await smtpDeOrganizacion(c.org_id);
          cacheSmtp.set(c.org_id, smtpCfg);
        }
        if (!smtpCfg?.host && !resendKey) continue;   // ese comercio no puede enviar

        const items = (c.items ?? []) as Item[];
        const filas = items.map(i => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee">
              <span style="color:#888">${Number(i.quantity) || 1}×</span> ${esc(i.name)}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
              ${money((Number(i.unit_price) || 0) * (Number(i.quantity) || 1))}
            </td>
          </tr>`).join("");

        const link = baseUrl
          ? `${baseUrl}/tienda/${c.store_slug}/carrito/${c.recovery_token}`
          : "";

        // Sin PUBLIC_BASE_URL el mail no tiene CTA. Marcar enviado igual
        // quemaba el único intento (Shopify: link usable o no se cuenta).
        if (!link) {
          errores.push(`${c.customer_email}: falta PUBLIC_BASE_URL`);
          continue;
        }

        const res = await sendEmail(smtpCfg, resendKey, resendFrom, {
          to: c.customer_email,
          subject: `Te quedó algo en el carrito 🛒`,
          html: `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="font-size:20px;font-weight:700;text-align:center;margin:0 0 20px">${esc(c.store_name)}</p>
  <h1 style="font-size:22px;margin:0 0 8px">Te quedó algo en el carrito</h1>
  <p style="color:#555;margin:0 0 20px;line-height:1.5">
    Guardamos lo que habías elegido. Si querés, seguí desde donde lo dejaste.
  </p>
  <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-bottom:20px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">${filas}</table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <tr>
        <td style="font-weight:700">Total</td>
        <td style="text-align:right;font-weight:700">${money(c.subtotal)}</td>
      </tr>
    </table>
  </div>
  <div style="text-align:center;margin-bottom:20px">
    <a href="${esc(link)}" style="display:inline-block;padding:12px 28px;border-radius:8px;background:#111;color:#fff;font-weight:600;text-decoration:none;font-size:14px">Retomar mi compra</a>
  </div>
  <p style="color:#888;font-size:12px;text-align:center;line-height:1.5;margin:0">
    Si ya compraste o no te interesa, ignorá este mensaje: no vamos a volver a escribirte por este carrito.
  </p>
</div>`,
        });

        if (res.ok) {
          await admin.rpc("mark_cart_email_sent", { p_id: c.id });
          enviados++;
        } else {
          errores.push(`${c.customer_email}: ${res.error ?? "error"}`);
        }
      } catch (e) {
        errores.push(`${c.customer_email}: ${(e as Error).message}`);
      }
    }

    console.log(`Carritos abandonados: ${enviados} enviados, ${errores.length} con error`);
    return new Response(JSON.stringify({ ok: true, enviados, errores }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recover-abandoned-carts:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
