import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  consumeOrderAccessFragment,
  isOrderAccessToken,
  orderAccessFragment,
  readOrderAccessToken,
} from "@/storefront/orderAccess";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const token = "4b3e8d1b-6d8c-4bf4-9d4b-3e680bd752fa";

describe("acceso privado al pedido de tienda", () => {
  const migration = read("supabase/migrations/20260830000020_store_order_capability_access.sql");
  const dataSource = read("src/lib/publicDataSource.ts");
  const screen = read("src/storefront/StoreOrder.tsx");
  const checkout = read("src/storefront/StoreCheckout.tsx");
  const pay = read("supabase/functions/store-pay/index.ts");
  const email = read("supabase/functions/store-order-email/index.ts");
  const statusEmail = read("supabase/functions/store-order-status-email/index.ts");

  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/tienda/demo/orden/TN-1");
  });

  it("no acepta el número correlativo como autorización", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.get_store_order(text, text)");
    expect(migration).toContain("public.get_store_order_secure");
    expect(migration).toContain("o.public_access_token::text = btrim(p_access_token)");
    expect(migration).toContain("sc.user_id = auth.uid()");
    expect(migration).toContain("lower(btrim(o.customer_email)) = v_email");
    expect(migration).toContain("'store_order_access'");
    expect(migration).toContain("interval '10 minutes'");
  });

  it("da a cada pedido una capacidad aleatoria única y no nula", () => {
    expect(migration).toContain("SET DEFAULT gen_random_uuid()");
    expect(migration).toContain("SET NOT NULL");
    expect(migration).toContain("ecommerce_orders_public_access_token_key");
  });

  it("el cliente migra por firma inexistente, no por permisos ni errores de red", () => {
    expect(dataSource).toContain("get_store_order_secure");
    expect(dataSource).toContain("if (!isMissingFunction(secure.error))");
    expect(dataSource).toContain("'get_store_order' as never");
    expect(screen).toContain("getStoreOrderSecure");
    expect(screen).not.toContain('supabase.rpc("get_store_order"');
    expect(checkout).toContain("saveOrderAccessToken");
  });

  it("pago y email comparan la capacidad con la orden antes de operar", () => {
    expect(pay).toContain("order.public_access_token !== accessToken");
    expect(pay).toContain("body.accessToken");
    expect(email).toContain("order.public_access_token !== accessToken");
    expect(email).toContain('Deno.env.get("PUBLIC_BASE_URL")');
    expect(statusEmail).toContain("public_access_token");
  });

  it("guarda una capacidad válida en sesión y limpia el fragmento visible", () => {
    expect(isOrderAccessToken(token)).toBe(true);
    expect(isOrderAccessToken("TN-20260830-00001")).toBe(false);
    expect(orderAccessFragment(token)).toBe(`#access=${token}`);

    window.history.replaceState({}, "", `/tienda/demo/orden/TN-1#access=${token}`);
    expect(consumeOrderAccessFragment("demo", "TN-1")).toBe(token);
    expect(readOrderAccessToken("demo", "TN-1")).toBe(token);
    expect(window.location.hash).toBe("");
  });
});
