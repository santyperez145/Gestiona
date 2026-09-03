#!/usr/bin/env node
/**
 * Receptor mínimo de webhooks Nerqia, sin dependencias.
 *
 * En producción, reemplazar el Set por una restricción UNIQUE en la base y
 * encolar el efecto antes de responder 2xx.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const secret = process.env.NERQIA_WEBHOOK_SECRET;
const port = Number(process.env.PORT || 8787);
const maxSkewSeconds = 300;
const processed = new Set();

if (!secret) {
  console.error("Falta NERQIA_WEBHOOK_SECRET");
  process.exit(1);
}

function safeEqualHex(received, expected) {
  if (!/^[a-f0-9]{64}$/i.test(received) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const left = Buffer.from(received, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function signatureParts(value) {
  const parts = Object.fromEntries(String(value || "").split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
  }));
  return { timestamp: Number(parts.t), signature: parts.v1 || "" };
}

createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const { timestamp, signature } = signatureParts(request.headers["x-gestiona-signature"]);
    const now = Math.floor(Date.now() / 1_000);
    const expected = Number.isFinite(timestamp)
      ? createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")
      : "";

    if (!timestamp || Math.abs(now - timestamp) > maxSkewSeconds || !safeEqualHex(signature, expected)) {
      response.writeHead(401).end();
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      response.writeHead(400).end();
      return;
    }

    const headersMatch = event.id === request.headers["x-gestiona-event-id"]
      && event.delivery_id === request.headers["x-gestiona-delivery"]
      && event.event === request.headers["x-gestiona-event"]
      && event.org_id === request.headers["x-gestiona-org"]
      && event.api_version === request.headers["x-gestiona-version"];
    if (!headersMatch) {
      response.writeHead(400).end();
      return;
    }

    if (processed.has(event.id)) {
      response.writeHead(204).end();
      return;
    }
    processed.add(event.id);

    console.log(`Aceptado ${event.event} (${event.id})`);
    response.writeHead(202).end();
  });
}).listen(port, () => {
  console.log(`Receptor Nerqia escuchando en http://localhost:${port}`);
});
