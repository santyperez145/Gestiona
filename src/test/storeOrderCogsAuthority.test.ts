import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814000017_store_order_cogs.sql"),
  "utf8",
);

describe("ventas cobradas de la tienda", () => {
  it("persiste el costo real de mercadería junto con la ganancia", () => {
    expect(migration).toContain("cost_per_unit_usd, cost_of_goods_ars");
    expect(migration).toContain("round(v_cost_ars * v_qty, 2)");
    expect(migration).toContain("v_profit   := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty");
  });

  it("deja el stock al trigger, conserva idempotencia y no expone el RPC", () => {
    expect(migration).toContain("IF v_order.payment_status = 'paid' THEN");
    expect(migration).not.toContain("UPDATE public.products SET stock");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.mark_store_order_paid");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("v_cogs <> 4 OR v_profit <> 496 OR v_stock <> 2 OR v_sales <> 1");
    expect(migration).toContain("Store COGS dejó filas ZZ");
  });
});
