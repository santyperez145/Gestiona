/**
 * Entrega canónica de webhooks salientes.
 *
 * - un secret aleatorio por endpoint, leído sólo con service_role;
 * - HMAC-SHA256 sobre `timestamp.payload` para permitir rechazo de replay;
 * - HTTPS, sin credenciales, redirects ni destinos locales obvios;
 * - un id de evento estable para deduplicar reintentos de la outbox;
 * - reintentos acotados y una fila de evidencia por entrega.
 *
 * La firma replica el patrón probado de Stripe (timestamp firmado) y GitHub
 * (HMAC-SHA256 del cuerpo), con nombres propios de Gestiona.
 */

export const SUPPORTED_OUTBOUND_EVENTS = [
  "sale.created",
  "automation.triggered",
] as const;
export const OUTBOUND_WEBHOOK_API_VERSION = "2026-08-29";

export type OutboundEvent = typeof SUPPORTED_OUTBOUND_EVENTS[number] | "test.ping";

type WebhookConfig = {
  id: string;
  org_id: string;
  name: string;
  url: string;
  event_types: string[];
  active: boolean;
  retry_on_fail: boolean;
  max_retries: number;
  timeout_seconds: number;
};

export type WebhookDeliveryResult = {
  webhook_id: string;
  webhook_name: string;
  delivery_id: string;
  delivered: boolean;
  status: number;
  attempts: number;
  duration_ms: number;
  error?: string;
};

const PRIVATE_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.amazonaws.com",
  "169.254.169.254",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

export function assertPublicWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("El endpoint no es una URL válida");
  }

  if (url.protocol !== "https:") throw new Error("El endpoint debe usar HTTPS");
  if (url.username || url.password) throw new Error("El endpoint no puede incluir credenciales");
  if (url.hash) throw new Error("El endpoint no puede incluir un fragmento");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || PRIVATE_HOSTS.has(host) || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".localhost") ||
      /^\d+$/.test(host) || host.includes(":") || isPrivateIpv4(host)) {
    throw new Error("El endpoint debe usar un host público");
  }
  return url;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function responseSnippet(response: Response, maxBytes = 2_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const chunk = value.subarray(0, remaining);
      result += decoder.decode(chunk, { stream: true });
      size += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
    result += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch { /* la respuesta útil ya fue capturada */ }
  }
  return result;
}

async function deliver(
  config: WebhookConfig,
  secret: string,
  event: OutboundEvent,
  orgId: string,
  data: unknown,
  sourceEventId?: string,
  attemptsAllowedOverride?: number,
): Promise<{ result: WebhookDeliveryResult; payload: Record<string, unknown>; responseBody: string }> {
  const url = assertPublicWebhookUrl(config.url);
  const deliveryId = crypto.randomUUID();
  const eventId = sourceEventId || deliveryId;
  const timestamp = Math.floor(Date.now() / 1_000);
  const payload = {
    id: eventId,
    delivery_id: deliveryId,
    api_version: OUTBOUND_WEBHOOK_API_VERSION,
    event,
    org_id: orgId,
    created_at: new Date(timestamp * 1_000).toISOString(),
    data,
  };
  const payloadString = JSON.stringify(payload);
  const signature = await hmacSha256(secret, `${timestamp}.${payloadString}`);
  const attemptsAllowed = attemptsAllowedOverride == null
    ? (config.retry_on_fail ? 1 + Math.min(Math.max(config.max_retries, 0), 3) : 1)
    : Math.min(Math.max(Math.trunc(attemptsAllowedOverride), 1), 4);
  const timeoutMs = Math.min(Math.max(config.timeout_seconds, 3), 15) * 1_000;
  const startedAt = Date.now();
  let status = 0;
  let responseBody = "";
  let lastError = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    attempts = attempt;
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 2)));
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "Gestiona-Webhooks/1.0",
          "X-Gestiona-Event": event,
          "X-Gestiona-Event-Id": eventId,
          "X-Gestiona-Org": orgId,
          "X-Gestiona-Delivery": deliveryId,
          "X-Gestiona-Version": OUTBOUND_WEBHOOK_API_VERSION,
          "X-Gestiona-Signature": `t=${timestamp},v1=${signature}`,
        },
        body: payloadString,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      responseBody = await responseSnippet(response);
      if (response.ok) {
        return {
          payload,
          responseBody,
          result: {
            webhook_id: config.id,
            webhook_name: config.name,
            delivery_id: deliveryId,
            delivered: true,
            status,
            attempts,
            duration_ms: Date.now() - startedAt,
          },
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      status = 0;
      lastError = error instanceof Error ? error.message : String(error);
      responseBody = lastError;
    }
  }

  return {
    payload,
    responseBody,
    result: {
      webhook_id: config.id,
      webhook_name: config.name,
      delivery_id: deliveryId,
      delivered: false,
      status,
      attempts,
      duration_ms: Date.now() - startedAt,
      error: lastError || "El endpoint no confirmó la entrega",
    },
  };
}

