import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const webhook = readFileSync(resolve(ROOT, "supabase/functions/meli-webhook/index.ts"), "utf8");
const migration = readFileSync(resolve(ROOT, "supabase/migrations/20260814000020_meli_webhook_orders.sql"), "utf8");
const oauth = readFileSync(resolve(ROOT, "supabase/functions/meli-oauth/index.ts"), "utf8");
const deployPs = readFileSync(resolve(ROOT, "scripts/deploy-functions.ps1"), "utf8");
const deploySh = readFileSync(resolve(ROOT, "scripts/deploy-functions.sh"), "utf8");

describe("webhook de órdenes MercadoLibre", () => {
  it("encola de forma privada e idempotente y no permite duplicar un vendedor entre organizaciones", () => {
    expect(migration).toContain("meli_connections_unique_seller_idx");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.meli_webhook_events");
    expect(migration).toContain("UNIQUE (org_id, notification_id)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.enqueue_meli_webhook_event");
    expect(migration).toContain("TO service_role;");
    expect(oauth).toContain("Esta cuenta de MercadoLibre ya está conectada a otra organización");
  });

  it("usa el callback sólo como señal y vuelve a consultar la orden oficial del vendedor", () => {
    expect(webhook).toContain('topic !== "orders"');
    expect(webhook).toContain("/^\\/orders\\/(\\d+)$/");
    expect(webhook).toContain('admin.rpc("enqueue_meli_webhook_event"');
    expect(webhook).toContain("EdgeRuntime.waitUntil");
    expect(webhook).toContain("/orders/${encodeURIComponent(orderId)}");
    expect(webhook).toContain("String(order.seller?.id) !== String(connection.meli_user_id)");
    expect(webhook).toContain('admin.from("meli_orders").upsert');
    expect(webhook).not.toContain("import_meli_order_as_sales");
  });

  it("concilia el cargo real de envío sin transformar una ausencia en cero", () => {
    expect(webhook).toContain("seller_shipping_cost_ars === null");
    expect(webhook).toContain("/shipments/${encodeURIComponent(shipmentId)}/costs");
    expect(webhook).toContain('admin.rpc("apply_meli_shipping_cost"');
    expect(webhook).toContain("shipping_cost_error");
    expect(webhook).not.toContain("Math.max(0");
  });

  it("se despliega explícitamente como callback público en ambos scripts", () => {
    expect(deployPs).toContain('"meli-webhook"');
    expect(deploySh).toContain('"meli-webhook"');
  });
});
