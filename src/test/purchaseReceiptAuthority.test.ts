import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814000022_purchase_receipt_authority.sql"),
  "utf8",
);

describe("autoridad de recepción de órdenes de compra", () => {
  it("serializa la orden y cada renglón antes de calcular lo pendiente", () => {
    expect(migration).toContain("FROM public.purchase_orders po\n   WHERE po.id = p_order_id\n   FOR UPDATE");
    expect(migration).toContain("AND i.order_id = p_order_id\n     FOR UPDATE");
    expect(migration).toContain("v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0)");
  });

  it("alinea el RPC DEFINER con los roles que pueden modificar compras", () => {
    expect(migration).toContain("public.has_org_role(v_org, v_user, ARRAY['owner', 'admin'])");
    expect(migration).toContain("v_status NOT IN ('confirmed', 'partially_received')");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.receive_purchase_order");
    expect(migration).toContain("TO authenticated");
  });

  it("mueve stock a través de purchases y prueba rol, parcial, total y limpieza", () => {
    expect(migration).toContain("INSERT INTO public.purchases");
    expect(migration).not.toContain("UPDATE public.products SET stock");
    expect(migration).toContain("Un JWT ajeno pudo recibir una orden de compra");
    expect(migration).toContain("v_status <> 'partially_received'");
    expect(migration).toContain("v_status <> 'received'");
    expect(migration).toContain("Purchase receipt authority dejó filas ZZ");
  });
});
