import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260830000021_store_order_email_idempotency.sql");
const delivery = read("supabase/functions/_shared/storeOrderEmailDelivery.ts");
const sender = read("supabase/functions/_shared/smtpSender.ts");
const initialEmail = read("supabase/functions/store-order-email/index.ts");
const statusEmail = read("supabase/functions/store-order-status-email/index.ts");

describe("idempotencia durable de emails de órdenes", () => {
  it("identifica cada entrega por orden, audiencia y evento", () => {
    expect(migration).toContain("store_order_email_delivery_event_key");
    expect(migration).toContain("ecommerce_order_id, audience, event");
    expect(migration).toContain("'order_created', 'payment_confirmed', 'shipped', 'delivered'");
    expect(migration).toContain("'buyer', 'merchant'");
  });

  it("reclama atómicamente y recupera sólo un worker vencido", () => {
    expect(migration).toContain("ON CONFLICT (ecommerce_order_id, audience, event) DO NOTHING");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("make_interval(secs => v_lease_seconds)");
    expect(migration).toContain("claim_token = v_claim_token");
    expect(migration).toContain("AND claim_token = p_claim_token");
  });

  it("mantiene claim, proveedor y finish en operaciones separadas", () => {
    expect(delivery).toContain('admin.rpc("claim_store_order_email"');
    expect(delivery).toContain('admin.rpc("finish_store_order_email"');
    expect(delivery).not.toContain("fetch(");

    const claim = statusEmail.indexOf("claimStoreOrderEmail(admin");
    const provider = statusEmail.indexOf("await sendEmail(", claim);
    const finish = statusEmail.indexOf("finishStoreOrderEmail(admin, claim, result)", provider);
    expect(claim).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(claim);
    expect(finish).toBeGreaterThan(provider);
  });

  it("deduplica por separado confirmación, pago y aviso al comercio", () => {
    expect(initialEmail).toContain('pagado ? "payment_confirmed" : "order_created"');
    expect(initialEmail).toContain('audience: "buyer"');
    expect(initialEmail).toContain('audience: "merchant"');
    expect(initialEmail).toContain('event: "order_created"');
    expect(initialEmail).toContain("claim.duplicate");
    expect(initialEmail).toContain("claim.inProgress");
  });

  it("agrega la segunda barrera idempotente del proveedor Resend", () => {
    expect(sender).toContain('headers["Idempotency-Key"] = idempotencyKey');
    expect(sender).toContain("messageId");
    expect(initialEmail).toContain("{ idempotencyKey: claim.idempotencyKey }");
    expect(statusEmail).toContain("{ idempotencyKey: claim.idempotencyKey }");
  });

  it("no expone el ledger ni sus RPC al navegador", () => {
    expect(migration).toContain("REVOKE ALL ON TABLE public.store_order_status_email_log FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.claim_store_order_email");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.finish_store_order_email");
    expect(migration).toContain("TO service_role");
  });
});
