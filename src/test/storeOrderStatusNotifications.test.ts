import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260815000002_store_order_status_notifications.sql"),
  "utf8",
);
const edge = readFileSync(
  resolve(process.cwd(), "supabase/functions/store-order-status-email/index.ts"),
  "utf8",
);
const deliveryMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000021_store_order_email_idempotency.sql"),
  "utf8",
);

describe("avisos de estado de órdenes de tienda", () => {
  it("deja el cambio de estado en un RPC autenticado y hacia adelante", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.update_store_order_fulfillment");
    expect(migration).toContain("public.has_permission(v_order.org_id, 'ecommerce', 'edit')");
    expect(migration).toContain("v_status NOT IN ('shipped', 'delivered')");
    expect(migration).toContain("Primero prepará el envío de la orden");
    expect(migration).toContain("La orden tiene que estar en camino antes de marcarse entregada");
    expect(migration).toContain("La orden no está en un estado que se pueda despachar");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.update_store_order_fulfillment(uuid, text) TO authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.update_store_order_fulfillment(uuid, text) FROM PUBLIC, anon, authenticated");
  });

  it("guarda fechas en la base y no permite que un tracking revierta una entrega", () => {
    expect(migration).toContain("CREATE TRIGGER trg_store_order_fulfillment_timestamps");
    expect(migration).toContain("NEW.shipped_at := COALESCE(NEW.shipped_at, now())");
    expect(migration).toContain("NEW.delivered_at := COALESCE(NEW.delivered_at, now())");
    expect(migration).toContain("La orden ya fue marcada como entregada");
  });

  it("protege el gasto de email y hace cada aviso idempotente", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.store_order_status_email_log");
    expect(migration).toContain("REVOKE ALL ON TABLE public.store_order_status_email_log FROM PUBLIC, anon, authenticated");
    expect(deliveryMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_store_order_email");
    expect(deliveryMigration).toContain("FOR UPDATE");
    expect(deliveryMigration).toContain("ecommerce_order_id, audience, event");
    expect(edge).toContain("requireUser(req, corsHeaders)");
    expect(edge).toContain("claimStoreOrderEmail(admin");
    expect(edge).toContain("finishStoreOrderEmail(admin, claim, result)");
    expect(edge).toContain('userClient.rpc("has_permission"');
  });

  it("Marcar cobrado avisa payment_confirmed (transferencia = ATM)", () => {
    expect(edge).toContain('"payment_confirmed"');
    expect(edge).toContain('payment_status !== "paid"');
    const page = readFileSync(
      resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"),
      "utf8",
    );
    expect(page).toContain("confirmar_pago_manual_tienda");
    expect(page).toContain('event: "payment_confirmed"');
    expect(page).toContain("store-order-status-email");
  });
});
