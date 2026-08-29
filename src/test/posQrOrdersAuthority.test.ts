import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260829000041_pos_qr_mercadopago_orders.sql"), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/mercadopago-pos-qr/index.ts"), "utf8");
const webhook = readFileSync(resolve(root, "supabase/functions/mercadopago-webhook/index.ts"), "utf8");
const pos = readFileSync(resolve(root, "src/pages/POSPage.tsx"), "utf8");

describe("autoridad de Mercado Pago QR en Caja", () => {
  it("no crea ticket antes de processed y reserva sin escribir stock", () => {
    expect(migration).toContain("v_status <> 'processed'");
    expect(migration.indexOf("v_status <> 'processed'")).toBeLessThan(
      migration.indexOf("create_sales_transaction_v3(\n    v_session.org_id"),
    );
    expect(migration).toContain("INSERT INTO public.stock_reservations");
    expect(migration).not.toMatch(/UPDATE\s+public\.products\s+SET\s+stock/i);
  });

  it("impide que el navegador fabrique order o acreditación", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.pos_qr_apply_provider");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("el navegador puede fabricar una acreditacion QR");
  });

  it("usa Orders API dinámica, OAuth, expiración e idempotencia", () => {
    expect(edge).toContain('requireUser(req, corsHeaders)');
    expect(edge).toContain('`${MP_API}/v1/orders`');
    expect(edge).toContain('mode: "dynamic"');
    expect(edge).toContain('expiration_time: "PT15M"');
    expect(edge).toContain('"X-Idempotency-Key"');
    expect(edge).toContain("getMpCredentials");
    expect(edge).not.toContain("notification_url");
  });

  it("revalida webhooks de orders contra Mercado Pago", () => {
    expect(webhook).toContain('["order", "orders"].includes(type)');
    expect(webhook).toContain("verifyMpSignature");
    expect(webhook).toContain("fetchMercadoPagoOrder");
    expect(webhook).toContain("reconcileMercadoPagoPosQrOrder");
  });

  it("el POS espera acreditación y no cae en addSalesDB para QR", () => {
    const qrBranch = pos.indexOf('payMethod === "qr"');
    const directInsert = pos.indexOf("await addSalesDB(transactionLines", qrBranch);
    expect(qrBranch).toBeGreaterThan(-1);
    expect(pos).toContain("PosQrCheckoutDialog");
    expect(pos).toContain('action: "status"');
    expect(pos).toContain("await requestQrOrder(checkout);\n        return;");
    expect(directInsert).toBeGreaterThan(qrBranch);
  });
});
