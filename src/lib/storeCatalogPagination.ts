export const STORE_CATALOG_PAGE_SIZE = 20;

export interface StoreCatalogPage {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Ventana determinista del PLP público.
 *
 * El catálogo completo todavía vive en el StoreContext porque home, carrito,
 * ficha y búsqueda comparten esa única lectura. Esta ventana evita montar
 * decenas o cientos de cards a la vez sin crear una segunda fuente de verdad.
 */
export function storeCatalogPage(
  total: number,
  requestedPage: string | number | null | undefined,
  pageSize = STORE_CATALOG_PAGE_SIZE,
): StoreCatalogPage {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safeSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : STORE_CATALOG_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const parsed = typeof requestedPage === "number"
    ? requestedPage
    : Number.parseInt(requestedPage ?? "1", 10);
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 1));
  const start = safeTotal === 0 ? 0 : (page - 1) * safeSize;
  const end = Math.min(safeTotal, start + safeSize);

  return {
    page,
    pageCount,
    start,
    end,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}
