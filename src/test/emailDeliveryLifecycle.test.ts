import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ciclo profesional de correo", () => {
  it("usa tags e idempotencia compatibles con Resend API y SMTP", () => {
    const sender = read("supabase/functions/_shared/smtpSender.ts");
    expect(sender).toContain("body.tags = Object.entries(metadata)");
    expect(sender).toContain('headers["Idempotency-Key"] = idempotencyKey');
    expect(sender).toContain('"Resend-Idempotency-Key": idempotencyKey');
    expect(sender).not.toContain("body.metadata = metadata");
  });

  it("clasifica errores por audiencia y sólo entrega diagnóstico técnico al staff", () => {
    const errors = read("supabase/functions/_shared/emailErrors.ts");
    expect(errors).toContain('EmailErrorAudience = "platform" | "merchant" | "customer"');
    expect(errors).toContain('audience === "platform"');
    expect(errors).toContain("operator_message: operatorMessage");
    expect(errors).toContain("public_message: publicMessage");
  });

  it("impide que comprobantes e invitaciones funcionen como relay abierto", () => {
    const invoice = read("supabase/functions/send-invoice-email/index.ts");
    const invite = read("supabase/functions/send-team-invite/index.ts");
    expect(invoice).toContain('.from("memberships")');
    expect(invoice).toContain('.eq("org_id", orgId)');
    expect(invoice).toContain('UUID.test(String(orgId ?? ""))');
    expect(invite).not.toContain("appUrl || req.headers.get");
    expect(invite).toContain('Deno.env.get("PUBLIC_BASE_URL")');
  });

  it("limita campañas a clientes elegibles y respeta bajas", () => {
    const campaign = read("supabase/functions/send-email-campaign/index.ts");
    expect(campaign).toContain('.from("customers")');
    expect(campaign).toContain('.from("email_unsubscribes")');
    expect(campaign).toContain("recipients.length > 500");
    expect(campaign).toContain("setTimeout(resolve, 220)");
    expect(campaign).toContain("campaign/${campaignId}/${recipient.email}");
  });

  it("verifica anti-replay Svix y deduplica contadores en SQL", () => {
    const webhook = read("supabase/functions/resend-webhook/index.ts");
    const migration = read("supabase/migrations/20260905000020_email_delivery_events.sql");
    expect(webhook).toContain("Math.abs(Date.now() / 1000 - timestamp) > 300");
    expect(webhook).toContain('crypto.subtle.verify("HMAC"');
    expect(webhook).toContain('req.headers.get("svix-id")');
    expect(webhook).toContain('admin.rpc("record_email_provider_event"');
    expect(migration).toContain("email_events_provider_event_uidx");
    expect(migration).toContain("ON CONFLICT (provider_event_id)");
    expect(migration).toContain("open_count = open_count + CASE");
    expect(migration).toContain("TO service_role");
  });

  it("la función pública del checkout nunca devuelve proveedor ni detalle interno", () => {
    const source = read("supabase/functions/store-order-email/index.ts");
    const responseTail = source.slice(source.lastIndexOf("return json({ ok: true"));
    expect(responseTail).not.toContain("result.error");
    expect(responseTail).not.toContain("provider: result.provider");
    expect(source).toContain("emailRequested: true");
  });
});
