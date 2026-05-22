/**
 * send-whatsapp — Sends WhatsApp messages via Twilio Messages API.
 *
 * Required Supabase secrets:
 *   TWILIO_ACCOUNT_SID  — Twilio Account SID (AC...)
 *   TWILIO_AUTH_TOKEN   — Twilio Auth Token
 *   TWILIO_WHATSAPP_FROM — Sender number with "whatsapp:" prefix, e.g. "whatsapp:+14155238886"
 *
 * Request body:
 *   { orgId, recipients: [{ phone, name }], message, campaignId? }
 *
 * Phone numbers must be in E.164 format: +54911xxxxxxxx
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Recipient {
  phone: string;
  name: string;
}

interface SendRequest {
  orgId: string;
  recipients: Recipient[];
  message: string;
  campaignId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-whatsapp", { max: 3, windowMs: 60_000 })) return rateLimitResponse();

  // ── Auth check ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sbAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes } = await sbAuth.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Twilio credentials ───────────────────────────────────────────────────────
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_WHATSAPP_FROM"); // e.g. "whatsapp:+14155238886"

  if (!accountSid || !authToken || !fromNumber) {
    return new Response(JSON.stringify({
      error: "Twilio no configurado. Ingresá tus credenciales en Ajustes → Integraciones.",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: SendRequest = await req.json();
    const { orgId, recipients, message, campaignId } = body;

    if (!orgId || !message?.trim() || !recipients?.length) {
      return new Response(JSON.stringify({ error: "orgId, message y recipients son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (recipients.length > 200) {
      return new Response(JSON.stringify({ error: "Máximo 200 destinatarios por llamada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the user belongs to this org
    const { data: membership } = await admin
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

    // ── Twilio Messages API — batch send ─────────────────────────────────────
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const basicAuth = btoa(`${accountSid}:${authToken}`);

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    const BATCH = 5; // Twilio WhatsApp rate limit is ~10/s; 5 concurrent is safe
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      await Promise.all(batch.map(async (r) => {
        // Normalize phone to E.164
        let phone = r.phone.replace(/\s+/g, "").replace(/[^\d+]/g, "");
        if (!phone.startsWith("+")) phone = "+" + phone;

        // Personalize message
        const personalizedMsg = message
          .replace(/\{\{nombre\}\}/gi, r.name.split(" ")[0])
          .replace(/\{\{name\}\}/gi, r.name.split(" ")[0]);

        try {
          const res = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              Authorization: `Basic ${basicAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: `whatsapp:${phone}`,
              Body: personalizedMsg,
            }),
          });

          const data = await res.json();
          if (res.ok && data.sid) {
            sent++;
          } else {
            failed++;
            const errMsg = data.message || data.error_message || `HTTP ${res.status}`;
            errors.push(`${phone}: ${errMsg}`);
            console.warn(`Twilio send failed for ${phone}:`, errMsg);
          }
        } catch (e) {
          failed++;
          errors.push(`${phone}: ${e instanceof Error ? e.message : "error"}`);
        }
      }));

      // Small delay between batches to respect rate limits
      if (i + BATCH < recipients.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── Update campaign stats if campaignId provided ──────────────────────────
    if (campaignId) {
      await admin
        .from("whatsapp_campaigns")
        .update({
          status: failed === recipients.length ? "failed" : "sent",
          sent_count: sent,
          failed_count: failed,
          sent_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    }

    console.log(`send-whatsapp: org=${orgId} sent=${sent} failed=${failed}`);

    return new Response(JSON.stringify({ sent, failed, errors: errors.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-whatsapp error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
