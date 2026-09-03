#!/usr/bin/env node
/**
 * Certifica el request canónico contra un receptor HTTPS fuera de Nerqia.
 * Sólo envía test.ping sintético y elimina el receptor efímero al terminar.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  buildSignedOutboundWebhookRequest,
  OUTBOUND_WEBHOOK_API_VERSION,
} from "../supabase/functions/_shared/outboundWebhook.ts";

const WEBHOOK_SITE = "https://webhook.site";
// Webhook.site documenta un UUID de 36 caracteres, no promete versión/variant.
const TOKEN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchWithRetry(label: string, url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label}: ${detail}`);
}

function headerOf(headers: unknown, wanted: string): string {
  if (!headers || typeof headers !== "object") return "";
  const entry = Object.entries(headers as Record<string, unknown>)
    .find(([name]) => name.toLowerCase() === wanted.toLowerCase());
  const value = entry?.[1];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value == null ? "" : String(value);
}

function safeEqualHex(leftHex: string, rightHex: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(leftHex) || !/^[a-f0-9]{64}$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function latestRequest(tokenId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchWithRetry("lectura del receptor", `${WEBHOOK_SITE}/token/${tokenId}/request/latest`, {
      headers: { Accept: "application/json" },
    }, 2);
    if (response.ok) return await response.json() as Record<string, unknown>;
    if (response.status !== 404) throw new Error(`No se pudo leer el receptor: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("El receptor externo no registró el request a tiempo");
}

async function main() {
  let tokenId = "";
  let deleted = false;
  let certified = false;
  let cleanupFailed = false;
  try {
    const tokenResponse = await fetchWithRetry("creación del receptor", `${WEBHOOK_SITE}/token`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!tokenResponse.ok) throw new Error(`No se pudo crear el receptor: HTTP ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { uuid?: unknown };
    tokenId = typeof token.uuid === "string" ? token.uuid : "";
    if (!TOKEN_ID.test(tokenId)) throw new Error("Webhook.site no devolvió un token válido");

    const secret = `whsec_cert_${crypto.randomUUID().replaceAll("-", "")}`;
    const orgId = crypto.randomUUID();
    const signed = await buildSignedOutboundWebhookRequest({
      secret,
      event: "test.ping",
      orgId,
      data: {
        message: "Certificación externa sin datos reales",
      },
    });

    const delivery = await fetchWithRetry("entrega firmada", `${WEBHOOK_SITE}/${tokenId}`, {
      method: "POST",
      redirect: "manual",
      headers: signed.headers,
      body: signed.payloadString,
    });
    if (!delivery.ok) throw new Error(`El receptor devolvió HTTP ${delivery.status}, se esperaba 2xx`);

    const captured = await latestRequest(tokenId);
    const method = String(captured.method ?? "").toUpperCase();
    const rawBody = String(captured.content ?? "");
    const capturedHeaders = captured.headers;
    const signatureHeader = headerOf(capturedHeaders, "X-Gestiona-Signature");
    const match = signatureHeader.match(/^t=(\d+),v1=([a-f0-9]{64})$/i);
    if (!match) throw new Error("El receptor no capturó una firma con el formato contractual");
    const expected = createHmac("sha256", secret)
      .update(`${match[1]}.${rawBody}`, "utf8")
      .digest("hex");

    const assertions = {
      method: method === "POST",
      rawBody: rawBody === signed.payloadString,
      signature: safeEqualHex(match[2], expected),
      event: headerOf(capturedHeaders, "X-Gestiona-Event") === "test.ping",
      eventId: headerOf(capturedHeaders, "X-Gestiona-Event-Id") === signed.eventId,
      deliveryId: headerOf(capturedHeaders, "X-Gestiona-Delivery") === signed.deliveryId,
      organization: headerOf(capturedHeaders, "X-Gestiona-Org") === orgId,
      version: headerOf(capturedHeaders, "X-Gestiona-Version") === OUTBOUND_WEBHOOK_API_VERSION,
      contentType: headerOf(capturedHeaders, "Content-Type").startsWith("application/json"),
    };
    const failed = Object.entries(assertions).filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) throw new Error(`Fallaron invariantes externas: ${failed.join(", ")}`);
    certified = true;

    const requestId = typeof captured.uuid === "string" ? captured.uuid : "sin-id";
    console.log(JSON.stringify({
      certified_at: new Date().toISOString(),
      receiver: "webhook.site",
      request_id: requestId,
      api_version: OUTBOUND_WEBHOOK_API_VERSION,
      event: "test.ping",
      http_status: delivery.status,
      assertions: Object.keys(assertions),
      real_business_data: false,
    }, null, 2));
  } finally {
    if (tokenId) {
      const response = await fetchWithRetry("borrado del receptor", `${WEBHOOK_SITE}/token/${tokenId}`, {
        method: "DELETE", headers: { Accept: "application/json" },
      }, 2).catch(() => null);
      deleted = response?.status === 204;
      cleanupFailed = !deleted && certified;
      console.log(`Receptor efímero eliminado: ${deleted ? "sí" : "no"}`);
    }
  }
  if (cleanupFailed) throw new Error("La prueba terminó, pero no se pudo borrar el receptor efímero");
}

await main();
