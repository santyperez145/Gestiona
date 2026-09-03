/**
 * Vacío del catálogo público: first-use vs filtros.
 * ESTANDAR §9 / Shopify-Tiendanube: no el mismo copy para los dos.
 */

export type StoreCatalogEmptyKind = "first_use" | "filtered" | "none";

export function storeCatalogEmptyKind(input: {
  catalogCount: number;
  filteredCount: number;
  /** Búsqueda o filtros distintos del orden. */
  hasActiveFilters: boolean;
}): StoreCatalogEmptyKind {
  if (input.filteredCount > 0) return "none";
  if (input.catalogCount === 0) return "first_use";
  if (input.hasActiveFilters) return "filtered";
  // Catálogo con ítems pero filtrados a cero sin filtros activos:
  // p.ej. stock agotado en listado que solo muestra disponibles — rare.
  return "filtered";
}
