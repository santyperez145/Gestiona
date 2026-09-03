import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSignedOutboundWebhookRequest,
  OUTBOUND_WEBHOOK_API_VERSION,
  OUTBOUND_WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
} from "../../supabase/functions/_shared/outboundWebhook";

const ROOT = process.cwd();
const contract = JSON.parse(readFileSync(
  resolve(ROOT, "public/developer/webhooks/openapi.json"),
  "utf8",
));
const docs = readFileSync(resolve(ROOT, "docs/WEBHOOKS.md"), "utf8");
const receiver = readFileSync(resolve(ROOT, "examples/nerqia-webhook-receiver.mjs"), "utf8");
const certificate = readFileSync(resolve(ROOT, "scripts/certificar-webhook-externo.ts"), "utf8");
const panel = readFileSync(resolve(ROOT, "src/components/integrations/AdvancedWebhooksPanel.tsx"), "utf8");
const executeAutomations = readFileSync(resolve(ROOT, "supabase/functions/execute-automations/index.ts"), "utf8");
const runAutomations = readFileSync(resolve(ROOT, "supabase/functions/run-automation-flows/index.ts"), "utf8");
const sendWebhook = readFileSync(resolve(ROOT, "supabase/functions/send-webhook/index.ts"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8"));

describe("contrato público de webhooks", () => {
  it("publica OpenAPI 3.1 con la misma versión y los tres eventos entregables", () => {
    expect(contract.openapi).toBe("3.1.1");
    expect(contract.info.version).toBe(OUTBOUND_WEBHOOK_API_VERSION);
    expect(contract.security).toEqual([{ GestionaHmac: [] }]);
    expect(contract.components.securitySchemes.GestionaHmac.name).toBe("X-Gestiona-Signature");
    expect(contract.servers[0].url).toBe("https://{receiverHost}/{receiverPath}");
    expect(Object.keys(contract.webhooks).sort()).toEqual([
      "automation.triggered",
      "sale.created",
      "test.ping",
    ]);
    expect(contract.components.parameters.Version.schema.const).toBe(OUTBOUND_WEBHOOK_API_VERSION);
    expect(contract.components.parameters.Signature.schema.pattern).toContain("v1=");
    expect(contract["x-gestiona-delivery"]).toMatchObject({
      semantics: "at-least-once",
      ordering: "not-guaranteed",
      deduplicationKey: "id",
      deliveryKey: "delivery_id",
      maxClockSkewSeconds: OUTBOUND_WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
    });
  });

  it("el constructor canónico produce un vector HMAC reproducible sobre el cuerpo crudo", async () => {
    const secret = "whsec_vector_contractual";
    const eventId = "11111111-1111-4111-8111-111111111111";
    const deliveryId = "22222222-2222-4222-8222-222222222222";
    const orgId = "33333333-3333-4333-8333-333333333333";
    const request = await buildSignedOutboundWebhookRequest({
      secret,
      event: "test.ping",
      orgId,
      sourceEventId: eventId,
      deliveryId,
      now: new Date("2026-08-29T18:30:00.000Z"),
      data: { message: "vector" },
    });

    const expected = createHmac("sha256", secret)
      .update(`${request.timestamp}.${request.payloadString}`, "utf8")
      .digest("hex");
    expect(request.headers["X-Gestiona-Signature"]).toBe(`t=${request.timestamp},v1=${expected}`);
    expect(request.headers["X-Gestiona-Event-Id"]).toBe(eventId);
    expect(request.headers["X-Gestiona-Delivery"]).toBe(deliveryId);
    expect(JSON.parse(request.payloadString)).toMatchObject({
      id: eventId,
      delivery_id: deliveryId,
      api_version: OUTBOUND_WEBHOOK_API_VERSION,
      event: "test.ping",
      org_id: orgId,
    });
  });

  it("automation.triggered tiene una sola forma y no filtra contacto interno", () => {
    for (const source of [executeAutomations, runAutomations]) {
      expect(source).toContain("entity_count:");
      expect(source).toContain("entities:");
      expect(source).toContain("flow_id:");
    }
    expect(runAutomations).not.toContain("subject_count:");
    expect(runAutomations).not.toContain("subjects: subjects.slice");
    const schema = contract.components.schemas.AutomationTriggeredData;
    expect(schema.required).toEqual(["flow_id", "trigger_type", "entity_count", "entities"]);
    expect(contract.components.schemas.AutomationEntity.properties).not.toHaveProperty("phone");
    expect(contract.components.schemas.AutomationEntity.properties).not.toHaveProperty("email");
    expect(contract.components.schemas.TestPingData.properties).not.toHaveProperty("requested_by");
    expect(sendWebhook).not.toContain("auth.user.email");
  });

  it("la documentación y la UI hacen visible el contrato y el receptor seguro", () => {
    expect(docs).toContain("al menos una vez");
    expect(docs).toContain("cuerpo_crudo");
    expect(docs).toContain("npm run certify:webhooks");
    expect(panel).toContain("/developer/webhooks/openapi.json");
    expect(panel).toContain("Contrato OpenAPI");
    expect(vercel.rewrites.at(-1).source).toContain("developer/");
    expect(vercel.rewrites.at(-1).source).not.toBe("/((?!api/|assets/).*)");
    expect(receiver).toContain("timingSafeEqual");
    expect(receiver).toContain("Math.abs(now - timestamp) > maxSkewSeconds");
    expect(receiver).toContain("processed.has(event.id)");
    expect(certificate).toContain("https://webhook.site");
    expect(certificate).toContain("real_business_data: false");
    expect(certificate).toContain('method: "DELETE"');
  });
});
