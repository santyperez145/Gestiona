import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const productsPage = readFileSync(resolve(root, "src/pages/ProductsPage.tsx"), "utf8");
const productTable = readFileSync(resolve(root, "src/components/products/ProductTableOwn.tsx"), "utf8");
const excelImport = readFileSync(resolve(root, "src/components/products/ProductsExcelImport.tsx"), "utf8");
const importSql = readFileSync(resolve(root, "supabase/migrations/20261003000200_catalog_import_sessions.sql"), "utf8");

describe("mejoras y correcciones en la gestión de productos", () => {
  it("conecta la edición inline de stock mediante el motor de Kardex (setStockAbsoluteDB)", () => {
    // La celda de stock en la tabla invoca onStockChange y ProductsPage delega
    // en setStockAbsoluteDB: nunca escribe products.stock directamente.
    expect(productTable).toContain("onStockChange?: (id: string, newStock: number) => Promise<void> | void");
    expect(productTable).toContain("StockCell");
    expect(productsPage).toContain("onStockChange={canEdit ? handleInlineStockChange : undefined}");
    expect(productsPage).toContain("await setStockAbsoluteDB({");
    // El estado huérfano anterior (editingStock/saveInlineStock sin input) fue eliminado.
    expect(productsPage).not.toContain("const [editingStock, setEditingStock]");
  });

  it("conecta el modal de Historial de Precios desde la tabla de productos", () => {
    // onPriceHistory permite ver el log auditado de variaciones de precio
    expect(productTable).toContain("onPriceHistory?: (id: string) => void");
    expect(productTable).toContain("Historial de precios");
    expect(productsPage).toContain("onPriceHistory={(id) => { const product = items.find(p => p.id === id); if (product) setPriceHistoryProduct({ id: product.id, name: product.name }); }}");
    expect(productsPage).toContain("<PriceHistoryModal");
  });

  it("ajuste masivo valida cotización ANTES del loop para no dejar el catálogo a medias", () => {
    // El bug anterior tenía `if (cotizacionInline === null ...) return` dentro
    // del loop, abortando la actualización a mitad de camino.
    const handleApplyIdx = productsPage.indexOf("const handleApply = async () => {");
    const loopIdx = productsPage.indexOf("for (const p of toUpdate) {", handleApplyIdx);
    const checkIdx = productsPage.indexOf("if (cotizacionInline === null)", handleApplyIdx);
    expect(checkIdx).toBeGreaterThan(handleApplyIdx);
    expect(checkIdx).toBeLessThan(loopIdx);
  });

  it("el servidor valida el cupo de todo el archivo antes de aprobar el primer lote", () => {
    const approval = importSql.slice(importSql.indexOf("CREATE OR REPLACE FUNCTION public.approve_catalog_import("), importSql.indexOf("CREATE OR REPLACE FUNCTION public.apply_catalog_import_chunk("));
    expect(approval).toContain("public.organization_plan_limits(v_session.org_id)");
    expect(approval).toContain("v_current + (v_status->>'creates')::int > v_max");
    expect(approval.indexOf("El catálogo supera el límite")).toBeLessThan(approval.indexOf("SET status = 'applying'"));
    expect(excelImport.indexOf("await approveCatalogImport(stage.id, skipInvalid)")).toBeLessThan(excelImport.indexOf("await applyCatalogImportChunk(next.id, previousApplied)"));
  });
});
