/**
 * Outbound webhook delivery for Zapier, N8N, Make.com integrations.
 *
 * Security: Every delivery is signed with HMAC-SHA256 (X-Gestiona-Signature header).
 * Reliability: Up to 3 delivery attempts with exponential backoff (1s, 2s).
 * Traceability: Every attempt is logged to the webhook_deliveries table.
 *
 * Payload format:
 *   POST <webhook_url>
 *   Content-Type: application/json
 *   X-Gestiona-Event: sale.created | stock.low | debt.overdue | test.ping
 *   X-Gestiona-Org: <org_id>
 *   X-Gestiona-Signature: sha256=<hmac_hex>
 *   X-Gestiona-Delivery-Id: <uuid>
 *
 * Body: { event, org_id, timestamp, data: { ... } }
 *
 * Verify signature on your endpoint:
 *   const sig = hmac_sha256(webhook_secret, JSON.stringify(body))
 *   assert(sig === req.headers['x-gestiona-signature'].replace('sha256=', ''))
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── HMAC-SHA256 ────────────────────────────────────────────────
async function hmacSha256(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Delivery with retry ────────────────────────────────────────
async function deliverWithRetry(
  url: string,
  payloadStr: string,
  headers: Record<string, string>,
  maxAttempts = 3,
): Promise<{ ok: boolean; status: number; body: string; attempts: number }> {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 2)));
    }
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: payloadStr,
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = resp.status;
      lastBody = await resp.text().catch(() => "");
      if (resp.ok) return { ok: true, status: lastStatus, body: lastBody, attempts: attempt };
    } catch (e: any) {
      lastBody = e.message || "network error";
      lastStatus = 0;
    }
  }

  return { ok: false, status: lastStatus, body: lastBody, attempts: maxAttempts };
}

// ── Handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (checkRateLimit(req, "send-webhook", { max: 60, windowMs: 60_000 })) return rateLimitResponse();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Auth ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/, "").trim();

  let orgId: string | null = null;
  if (token) {
    const { data: user } = await supabase.auth.getUser(token);
    if (user?.user?.id) {
      const { data: mb } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", user.user.id)
        .limit(1)
        .maybeSingle();
      orgId = mb?.org_id ?? null;
    }
  }

  if (!orgId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json() as { event: string; data: unknown };
  if (!body.event || !body.data) {
    return new Response(JSON.stringify({ error: "event and data required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { event, data } = body;

  // ── Load webhook config ───────────────────────────────────────
  const { data: settings } = await supabase
    .from("settings")
    .select("webhook_url, webhook_enabled, webhook_events, webhook_secret")
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

  // ── Build payload and signature ───────────────────────────────
  const deliveryId = crypto.randomUUID();
  const payload = {
    event,
    org_id: orgId,
    timestamp: new Date().toISOString(),
    delivery_id: deliveryId,
    data,
  };
  const payloadStr = JSON.stringify(payload);

  const secret = (settings as any).webhook_secret || orgId;
  const signature = await hmacSha256(secret, payloadStr);

  const deliveryHeaders: Record<string, string> = {
    "X-Gestiona-Event": event,
    "X-Gestiona-Org": orgId,
    "X-Gestiona-Signature": `sha256=${signature}`,
    "X-Gestiona-Delivery-Id": deliveryId,
  };

  // ── Deliver with retry ────────────────────────────────────────
  const result = await deliverWithRetry(settings.webhook_url, payloadStr, deliveryHeaders);

  // ── Log delivery ──────────────────────────────────────────────
  try {
    await supabase.from("webhook_deliveries" as any).insert({
      org_id: orgId,
      event,
      webhook_url: settings.webhook_url,
      payload,
      attempt_count: result.attempts,
      last_response_status: result.status || null,
      last_response_body: result.body.slice(0, 2000),
      delivered: result.ok,
      delivered_at: result.ok ? new Date().toISOString() : null,
    });
  } catch { /* silent */ }

  return new Response(JSON.stringify({
    delivered: result.ok,
    status: result.status,
    attempts: result.attempts,
    delivery_id: deliveryId,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
