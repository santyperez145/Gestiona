import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeDraftInicial, storeFormDesdeFila } from "@/lib/storeDraft";

const sql = readFileSync("supabase/migrations/20261023000300_reserva_local_tienda.sql", "utf8");

describe("reserva de stock para el local en la tienda online", () => {
  it("la vitrina muestra el stock menos la reserva, nunca negativo", () => {
    expect(sql.match(/GREATEST\(product\.stock - t\.reserva_local, 0\) AS stock/g)).toHaveLength(2); // completo e inicio
    expect(sql).toContain("GREATEST(product.stock - COALESCE(store.reserva_local, 0), 0)");
    expect(sql).toContain("GREATEST(variant.stock - COALESCE(store.reserva_local, 0), 0)");
  });

  it("el carrito y el checkout la respetan sólo con contexto de tienda", () => {
    expect(sql).toContain("v_disp := public.stock_disponible(p_product_id, NULL) - v_reserva;");
    expect(sql).toContain("v_disp := public.stock_disponible(p_product_id, p_variant_id) - v_reserva;");
    expect(sql).toContain("FROM public.ecommerce_stores store WHERE store.id = v_store_id;");
    expect(sql).toContain("ALTER FUNCTION public.stock_en_vitrina(text, jsonb) VOLATILE;");
  });

  it("el borrador de la tienda lee y arranca la reserva", () => {
    expect(storeDraftInicial(undefined, "global").reserva_local).toBe("0");
    expect(storeFormDesdeFila({ reserva_local: 2 } as never, "global").reserva_local).toBe("2");
  });

  it("guardar la tienda no se rompe si falta la columna", () => {
    const pagina = readFileSync("src/pages/EcommerceStorePage.tsx", "utf8");
    expect(pagina).toContain("if (error && isMissingColumn(error)) {");
    expect(pagina).toContain('htmlFor="tienda-reserva-local"');
  });
});
