import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * El Brick es una superficie de pago anónima. Estas guardas son deliberadamente
 * estáticas: una prueba unitaria no puede usar una tarjeta real, pero sí puede
 * impedir que una edición futura vuelva a confiar en el importe del navegador.
 */
describe("Checkout Brick de tienda", () => {
  const storePay = read("supabase/functions/store-pay/index.ts");
  const webhook = read("supabase/functions/mercadopago-webhook/index.ts");
  const settlement = read("supabase/functions/_shared/paymentSettlement.ts");
  const brick = read("src/storefront/StorePaymentBrick.tsx");
  const orderScreen = read("src/storefront/StoreOrder.tsx");

  it("relee la orden y cobra su total autoritativo, no el total del formulario", () => {
    expect(storePay).toContain('action === "brick-payment"');
    expect(storePay).toContain("getStoreOrder(admin, body.slug, body.orderNumber)");
    expect(storePay).toMatch(/transaction_amount:\s*order\.total/);
    expect(storePay).not.toMatch(/transaction_amount:\s*(?:form|body|input)\./);
    expect(storePay).toContain("payment?.external_reference !== externalReference");
    expect(storePay).toContain("Math.abs(providerAmount - order.total) > 0.01");
  });

  it("hace el cobro directo idempotente y conserva la comisión de plataforma", () => {
    expect(storePay).toContain('"X-Idempotency-Key": input.attemptKey');
    expect(storePay).toContain("application_fee: applicationFee");
    expect(storePay).toContain('creds.source !== "oauth"');
    expect(storePay).toContain("recordPaymentTransaction(admin");
  });

  it("comparte la liquidación real entre el pago embebido y el webhook", () => {
    expect(storePay).toContain('from "../_shared/paymentSettlement.ts"');
    expect(webhook).toContain('from "../_shared/paymentSettlement.ts"');
    expect(settlement).toContain('admin.rpc("record_payment_settlement"');
    expect(settlement).toContain('externalRef.startsWith("ecom:")');
  });

  it("usa campos seguros de MercadoPago y conserva otra vía de pago", () => {
    expect(brick).toContain("initMercadoPago(config.publicKey");
    expect(brick).toContain('action: "brick-payment"');
    expect(brick).toContain("attemptKey: attemptKey.current");
    expect(brick).toContain("creditCard: \"all\"");
    expect(brick).toContain("debitCard: \"all\"");
    expect(orderScreen).toContain("pagoEnProceso");
    expect(orderScreen).toContain("No hace falta que lo intentes otra vez.");
  });
});
