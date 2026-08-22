import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260821000060_product_import_staging.sql"), "utf8");
const importer = readFileSync(resolve(root, "src/components/products/ProductsExcelImport.tsx"), "utf8");
const productsPage = readFileSync(resolve(root, "src/pages/ProductsPage.tsx"), "utf8");

describe("autoridad de la importación de productos", () => {
  it("prepara y aplica el lote mediante RPC, nunca escribiendo products desde el navegador", () => {
    expect(importer).toContain('rpc("stage_product_import"');
    expect(importer).toContain('rpc("apply_product_import"');
    expect(importer).not.toMatch(/\.from\(["']products["']\)\s*\.(insert|update|upsert)/);
  });

  it("consolida Excel y CSV en una sola experiencia", () => {
    expect(productsPage).toContain("Importar Excel/CSV");
    expect(productsPage).not.toContain("CSVImportWizard");
    expect(productsPage.match(/<ProductsExcelImport/g)).toHaveLength(1);
  });

  it("crea productos en cero y mueve el stock sólo por el motor de Kardex", () => {
    expect(migration).toMatch(/profit_per_unit_usd, stock,[\s\S]*?\n\s*0,/);
    expect(migration).toContain("PERFORM public.record_stock_movement(");
    expect(migration).not.toMatch(/UPDATE public\.products[\s\S]{0,180}SET stock/);
  });

  it("exige owner o admin tanto al preparar como al aplicar", () => {
    expect(migration.match(/has_org_role\([\s\S]{0,100}ARRAY\['owner','admin'\]\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("no permite que el cliente saltee los RPC ni que anon lea el staging", () => {
    expect(migration).toContain("REVOKE ALL ON public.product_import_batches, public.product_import_rows FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON public.product_import_batches, public.product_import_rows TO authenticated");
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}(INSERT|UPDATE|DELETE)/);
  });

  it("bloquea filas inválidas salvo aprobación explícita", () => {
    expect(migration).toContain("v_batch.invalid_rows > 0 AND NOT p_skip_invalid");
    expect(importer).toContain("Confirmá si querés omitir las filas inválidas");
  });

  it("reconcilia todas las filas válidas y hace idempotente el reintento", () => {
    expect(migration).toContain("v_applied <> v_batch.valid_rows");
    expect(migration).toContain("v_batch.status IN ('completed', 'completed_with_errors')");
    expect(migration).toContain("'reused', true");
  });

  it("reutiliza retries abiertos pero permite una reimportación futura intencional", () => {
    expect(migration).toContain("WHERE status IN ('staged', 'applying')");
    expect(migration).not.toContain("WHERE status IN ('staged', 'applying', 'completed', 'completed_with_errors')");
  });

  it("una fila vacía no pisa campos existentes", () => {
    expect(migration).toContain("v_provided ? 'brand'");
    expect(migration).toContain("v_provided ? 'sale_price_ars'");
    expect(importer).toContain("buildProductImportRow");
  });
});
