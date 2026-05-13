import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Recipient { email: string; name: string; }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-email-campaign", { max: 5, windowMs: 60_000 })) return rateLimitResponse();

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY no configurada" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // Retrieve org_id for this campaign (needed for webhook metadata)
    const { data: campRow } = await supabase
      .from("email_campaigns")
      .select("org_id")
      .eq("id", campaignId)
      .single();
    const orgId: string = campRow?.org_id ?? "";

    let sent = 0;
    let failed = 0;

    // Send in batches of 10 to avoid rate limits
    const BATCH = 10;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      await Promise.all(batch.map(async (r) => {
        const personalizedBody = bodyHtml.replace(/\{\{nombre\}\}/g, r.name.split(" ")[0]);
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `${orgName} <marketing@gestiona.app>`,
              to: r.email,
              subject,
              html: personalizedBody,
              // Metadata passed to Resend so webhook can identify campaign + org
              metadata: { campaign_id: campaignId, org_id: orgId },
            }),
          });
          if (res.ok) sent++;
          else failed++;
        } catch {
          failed++;
        }
      }));
      // Small delay between batches
      if (i + BATCH < recipients.length) await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Update campaign stats
    await supabase.from("email_campaigns").update({
      status: failed === recipients.length ? "failed" : "sent",
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
    }).eq("id", campaignId);

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
