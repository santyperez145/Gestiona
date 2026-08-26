/**
 * send-email-campaign — Sends an email marketing campaign.
 *
 * Email provider priority:
 *   1. Own SMTP  — if smtp_host + smtp_user are configured in org settings
 *   2. Resend    — if RESEND_API_KEY env var is set
 *   3. Error     — no provider configured
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { sendEmail, parseSmtpConfig } from "../_shared/smtpSender.ts";

import { mensajeDeError } from "../_shared/errorMessage.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Recipient { email: string; name: string; }

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
    const { campaignId, subject, bodyHtml, recipients, orgName } = await req.json() as {
      campaignId: string;
      subject: string;
      bodyHtml: string;
      recipients: Recipient[];
      orgName: string;
    };

    if (!campaignId || !subject || !bodyHtml || !recipients?.length) {
      return new Response(JSON.stringify({ error: "Parámetros faltantes" }), {
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
    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin permisos para esta organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load email provider config from org settings
    const { data: settings } = await supabase
      .from("settings")
      .select("smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_name, smtp_from_email")
      .eq("org_id", orgId)
      .maybeSingle();

    const smtpCfg = parseSmtpConfig(settings as Record<string, unknown> | null);
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = `${orgName || "Gestiona"} <marketing@gestiona.app>`;

    let sent = 0;
    let failed = 0;

    // Send in batches of 10
    const BATCH = 10;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      await Promise.all(batch.map(async (r) => {
        const personalizedHtml = bodyHtml.replace(/\{\{nombre\}\}/gi, r.name.split(" ")[0]);
        const result = await sendEmail(
          smtpCfg,
          resendKey,
          resendFrom,
          { to: r.email, subject, html: personalizedHtml },
          { campaign_id: campaignId, org_id: orgId },
        );
        if (result.ok) sent++;
        else failed++;
      }));
      if (i + BATCH < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    // Update campaign stats
    await supabase.from("email_campaigns").update({
      status: failed === recipients.length ? "failed" : "sent",
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    }).eq("id", campaignId);

    console.log(`send-email-campaign: org=${orgId} sent=${sent} failed=${failed} provider=${smtpCfg ? "smtp" : resendKey ? "resend" : "none"}`);

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: mensajeDeError(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
