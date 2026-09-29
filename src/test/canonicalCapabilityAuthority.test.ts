import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("autoridad canónica de capacidades", () => {
  it("mantiene una sola importación de catálogo y la conecta a Productos", () => {
    const page = read("src/pages/ProductsPage.tsx");
    const importer = read("src/components/products/ProductsExcelImport.tsx");

    expect(page).toContain('import ProductsExcelImport from "@/components/products/ProductsExcelImport"');
    expect(page).toContain("<ProductsExcelImport");
    expect(importer).toContain('supabase.rpc("stage_catalog_migration"');
    expect(importer).toContain('supabase.rpc("apply_catalog_migration"');
    expect(importer).not.toContain("setTimeout");
    expect(existsSync(resolve(root, "src/components/products/MigrationWizard.tsx"))).toBe(false);
  });

  it("mantiene un solo Inbox Finance respaldado por la superficie canónica", () => {
    const routeManifest = read("src/app/routeManifest.ts");
    const page = read("src/pages/FinanceDocumentsPage.tsx");

    expect(routeManifest).toContain('path: "/finance/documentos"');
    expect(page).toContain("financeDocumentNextAction");
    expect(page).toContain("FinanceDocumentInspector");
    expect(existsSync(resolve(root, "src/components/finance/FinanceInbox.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/lib/financeInbox.ts"))).toBe(false);
  });

  it("no publica clientes de RPC sin una autoridad desplegable", () => {
    const removedClients = [
      ["src", "lib", "storeCollection.ts"],
      ["src", "lib", "posInventory.ts"],
      ["src", "storefront", "StoreInventory.tsx"],
    ];
    for (const path of removedClients) {
      expect(existsSync(resolve(root, ...path))).toBe(false);
    }
  });
});
