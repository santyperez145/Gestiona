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
  const orchestrator = read("supabase/functions/_shared/paymentOrchestrator.ts");
  const brick = read("src/storefront/StorePaymentBrick.tsx");
  const orderScreen = read("src/storefront/StoreOrder.tsx");

  it("relee la orden y cobra su total autoritativo, no el total del formulario", () => {
    expect(storePay).toContain('action === "brick-payment"');
    expect(storePay).toContain("getStoreOrder(admin, body.slug, body.orderNumber, body.accessToken)");
    expect(storePay).toMatch(/transaction_amount:\s*order\.total/);
    expect(storePay).not.toMatch(/transaction_amount:\s*(?:form|body|input)\./);
    expect(storePay).toContain("payment?.external_reference !== externalReference");
    expect(storePay).toContain("Math.abs(providerAmount - order.total) > 0.01");
  });

  it("hace el cobro directo idempotente y conserva la comisión de plataforma", () => {
    expect(storePay).toContain('"X-Idempotency-Key": providerIdempotencyKey');
    expect(storePay).toContain("preparePaymentAttempt");
    expect(storePay).toContain("providerIdempotencyKey");
    expect(storePay).toContain("recordPaymentAttempt(admin");
    expect(orchestrator).toContain('admin.rpc("pago_intento_preparar"');
    expect(storePay).toContain("application_fee: applicationFee");
    expect(storePay).toContain("getMpCredentials(admin, store.org_id)");
    expect(storePay).toContain("recordPaymentTransaction(admin");
  });

  it("comparte la liquidación real entre el pago embebido y el webhook", () => {
    expect(storePay).toContain('from "../_shared/paymentSettlement.ts"');
    expect(webhook).toContain('from "../_shared/paymentSettlement.ts"');
    expect(settlement).toContain('admin.rpc("record_payment_settlement"');
    expect(settlement).toContain('externalRef.startsWith("ecom:")');
    expect(webhook).toContain("settleOrchestratedPayment");
    expect(webhook).toContain('.from("payment_intents")');
    expect(webhook).toContain('.from("payment_attempts")');
  });

  it("mantiene el contrato de intento en la base y sólo lo expone a service_role", () => {
    const migration = read("supabase/migrations/20260821000044_checkout_payment_orchestration.sql");
    expect(migration).toContain("payment_attempts_client_key_unico");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("pago_intento_preparar");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.pago_intento_preparar");
    expect(migration).toContain("TO service_role");
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

  it("no reutiliza una orden revertida para volver a cobrar ni despachar", () => {
    expect(storePay).toContain('["pending", "failed"].includes(order.payment_status)');
    expect(webhook).toContain('status === "refunded" || status === "charged_back"');
  expect(webhook).toContain('admin.rpc("handle_store_order_payment_reversal"');
  expect(webhook).toContain("reconcilePendingStoreRefunds");
  expect(webhook).toContain("/v1/payments/${encodeURIComponent(paymentId)}/refunds");
  expect(webhook).toContain('admin.rpc("pago_reintegro_resultado"');
  expect(webhook).toContain('p_status: "refunded"');
  expect(webhook).toContain("localSameAmount.length === 1");
    expect(orderScreen).toContain("puedeReintentarPago");
  });
});