export async function deliverOutboundEvent(
  admin: any,
  input: {
    orgId: string;
    event: OutboundEvent;
    data: unknown;
    webhookId?: string;
    includeInactive?: boolean;
    /** Id durable de Domain Events. Se conserva en cada retry de la outbox. */
    eventId?: string;
    /** La outbox usa 1: su propio backoff es la única autoridad de retries. */
    attemptsAllowed?: number;
  },
): Promise<WebhookDeliveryResult[]> {
  let query = admin
    .from("webhook_configs")
    .select("id, org_id, name, url, event_types, active, retry_on_fail, max_retries, timeout_seconds")
    .eq("org_id", input.orgId);

  if (input.webhookId) query = query.eq("id", input.webhookId);
  if (!input.includeInactive) query = query.eq("active", true);
  // Un replay manual conserva el evento histórico aunque hoy el endpoint esté
  // pausado o ya no lo tenga seleccionado. La outbox automática nunca pasa
  // includeInactive, así que las entregas nuevas sí respetan el filtro actual.
  if (input.event !== "test.ping" && !input.includeInactive) {
    query = query.contains("event_types", [input.event]);
  }

  const { data: configs, error: configError } = await query;
  if (configError) throw new Error(`No se pudieron leer los webhooks: ${configError.message}`);
  if (!configs?.length) return [];

  const results: WebhookDeliveryResult[] = [];
  for (const config of configs as WebhookConfig[]) {
    const { data: secretRow, error: secretError } = await admin
      .from("webhook_signing_secrets")
      .select("secret")
      .eq("webhook_id", config.id)
      .eq("org_id", input.orgId)
      .maybeSingle();
    if (secretError || !secretRow?.secret) {
      console.error("outbound webhook secret:", config.id, secretError);
      results.push({
        webhook_id: config.id,
        webhook_name: config.name,
        delivery_id: crypto.randomUUID(),
        delivered: false,
        status: 0,
        attempts: 0,
        duration_ms: 0,
        error: "El endpoint no tiene firma configurada",
      });
      continue;
    }

    let delivery: Awaited<ReturnType<typeof deliver>>;
    try {
      delivery = await deliver(
        config,
        secretRow.secret,
        input.event,
        input.orgId,
        input.data,
        input.eventId,
        input.attemptsAllowed,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      delivery = {
        payload: {
          id: input.eventId,
          event: input.event,
          org_id: input.orgId,
          data: input.data,
        },
        responseBody: message,
        result: {
          webhook_id: config.id,
          webhook_name: config.name,
          delivery_id: crypto.randomUUID(),
          delivered: false,
          status: 0,
          attempts: 0,
          duration_ms: 0,
          error: message,
        },
      };
    }

    const { error: logError } = await admin.from("webhook_deliveries").insert({
      id: delivery.result.delivery_id,
      org_id: input.orgId,
      webhook_id: config.id,
      event: input.event,
      webhook_url: config.url,
      payload: delivery.payload,
      attempt_count: delivery.result.attempts,
      last_response_status: delivery.result.status || null,
      last_response_body: delivery.responseBody.slice(0, 2_000),
      duration_ms: delivery.result.duration_ms,
      delivered: delivery.result.delivered,
      delivered_at: delivery.result.delivered ? new Date().toISOString() : null,
    });
    if (logError) console.error("outbound webhook delivery log:", logError);
    results.push(delivery.result);
  }

  return results;
}
