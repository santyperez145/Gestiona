import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migracion = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260902000110_tienda_siembra_zonas.sql"),
  "utf8",
);
const focoUi = readFileSync(
  resolve(__dirname, "../components/dashboard/FocoDelDia.tsx"),
  "utf8",
);

/**
 * Crear la tienda tiene que sembrar las 6 zonas de Argentina.
 *
 * Medido 2026-09-02: pruebas Workspace 0 tiendas / 0 zonas. Completar
 * tarifario y el Foco de «zonas sin tarifa» no existen sin filas. El botón de
 * Envíos era un clic extra: Tiendanube/Shopify siembran regiones al crear.
 */
describe("al nacer la tienda nacen las zonas", () => {
  it("el INSERT de ecommerce_stores dispara el seed", () => {
    expect(migracion).toContain("AFTER INSERT ON public.ecommerce_stores");
    expect(migracion).toContain("EXECUTE FUNCTION public.trg_ecommerce_store_seed_zones()");
    expect(migracion).toContain("PERFORM public.seed_default_shipping_zones(NEW.org_id)");
  });

  it("la RPC del panel no siembra una org ajena", () => {
    expect(migracion).toContain("is_org_member(p_org_id, auth.uid())");
    expect(migracion).toContain("ERRCODE = '42501'");
  });

  it("el seed sigue siendo las 6 zonas y no pisa las que ya están", () => {
    expect(migracion).toContain("ON CONFLICT (org_id, name) DO NOTHING");
    expect(migracion).toContain("'CABA'");
    expect(migracion).toContain("'Patagonia'");
    expect(migracion).toContain("se esperaban 6 zonas");
  });

  it("el Foco cuenta zonas activas, no sólo las que faltan de tarifa", () => {
    expect(focoUi).toContain("setZonasActivas");
    expect(focoUi).toContain("zonasActivas");
  });
});
