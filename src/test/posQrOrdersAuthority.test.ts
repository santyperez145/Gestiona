import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260829000041_pos_qr_mercadopago_orders.sql"), "utf8");
const recoveryMigration = readFileSync(resolve(root, "supabase/migrations/20260829000042_pos_qr_se_recupera_solo.sql"), "utf8");
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

  it("el checkout QR también es alcanzable desde el carrito mobile", () => {
    expect(pos).toContain('aria-label={showCart ? "Cerrar carrito" : "Abrir carrito"}');
    expect(pos).toContain('aria-label="Cerrar carrito"');
  });

  it("reconcilia aunque Caja se cierre y no expone el cron al navegador", () => {
    expect(recoveryMigration).toContain("reconcile-pos-qr-orders");
    expect(recoveryMigration).toContain("public.invoke_edge_function('mercadopago-pos-qr')");
    expect(recoveryMigration).toContain("pos_qr_expire_orphans");
    expect(recoveryMigration).toContain("cashier_acknowledged_at");
    expect(recoveryMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(edge).toContain("exigirCron(req, corsHeaders)");
    expect(edge).toContain('mode: "cron-reconcile"');
    expect(edge).toContain('action === "recover"');
    expect(edge).toContain('action === "resume"');
  });

  it("al recuperar una venta no mezcla ni vacía el carrito actual", () => {
    expect(pos).toContain("checkout.recovered");
    expect(pos).toContain("El carrito actual no se modifica");
    expect(pos).toContain('action: "acknowledge"');
    expect(pos).toContain('action: "recover"');
    expect(pos).toContain('action: "resume"');
  });
});
