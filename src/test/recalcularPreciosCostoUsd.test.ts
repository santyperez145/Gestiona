import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("recalcular precios desde el costo en dólares", () => {
  const sql = readFileSync("supabase/migrations/20261023000400_recalcular_precios_costo_usd.sql", "utf8");
  const pantalla = readFileSync("src/pages/ProductsPage.tsx", "utf8");

  it("la base recalcula todo el negocio en un UPDATE, con permiso y sin tocar los que no tienen costo en dólares", () => {
    expect(sql).toContain("PERFORM public.exigir_permiso(p_org, 'products', 'edit'");
    expect(sql).toContain("WHERE p.org_id = p_org\n     AND COALESCE(p.cost_usd, 0) > 0");
    expect(sql).toContain("SET sale_price_ars = round(p.cost_usd * p_tipo_cambio * (1 + p_markup_pct / 100))");
    expect(sql).toContain("UPDATE public.settings SET exchange_rate = p_tipo_cambio WHERE org_id = p_org;");
  });

  it("la pantalla usa la base y sólo vuelve al recálculo anterior si falta la migración", () => {
    expect(pantalla).toContain('supabase.rpc("recalcular_precios_desde_costo_usd" as never');
    expect(pantalla).toContain("if (!isMissingFunction(rpcError)) throw new Error(rpcError.message);");
  });
});
