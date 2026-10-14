import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Medido 2026-10-13: las vistas del catálogo por WhatsApp se leían sin login
// y sin filtro. Una consulta bajaba precio y stock de todos los negocios (777
// productos de Famatina, sin tienda publicada) y el WhatsApp de cada uno.
const sql = fs.readFileSync("supabase/migrations/20261013000600_catalogo_publico_por_id.sql", "utf8");
const front = fs.readFileSync("src/lib/publicDataSource.ts", "utf8");

describe("catálogo público de a un negocio", () => {
  it("las vistas quedan sin anon ni authenticated", () => {
    for (const v of ["catalog_products", "products_public", "catalog_settings", "settings_public", "catalog_product_variants"]) {
      expect(sql).toContain(`'${v}'`);
    }
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon, authenticated");
  });

  it("la función pública pide un id, tiene tope por IP y no toca la vista de la tienda", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.catalogo_publico\(p_id uuid\)/);
    expect(sql).toContain("rate_limit_publico('catalogo_publico'");
    expect(sql).not.toMatch(/REVOKE[^;]*store_catalog_products/);
  });

  it("el front pide por la función y cae a las vistas sólo si todavía no existe", () => {
    expect(front).toContain("supabase.rpc('catalogo_publico' as never");
    expect(front).toMatch(/if \(error && isMissingFunction\(error\)\) return \{ data: null, error: null \}/);
    for (const fn of ["fetchCatalogProducts", "fetchCatalogSettings", "fetchCatalogBranding"]) {
      const i = front.indexOf(`export async function ${fn}(`);
      expect(front.slice(i, i + 500)).toContain("leerCatalogoPublico(");
    }
    expect(front).toContain("supabase.rpc('catalogo_publico_variantes' as never");
  });
});
