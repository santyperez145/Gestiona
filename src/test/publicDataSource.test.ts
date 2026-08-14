import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("publicDataSource catalog columns", () => {
  it("keeps storefront-only pricing columns out of the WhatsApp catalog query", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const catalogSection = source.slice(
      source.indexOf("export async function fetchCatalogProducts"),
      source.indexOf("export interface CatalogSettings"),
    );

    expect(catalogSection).toContain("PRODUCT_COLUMNS_WITH_DECANTS");
    expect(catalogSection).not.toContain("STORE_PRODUCT_COLUMNS_WITH_DECANTS");
    expect(source).toContain("const STORE_PRODUCT_COLUMNS_WITH_DECANTS");
  });
});
