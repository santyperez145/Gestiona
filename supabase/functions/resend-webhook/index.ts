/**
 * resend-webhook — Receives Resend email event webhooks
 *
 * Configure in Resend Dashboard → Webhooks:
 *   URL: https://<project>.supabase.co/functions/v1/resend-webhook
 *   Events: email.opened, email.clicked, email.bounced, email.complained, email.unsubscribed
 *
 * Resend sends: { type: "email.opened", data: { email_id, to: [email], subject, metadata } }
 * Resend uses Svix to sign webhooks — set RESEND_WEBHOOK_SECRET in Supabase secrets.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function verifyResendSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return false; // Reject if secret is not configured — never skip in production

  const svixId = req.headers.get("svix-id");
  const svixTs = req.headers.get("svix-timestamp");
  const svixSig = req.headers.get("svix-signature");
  if (!svixId || !svixTs || !svixSig) return false;

  const toSign = `${svixId}.${svixTs}.${rawBody}`;
  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const computed = "v1," + btoa(String.fromCharCode(...new Uint8Array(sig)));
  return svixSig.split(" ").some(s => s === computed);
}

const TYPE_MAP: Record<string, string> = {
  "email.opened":       "open",
  "email.clicked":      "click",
  "email.bounced":      "bounce",
  "email.complained":   "complaint",
  "email.unsubscribed": "unsubscribe",
  "email.delivered":    "delivery",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const rawBody = await req.text();

    const valid = await verifyResendSignature(req, rawBody);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventType = TYPE_MAP[payload.type];
    if (!eventType) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    const { email_id, to = [], subject, metadata = {} } = payload.data ?? {};
    const recipientEmail = Array.isArray(to) ? to[0] : to;
    const campaignId: string | undefined = metadata.campaign_id;
    const orgId: string | undefined = metadata.org_id;
    const linkUrl: string | undefined = payload.data?.click?.link;

    if (!orgId) {
      console.warn("resend-webhook: no org_id in metadata, skipping");
      return new Response(JSON.stringify({ ok: true, skipped: "no org_id" }), { status: 200 });
    }

    // Insert event record
    await supabase.from("email_events" as any).insert({
      org_id: orgId,
      campaign_id: campaignId ?? null,
      event_type: eventType,
      recipient_email: recipientEmail ?? null,
      link_url: linkUrl ?? null,
      resend_email_id: email_id ?? null,
      occurred_at: new Date().toISOString(),
    });

    // Update aggregate counters on the campaign
    if (campaignId) {
      const counterField =
        eventType === "open"        ? "open_count" :
        eventType === "click"       ? "click_count" :
        eventType === "unsubscribe" ? "unsubscribe_count" : null;

      if (counterField) {
        // Use RPC increment or raw update
        const { data: camp } = await supabase
          .from("email_campaigns" as any)
          .select(counterField)
          .eq("id", campaignId)
          .single();

        if (camp) {
          await supabase
            .from("email_campaigns" as any)
            .update({ [counterField]: ((camp as any)[counterField] ?? 0) + 1 })
            .eq("id", campaignId);
        }
      }
    }

    // Handle unsubscribes: add to blocklist
    if (eventType === "unsubscribe" && recipientEmail && orgId) {
      await supabase.from("email_unsubscribes" as any).upsert(
        { org_id: orgId, email: recipientEmail.toLowerCase() },
        { onConflict: "org_id,email" }
      );
    }

    return new Response(JSON.stringify({ ok: true, event: eventType }), { status: 200 });
  } catch (err: any) {
    console.error("resend-webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
