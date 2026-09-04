import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260904000140_catalog_migration.sql"), "utf8");
const importer = readFileSync(resolve(root, "src/components/products/ProductsExcelImport.tsx"), "utf8");
const integrations = readFileSync(resolve(root, "src/pages/IntegrationsPage.tsx"), "utf8");
const storefront = readFileSync(resolve(root, "src/pages/StorefrontPage.tsx"), "utf8");

describe("autoridad de migración de catálogo", () => {
  it("usa un único staging server-side para todos los orígenes", () => {
    expect(importer).toContain('rpc("stage_catalog_migration"');
    expect(importer).toContain('rpc("apply_catalog_migration"');
    expect(integrations).not.toContain("TiendanubeExcelImport");
    expect(integrations).toContain('/productos?importar=1');
  });

  it("no permite escrituras directas de producto, variante, stock ni redirect", () => {
    expect(importer).not.toMatch(/\.from\(["'](?:products|product_variants|store_url_redirects)["']\)\s*\.(?:insert|update|upsert)/);
    expect(migration).toContain("PERFORM public.record_stock_movement(");
    expect(migration).toContain("REVOKE ALL ON public.catalog_import_identities, public.store_url_redirects");
  });

  it("conserva identidad externa y reconcilia todas las variantes", () => {
    expect(migration).toContain("catalog_import_identities");
    expect(migration).toContain("v_variant_applied <> v_batch.variant_rows");
    expect(migration).toContain("catalog_applied_at IS NOT NULL");
  });

  it("resuelve redirects dentro de la misma tienda y sólo si está publicada", () => {
    expect(migration).toContain("resolve_store_url_redirect");
    expect(migration).toContain("store.published_at IS NOT NULL");
    expect(migration).toContain("redirect.destination_path <> v_path");
    expect(storefront).toContain("<StoreLegacyRedirect");
  });

  it("registra el RPC público en el contrato de seguridad", () => {
    expect(migration).toContain("INSERT INTO public.security_function_contracts");
    expect(migration).toContain("'public_storefront'");
  });
});
