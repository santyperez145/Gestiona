/**
 * send-push — Send a Web Push notification to all subscriptions for an org.
 *
 * POST body: { org_id, title, body, url?, tag? }
 *
 * Requires VAPID keys in Supabase secrets:
 *   VAPID_PUBLIC_KEY  — base64url public key
 *   VAPID_PRIVATE_KEY — base64url private key
 *   VAPID_SUBJECT     — mailto: or https: URL (e.g. "mailto:admin@gestiona.app")
 *
 * Generate with: npx web-push generate-vapid-keys
 * or: openssl ecparam -genkey -name prime256v1 -noout | openssl ec -pubout ...
 *
 * Uses the Web Push Protocol directly (no npm dependencies) with Deno's crypto.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { exigirCron } from "../_shared/cronAuth.ts";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── VAPID JWT builder ─────────────────────────────────────────
async function buildVapidJwt(audience: string): Promise<string> {
  const privateKeyB64 = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@gestiona.app";

  const header = { alg: "ES256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 3600, sub: subject };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const toSign = `${encode(header)}.${encode(payload)}`;

  // Import private key
  const keyBytes = Uint8Array.from(atob(privateKeyB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(toSign)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${toSign}.${sigB64}`;
}

// ── Send to one subscription ─────────────────────────────────
async function sendToSubscription(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  jwt: string
): Promise<{ ok: boolean; expired?: boolean }> {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(new TextEncoder().encode(payload).length),
      "TTL": "86400",
      "Authorization": `vapid t=${jwt},k=${vapidPublicKey}`,
      "Urgency": "normal",
    },
    body: new TextEncoder().encode(payload),
  });

  if (res.status === 404 || res.status === 410) return { ok: false, expired: true };
  return { ok: res.ok };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Sólo el cron de la base: sin el secreto no pasa nadie.
  const noEsCron = exigirCron(req, { "Access-Control-Allow-Origin": "*" });
  if (noEsCron) return noEsCron;

  try {
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    if (!vapidPublicKey) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 500, headers: CORS });
    }

    const { org_id, title, body, url, tag } = await req.json();
    if (!org_id || !title || !body) {
      return new Response(JSON.stringify({ error: "org_id, title, body required" }), { status: 400, headers: CORS });
    }

    // Load subscriptions for org
    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions" as any)
      .select("endpoint, p256dh, auth")
      .eq("org_id", org_id);

    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200, headers: CORS });
    }

    const payload = JSON.stringify({ title, body, url: url ?? "/", tag: tag ?? "gestiona-push" });
    const expiredEndpoints: string[] = [];
    let sent = 0;

    for (const sub of subs) {
      try {
        const origin = new URL((sub as any).endpoint).origin;
        const jwt = await buildVapidJwt(origin);
        const result = await sendToSubscription(sub as any, payload, vapidPublicKey, jwt);
        if (result.expired) {
          expiredEndpoints.push((sub as any).endpoint);
        } else if (result.ok) {
          sent++;
        }
      } catch (e) {
        console.warn("send-push: failed for endpoint", (sub as any).endpoint, e);
      }
    }

    // Remove expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase.from("push_subscriptions" as any).delete().in("endpoint", expiredEndpoints);
    }

    return new Response(JSON.stringify({ ok: true, sent, expired: expiredEndpoints.length }), {
      status: 200,
      headers: CORS,
    });
  } catch (err: any) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
