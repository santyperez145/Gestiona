import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001300_total_vendido_al_dia.sql"), "utf8");

describe("products.total_sold al día", () => {
  it("se mantiene con cada alta, baja, devolución o cambio de producto en ventas", () => {
    expect(sql).toContain("AFTER INSERT OR DELETE OR UPDATE OF product_id, quantity, returned_quantity ON public.sales");
    expect(sql).toContain("GREATEST(0, coalesce(total_sold, 0) - public._unidades_de_venta(OLD.quantity, OLD.returned_quantity))");
  });

  it("las funciones internas no se ejecutan desde la app", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._total_vendido_al_dia() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public._unidades_de_venta(numeric, numeric) FROM PUBLIC, anon, authenticated;");
  });

  it("«Más vendidos» de la tienda ordena por ese contador", () => {
    const tienda = readFileSync(resolve(process.cwd(), "src/storefront/StoreProducts.tsx"), "utf8");
    expect(tienda).toContain('else if (orden === "vendidos") out.sort((a, b) => (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0));');
  });
});
