/**
 * Webhook de Resend: verificación Svix, ventana anti-replay, deduplicación y
 * métricas atómicas. Resend entrega al menos una vez y puede desordenar eventos;
 * `svix-id` es la identidad durable, no el orden de llegada.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

type ProviderEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    tags?: Array<{ name?: string; value?: string }>;
    metadata?: Record<string, string>;
    click?: { link?: string };
  };
};

const TYPE_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivery",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.bounced": "bounce",
  "email.suppressed": "suppressed",
  "email.complained": "complaint",
  "email.opened": "open",
  "email.clicked": "click",
  "email.unsubscribed": "unsubscribe",
};

function base64Bytes(value: string): ArrayBuffer | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

async function verifyResendSignature(req: Request, rawBody: string): Promise<"ok" | "missing-secret" | "invalid"> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return "missing-secret";

  const svixId = req.headers.get("svix-id");
  const svixTs = req.headers.get("svix-timestamp");
  const svixSig = req.headers.get("svix-signature");
  const timestamp = Number(svixTs);
  if (!svixId || !svixTs || !svixSig || !Number.isFinite(timestamp)) return "invalid";
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return "invalid";

  const secretBytes = base64Bytes(secret.replace(/^whsec_/, ""));
  if (!secretBytes) return "invalid";
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${svixId}.${svixTs}.${rawBody}`).buffer as ArrayBuffer;

  for (const candidate of svixSig.split(" ")) {
    const [version, encoded] = candidate.split(",", 2);
    const signature = version === "v1" && encoded ? base64Bytes(encoded) : null;
    if (signature && await crypto.subtle.verify("HMAC", key, signature, signed)) return "ok";
  }
  return "invalid";
}

function tagsOf(data: ProviderEvent["data"]): Record<string, string> {
  const tags = Object.fromEntries((data?.tags ?? [])
    .filter((tag) => typeof tag.name === "string" && typeof tag.value === "string")
    .map((tag) => [tag.name!, tag.value!]));
  return { ...(data?.metadata ?? {}), ...tags };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const rawBody = await req.text();
  const signature = await verifyResendSignature(req, rawBody);
  if (signature === "missing-secret") {
    console.error("resend-webhook: RESEND_WEBHOOK_SECRET missing");
    return json({ error: "Webhook no disponible" }, 503);
  }
  if (signature !== "ok") return json({ error: "Firma inválida" }, 401);

  try {
    const payload = JSON.parse(rawBody) as ProviderEvent;
    const eventType = TYPE_MAP[String(payload.type ?? "")];
    if (!eventType) return json({ ok: true, skipped: true });

    const svixId = req.headers.get("svix-id")!;
    const tags = tagsOf(payload.data);
    const orgId = tags.org_id;
    const campaignId = tags.campaign_id || null;
    if (!orgId) {
      console.warn("resend-webhook: event without org_id", { svixId, type: payload.type });
      return json({ ok: true, skipped: true });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) return json({ error: "Webhook no disponible" }, 503);
    const admin = createClient(url, serviceRole);
    const recipient = Array.isArray(payload.data?.to) ? payload.data?.to[0] : payload.data?.to;
    const occurredAt = payload.created_at && !Number.isNaN(Date.parse(payload.created_at))
      ? payload.created_at
      : new Date().toISOString();

    const { data: inserted, error } = await admin.rpc("record_email_provider_event", {
      p_provider_event_id: svixId,
      p_org_id: orgId,
      p_campaign_id: campaignId,
      p_event_type: eventType,
      p_recipient_email: recipient || null,
      p_link_url: payload.data?.click?.link || null,
      p_provider_message_id: payload.data?.email_id || null,
      p_occurred_at: occurredAt,
    });
    if (error) throw error;

    return json({ ok: true, event: eventType, duplicate: inserted === false });
  } catch (error) {
    console.error("resend-webhook processing:", error);
    return json({ error: "No se pudo registrar el evento" }, 500);
  }
});
