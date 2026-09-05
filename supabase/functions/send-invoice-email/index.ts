/**
 * send-invoice-email — Sends an invoice by email with optional PDF attachment.
 *
 * Email provider priority:
 *   1. Own SMTP  — if the organization connected its private credential
 *   2. Resend    — if RESEND_API_KEY env var is set
 *   3. Error     — no provider configured
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
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
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-invoice-email", { max: 30, windowMs: 60_000 })) return rateLimitResponse();

  // — JWT auth check —
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { to, subject, invoiceNumber, customerName, orgName, orgId, totalARS, dueDate, pdfBase64, notes } = await req.json();

    if (!UUID.test(String(orgId ?? "")) || !EMAIL.test(text(to, 320)) || !text(subject, 180) || !text(invoiceNumber, 80)) {
      return new Response(JSON.stringify({ error: "Completá organización, destinatario, asunto y número de comprobante válidos", code: "INVALID_EMAIL_REQUEST" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userRes.user.id)
      .in("role", ["owner", "admin", "vendedor"])
      .maybeSingle();
    if (membershipError) {
      console.error("send-invoice-email membership:", membershipError);
      return new Response(JSON.stringify({ error: "No se pudo verificar tu permiso", code: "PERMISSION_CHECK_FAILED" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!membership) {
      return new Response(JSON.stringify({ error: "No tenés permiso para enviar comprobantes de esta organización", code: "FORBIDDEN" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof pdfBase64 === "string" && pdfBase64.length > 12_000_000) {
      return new Response(JSON.stringify({ error: "El PDF supera el límite permitido de 9 MB", code: "ATTACHMENT_TOO_LARGE" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smtpCfg = orgId ? await smtpDeOrganizacion(orgId) : null;

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = (await remitenteDe("facturas")).from;

    const dueDateStr = dueDate
      ? new Date(dueDate).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : null;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Factura ${invoiceNumber}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .header { background: #1a1a2e; padding: 32px 40px; }
  .header h1 { color: #d4a843; margin: 0 0 4px; font-size: 22px; }
  .header p { color: #aab; margin: 0; font-size: 13px; }
  .body { padding: 32px 40px; }
  .greeting { font-size: 16px; margin-bottom: 16px; }
  .detail-row { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 10px 0; font-size: 14px; }
  .detail-row:last-child { border-bottom: none; }
  .label { color: #888; }
  .value { font-weight: 600; color: #222; }
  .total-row .value { font-size: 18px; color: #d4a843; }
  .notes-box { background: #f9f9f9; border-left: 3px solid #d4a843; padding: 12px 16px; margin: 20px 0; font-size: 13px; color: #555; border-radius: 0 6px 6px 0; }
  .footer { background: #f9f9f9; padding: 20px 40px; text-align: center; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${esc(orgName || "Tu comercio")}</h1>
    <p>Comprobante de pago</p>
  </div>
  <div class="body">
    <p class="greeting">Hola <strong>${esc(customerName || "cliente")}</strong>,</p>
    <p>Adjuntamos el detalle de tu comprobante <strong>N° ${esc(invoiceNumber)}</strong>:</p>
    <div>
      <div class="detail-row"><span class="label">Número</span><span class="value">${esc(invoiceNumber)}</span></div>
      ${totalARS ? `<div class="detail-row total-row"><span class="label">Total</span><span class="value">${esc(totalARS)}</span></div>` : ""}
      ${dueDateStr ? `<div class="detail-row"><span class="label">Vencimiento</span><span class="value">${esc(dueDateStr)}</span></div>` : ""}
    </div>
    ${notes ? `<div class="notes-box">${esc(text(notes, 2000)).replace(/\n/g, "<br>")}</div>` : ""}
    ${pdfBase64 ? `<p style="font-size:13px; color:#666;">Se adjunta el PDF de la factura a este correo.</p>` : ""}
    <p style="font-size:13px; color:#888; margin-top:24px;">Ante cualquier consulta, no dudes en contactarnos.</p>
  </div>
  <div class="footer">
    Este correo fue generado automáticamente por ${esc(orgName || "el comercio")}.<br>
    Por favor no respondas este mensaje.
  </div>
</div>
</body>
</html>`;

    const attachments = pdfBase64
      ? [{ filename: `factura-${invoiceNumber}.pdf`, content: pdfBase64, mimeType: "application/pdf" }]
      : undefined;

    const result = await sendEmail(
      smtpCfg,
      resendKey,
      resendFrom,
      { to: text(to, 320), subject: text(subject, 180), html, attachments },
      { org_id: orgId, document_number: text(invoiceNumber, 80), message_type: "transactional" },
    );

    if (!result.ok) {
      return new Response(JSON.stringify(emailFailure(result, "merchant", "send-invoice-email")), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`send-invoice-email: to=${to} provider=${result.provider}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-invoice-email error:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
