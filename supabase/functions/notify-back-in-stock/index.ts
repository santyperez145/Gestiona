/**
 * notify-back-in-stock — avisa a quien pidió que le avisen cuando volvió el stock.
 *
 * Corre por cron. `pending_stock_alerts()` ya devuelve sólo los avisos cuyo
 * producto (o variante) tiene stock otra vez, así que acá no se decide nada de
 * negocio: se manda y se marca.
 *
 * Se avisa UNA sola vez por pedido. Si vuelve a agotarse y la persona lo pide
 * de nuevo, `request_stock_alert` reabre el aviso; insistir por nuestra cuenta
 * es la forma más rápida de que marquen el remitente como spam.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion, type SmtpConfig } from "../_shared/smtpSender.ts";

import { exigirCron } from "../_shared/cronAuth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  try {
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const body = await req.json().catch(() => ({}));
    const baseUrl = (body?.baseUrl || Deno.env.get("PUBLIC_BASE_URL") || "").replace(/\/+$/, "");

    const { data: avisos, error } = await admin.rpc("pending_stock_alerts");
    if (error) throw error;
    if (!avisos?.length) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, reason: "sin avisos pendientes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const cacheSmtp = new Map<string, SmtpConfig | null>();
    const resendFrom = (await remitenteDe("marketing")).from;
    let enviados = 0;
    const errores: string[] = [];

    for (const a of avisos as Record<string, string | number>[]) {
      try {
        const orgId = String(a.org_id);
        let smtpCfg = cacheSmtp.get(orgId);
        if (smtpCfg === undefined) {
          smtpCfg = await smtpDeOrganizacion(orgId);
          cacheSmtp.set(orgId, smtpCfg);
        }
        if (!smtpCfg?.host && !resendKey) continue;   // ese comercio no puede enviar

        const nombre = a.variant_name
          ? `${a.product_name} — ${a.variant_name}`
          : String(a.product_name);
        const link = baseUrl ? `${baseUrl}/tienda/${a.store_slug}/producto/${a.product_id}` : "";
        // Con poco stock se dice cuánto queda: es la diferencia entre volver
        // hoy y volver la semana que viene cuando ya no está.
        const quedan = Number(a.stock) || 0;

        const res = await sendEmail(smtpCfg, resendKey, resendFrom, {
          to: String(a.email),
          subject: `Volvió ${nombre}`,
          html: `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="font-size:20px;font-weight:700;text-align:center;margin:0 0 20px">${esc(a.store_name)}</p>
  <h1 style="font-size:22px;margin:0 0 8px">Volvió lo que esperabas</h1>
  <p style="color:#555;margin:0 0 20px;line-height:1.5">
    <strong>${esc(nombre)}</strong> está disponible otra vez.
    ${quedan > 0 && quedan <= 5 ? `Quedan ${quedan} unidades.` : ""}
  </p>
  ${link ? `<div style="text-align:center;margin-bottom:20px">
    <a href="${esc(link)}" style="display:inline-block;padding:12px 28px;border-radius:8px;background:#111;color:#fff;font-weight:600;text-decoration:none;font-size:14px">Verlo en la tienda</a>
  </div>` : ""}
  <p style="color:#888;font-size:12px;text-align:center;line-height:1.5;margin:0">
    Recibís este mensaje porque pediste que te avisáramos. Es el único aviso por este pedido.
  </p>
</div>`,
        });

        if (res.ok) {
          // Se marca sólo si el envío salió bien: si falla, el próximo ciclo
          // lo reintenta en vez de perderlo en silencio.
          await admin.from("store_stock_alerts")
            .update({ notified_at: new Date().toISOString() })
            .eq("id", a.alert_id);
          enviados++;
        } else {
          errores.push(`${a.email}: ${res.error ?? "error"}`);
        }
      } catch (e) {
        errores.push(`${a.email}: ${(e as Error).message}`);
      }
    }

    console.log(`Avisos de reposición: ${enviados} enviados, ${errores.length} con error`);
    return new Response(JSON.stringify({ ok: true, enviados, errores }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify-back-in-stock:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
