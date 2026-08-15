import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const ROOT = process.cwd();
const sourceFiles = sourcesUnder(resolve(ROOT, "src"));
const directProductStockWrite = /\.from\(\s*(['"])products\1\s*\)\s*\.update\(\s*\{\s*stock\s*:/;
const directVariantStockWrite = /\.from\(\s*(['"])product_variants\1\s*\)\s*\.update\(\s*\{\s*stock\s*:/;

describe("autoridad de stock", () => {
  it("el navegador no actualiza products.stock ni product_variants.stock de forma directa", () => {
    const writes = sourceFiles
      .filter(file => directProductStockWrite.test(readFileSync(file, "utf8")) || directVariantStockWrite.test(readFileSync(file, "utf8")))
      .map(file => file.replace(ROOT, ""));

    expect(writes, "usá adjust_stock o record_stock_movement: la base es la única autoridad de stock").toEqual([]);
  });

  it("la capa compartida rechaza mutaciones accidentales y delega el ajuste a la base", () => {
    const store = readFileSync(resolve(ROOT, "src/lib/supabaseStore.ts"), "utf8");
    expect(store).toContain("setStockAbsoluteDB");
    expect(store).toContain(".rpc('adjust_stock'");
    expect(store).toContain("El stock se ajusta mediante Kardex");
    expect(store).toContain("El stock de una variante se ajusta mediante Kardex");
  });

  it("los flujos que antes sumaban o fijaban stock pasan por movimientos de base", () => {
    const purchases = readFileSync(resolve(ROOT, "src/pages/PurchasesPage.tsx"), "utf8");
    const invoices = readFileSync(resolve(ROOT, "src/pages/InvoicesPage.tsx"), "utf8");
    const publicApi = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");

    expect(purchases).toContain("trg_purchase_stock_movement");
    expect(invoices).toContain('rpc("record_stock_movement"');
    expect(publicApi).toContain('rpc("adjust_stock"');
  });
});
