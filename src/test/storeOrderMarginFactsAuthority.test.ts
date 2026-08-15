import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814000019_store_order_sales_link.sql"),
  "utf8",
);

describe("hechos de margen de órdenes de tienda", () => {
  it("une la venta a su orden hacia adelante, sin adivinar vínculos históricos", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid");
    expect(migration).toContain("REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL");
    expect(migration).toContain("p_method, 'tienda_online', v_order.id");
    expect(migration).toContain("No se unen ventas históricas por heurística");
    expect(migration).toContain("guard_sales_ecommerce_order_link");
    expect(migration).toContain("auth.role() IN ('anon', 'authenticated')");
    expect(migration).toContain("La orden de tienda debe pertenecer a la misma organización");
  });

  it("prorratea conceptos de orden sin vender el envío cobrado como costo real", () => {
    expect(migration).toContain("CREATE OR REPLACE VIEW public.store_order_margin_facts");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("NULL::numeric AS carrier_shipping_cost_ars");
    expect(migration).toContain("payment_fee_total_ars");
    expect(migration).toContain("shipping_charged_ars");
    expect(migration).toContain("tax_ars");
    expect(migration).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
  });

  it("deja la lectura sólo a miembros autenticados", () => {
    expect(migration).toContain("REVOKE ALL ON TABLE public.store_order_margin_facts FROM PUBLIC, anon");
    expect(migration).toContain("GRANT SELECT ON TABLE public.store_order_margin_facts TO authenticated");
  });
});
