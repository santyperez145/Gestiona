/**
 * send-email-campaign — Sends an email marketing campaign.
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
import { mensajeDeError } from "../_shared/errorMessage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Recipient { email: string; name: string; }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-email-campaign", { max: 5, windowMs: 60_000 })) return rateLimitResponse();

  // — JWT auth check —
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sbAuth.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { campaignId, subject, bodyHtml, recipients, testOnly } = await req.json() as {
      campaignId: string;
      subject: string;
      bodyHtml: string;
      recipients: Recipient[];
      testOnly?: boolean;
    };

    if (!campaignId || !subject?.trim() || !bodyHtml?.trim() || !recipients?.length || recipients.length > 500) {
      return new Response(JSON.stringify({ error: "La campaña debe tener asunto, contenido y entre 1 y 500 destinatarios", code: "INVALID_CAMPAIGN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve org_id for this campaign
    const { data: campRow } = await supabase
      .from("email_campaigns")
      .select("org_id")
      .eq("id", campaignId)
      .single();
    const orgId: string = campRow?.org_id ?? "";

    // Verify membership
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Sin permisos para esta organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smtpCfg = await smtpDeOrganizacion(orgId);
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = (await remitenteDe("marketing")).from;

    const requested = testOnly
      ? [{ email: String(userRes.user.email ?? "").toLowerCase(), name: "Prueba" }]
      : recipients;
    const normalized = [...new Map(requested.map((recipient) => {
      const email = String(recipient.email ?? "").trim().toLowerCase();
      return [email, { email, name: String(recipient.name ?? "").trim().slice(0, 120) }];
    })).values()].filter((recipient) => EMAIL.test(recipient.email));
    if (!normalized.length) {
      return new Response(JSON.stringify({ error: "No hay destinatarios con un email válido", code: "NO_VALID_RECIPIENTS" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // En un envío real, el servidor vuelve a comprobar que cada destinatario
    // sea un cliente de esta organización. El navegador no puede usar esta
    // función como relay para direcciones arbitrarias.
    let allowed = normalized;
    if (!testOnly) {
      const { data: customerRows, error: customerError } = await supabase
        .from("customers")
        .select("email")
        .eq("org_id", orgId)
        .in("email", normalized.map((recipient) => recipient.email));
      if (customerError) throw customerError;
      const customerEmails = new Set((customerRows ?? []).map((row) => String(row.email ?? "").toLowerCase()));
      allowed = normalized.filter((recipient) => customerEmails.has(recipient.email));
    }

    const { data: blockedRows } = await supabase
      .from("email_unsubscribes")
      .select("email")
      .eq("org_id", orgId)
      .in("email", allowed.map((recipient) => recipient.email));
    const blocked = new Set((blockedRows ?? []).map((row) => String(row.email ?? "").toLowerCase()));
    allowed = allowed.filter((recipient) => !blocked.has(recipient.email));
    if (!allowed.length) {
      return new Response(JSON.stringify({ error: "Todos los destinatarios están dados de baja o no pertenecen a tus clientes", code: "NO_ELIGIBLE_RECIPIENTS" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    let firstFailure: Awaited<ReturnType<typeof sendEmail>> | null = null;

    // Resend admite 5 solicitudes por segundo por defecto. El ritmo deliberado
    // evita 429 y la clave idempotente hace seguro reintentar la campaña.
    for (let i = 0; i < allowed.length; i++) {
      const recipient = allowed[i];
      const firstName = recipient.name.split(" ")[0].replace(/[&<>"']/g, "");
      const personalizedHtml = bodyHtml.replace(/\{\{nombre\}\}/gi, firstName);
      const result = await sendEmail(
        smtpCfg,
        resendKey,
        resendFrom,
        { to: recipient.email, subject: subject.trim().slice(0, 180), html: personalizedHtml },
        { campaign_id: campaignId, org_id: orgId, message_type: testOnly ? "campaign_test" : "campaign" },
        { idempotencyKey: `campaign/${campaignId}/${recipient.email}` },
      );
      if (result.ok) sent++;
      else {
        failed++;
        firstFailure ??= result;
      }
      if (!smtpCfg && i + 1 < allowed.length) await new Promise((resolve) => setTimeout(resolve, 220));
    }

    // Update campaign stats
    await supabase.from("email_campaigns").update({
      status: failed === allowed.length ? "failed" : "sent",
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    }).eq("id", campaignId);

    console.log(`send-email-campaign: org=${orgId} sent=${sent} failed=${failed} provider=${smtpCfg ? "smtp" : resendKey ? "resend" : "none"}`);

    if (sent === 0 && firstFailure) {
      return new Response(JSON.stringify(emailFailure(firstFailure, "merchant", "send-email-campaign")), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      sent,
      failed,
      skipped: normalized.length - allowed.length,
      ...(firstFailure ? { warning: emailFailure(firstFailure, "merchant", "send-email-campaign-partial") } : {}),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // El detalle queda disponible para operaciones sin filtrarse al cartel del comercio.
    console.error("send-email-campaign:", mensajeDeError(err));
    return new Response(JSON.stringify({ error: "No se pudo preparar la campaña. Revisá los destinatarios e intentá nuevamente.", code: "CAMPAIGN_PREPARATION_FAILED" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
