import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814000021_store_order_customer_link.sql"),
  "utf8",
);

describe("ventas de tienda enlazadas al cliente CRM", () => {
  it("resuelve la identidad por email antes de insertar la venta", () => {
    expect(migration).toContain("v_customer_id := public.upsert_customer_from_order(v_order.id)");
    expect(migration).toContain("customer_id, customer_name, date, paid");
    expect(migration).toContain("v_customer_id, v_order.customer_name, now(), true");
  });

  it("no deja que un fallo accesorio de CRM impida acreditar el cobro", () => {
    expect(migration).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(migration).toContain("upsert_customer_from_order falló antes de crear ventas");
    expect(migration).toContain("v_customer_id := NULL");
  });

  it("prueba un homónimo de otro email y conserva la autoridad del stock en el trigger", () => {
    expect(migration).toContain("ZZ Cliente Homónimo");
    expect(migration).toContain("v_sale_customer_id = v_decoy_customer_id");
    expect(migration).toContain("zz-comprador-");
    expect(migration).not.toContain("UPDATE public.products SET stock");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.mark_store_order_paid");
  });
});
