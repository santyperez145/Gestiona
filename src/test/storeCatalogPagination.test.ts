import { describe, expect, it } from "vitest";
import { STORE_CATALOG_PAGE_SIZE, storeCatalogPage } from "@/lib/storeCatalogPagination";

describe("paginación del catálogo público", () => {
  it("monta veinte productos por página y conserva el total", () => {
    expect(STORE_CATALOG_PAGE_SIZE).toBe(20);
    expect(storeCatalogPage(60, "1")).toEqual({
      page: 1,
      pageCount: 3,
      start: 0,
      end: 20,
      hasPrevious: false,
      hasNext: true,
    });
    expect(storeCatalogPage(60, "2")).toEqual({
      page: 2,
      pageCount: 3,
      start: 20,
      end: 40,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it("cierra la última página sin inventar filas", () => {
    expect(storeCatalogPage(43, 3)).toMatchObject({
      page: 3,
      pageCount: 3,
      start: 40,
      end: 43,
      hasPrevious: true,
      hasNext: false,
    });
  });

  it("normaliza páginas inválidas y el catálogo vacío", () => {
    expect(storeCatalogPage(60, "basura").page).toBe(1);
    expect(storeCatalogPage(60, -8).page).toBe(1);
    expect(storeCatalogPage(60, 99).page).toBe(3);
    expect(storeCatalogPage(0, 4)).toEqual({
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});
