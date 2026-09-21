import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const webhook = read("supabase/functions/mercadopago-webhook/index.ts");
const mpToken = read("supabase/functions/_shared/mpToken.ts");

function manifest(id: string, requestId: string, ts: string): string {
  return `id:${id};request-id:${requestId};ts:${ts};`;
}

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

describe("firma y autoridad del webhook de Mercado Pago", () => {
  it("usa exactamente el manifiesto oficial con punto y coma final", () => {
    const secret = "test-secret";
    const correct = sign(secret, manifest("123", "req-1", "1700000000"));
    const missingTerminator = sign(secret, "id:123;request-id:req-1;ts:1700000000");

    expect(correct).toHaveLength(64);
    expect(correct).not.toBe(missingTerminator);
    expect(webhook).toContain(
      "const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`",
    );
  });

  it("parsea ts= y v1= sin aceptar formatos alternativos", () => {
    expect(webhook).toContain('const ts = parts["ts"]');
    expect(webhook).toContain('const v1 = parts["v1"]');
    expect(webhook).toContain('if (!/^[a-f0-9]{64}$/i.test(v1)) return false');
    expect(webhook).toContain('crypto.subtle.verify("HMAC"');
    expect(webhook).not.toContain('startsWith("ts:")');
    expect(webhook).not.toContain('startsWith("v1:")');
    expect(webhook).not.toContain("for (const template");
  });

  it("falla cerrado sin secreto, headers o firma válida", () => {
    expect(webhook).toContain('if (!secret)');
    expect(webhook).toContain('status: 503');
    expect(webhook).toContain('if (!resourceId || !signature || !requestId');
    expect(webhook).toContain('status: 401');
    expect(webhook).toContain("requireValidSignature(req, suscId)");
    expect(webhook).toContain("requireValidSignature(req, paymentId)");
  });

  it("rechaza discrepancias entre el id firmado de URL y el body", () => {
    expect(webhook).toContain("if (urlId && normalizedBodyId && urlId !== normalizedBodyId) return null");
    expect(webhook).toContain('String(payment.id ?? "") !== verifiedId');
    expect(webhook).toContain('"provider resource mismatch"');
  });

  it("reconsulta el recurso autoritativo y no prueba tokens de otros tenants", () => {
    expect(webhook).toContain("/v1/payments/${verifiedId}");
    expect(webhook).toContain("fetchMercadoPagoOrder(credentials.accessToken, verifiedId)");
    expect(webhook).toContain("provider validation failed");
    expect(webhook).not.toContain('.from("payment_connections")');
    expect(webhook).not.toContain(".limit(50)");
    expect(webhook).not.toContain('req.headers.get("x-org-id")');
  });

  it("no filtra secretos ni firmas calculadas en logs", () => {
    const logs = webhook.match(/console\.(?:log|warn|error)\([^;]*\)/gs) ?? [];
    for (const entry of logs) {
      expect(entry).not.toContain("webhookSecret");
      expect(entry).not.toContain("globalWebhookSecret");
      expect(entry).not.toContain("computedV1");
      expect(entry).not.toContain("x-signature");
    }
  });
});

describe("renovación del token de Mercado Pago", () => {
  it("renueva antes de vencer con refresh_token y conserva el anterior", () => {
    expect(mpToken).toContain("const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;");
    expect(mpToken).toContain("if (venceEn > RENEW_BEFORE_MS || !conn.refresh_token)");
    expect(mpToken).toContain('grant_type: "refresh_token"');
    expect(mpToken).toContain("client_id: appId");
    expect(mpToken).toContain("client_secret: appSecret");
    expect(mpToken).toContain("refresh_token: tok.refresh_token ?? conn.refresh_token");
  });

  it("conserva un token todavía vigente si la renovación preventiva falla", () => {
    expect(mpToken).toContain('last_error: "No se pudo renovar el token"');
    expect(mpToken).toMatch(/catch \{ \/\* se usa el token actual/);
  });
});
