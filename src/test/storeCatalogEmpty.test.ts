import { describe, expect, it } from "vitest";
import { storeCatalogEmptyKind } from "@/lib/storeCatalogEmpty";

describe("storeCatalogEmptyKind", () => {
  it("catálogo vacío = first_use, no culpa a filtros", () => {
    expect(
      storeCatalogEmptyKind({
        catalogCount: 0,
        filteredCount: 0,
        hasActiveFilters: false,
      }),
    ).toBe("first_use");
  });

  it("hay productos pero filtros sin match = filtered", () => {
    expect(
      storeCatalogEmptyKind({
        catalogCount: 10,
        filteredCount: 0,
        hasActiveFilters: true,
      }),
    ).toBe("filtered");
  });

  it("con resultados no es vacío", () => {
    expect(
      storeCatalogEmptyKind({
        catalogCount: 10,
        filteredCount: 3,
        hasActiveFilters: true,
      }),
    ).toBe("none");
  });
});
