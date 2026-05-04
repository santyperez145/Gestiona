/**
 * Outbound webhook delivery for Zapier, N8N, Make.com integrations.
 *
 * Payload format:
 *   POST <webhook_url>
 *   Content-Type: application/json
 *   X-Gestiona-Event: sale.created | stock.low | debt.overdue
 *   X-Gestiona-Org: <org_id>
 *
 * Body: { event, org_id, timestamp, data: { ... } }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-webhook", { max: 60, windowMs: 60_000 })) return rateLimitResponse();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/, "").trim();

  let orgId: string | null = null;
  if (token) {
    const { data: user } = await supabase.auth.getUser(token);
    if (user?.user?.id) {
      const { data: mb } = await supabase.from("memberships").select("org_id").eq("user_id", user.user.id).limit(1).maybeSingle();
      orgId = mb?.org_id ?? null;
    }
  }

  if (!orgId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { event, data } = await req.json() as { event: string; data: unknown };
  if (!event || !data) {
    return new Response(JSON.stringify({ error: "event and data required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get webhook config for this org
  const { data: settings } = await supabase
    .from("settings")
    .select("webhook_url, webhook_enabled, webhook_events")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!settings?.webhook_enabled || !settings?.webhook_url) {
    return new Response(JSON.stringify({ skipped: true, reason: "webhook not configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allowedEvents = (settings.webhook_events as string[]) || [];
  if (!allowedEvents.includes(event)) {
    return new Response(JSON.stringify({ skipped: true, reason: "event not subscribed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = {
    event,
    org_id: orgId,
    timestamp: new Date().toISOString(),
    data,
  };

  try {
    const resp = await fetch(settings.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gestiona-Event": event,
        "X-Gestiona-Org": orgId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    return new Response(JSON.stringify({ delivered: resp.ok, status: resp.status }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ delivered: false, error: e.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
