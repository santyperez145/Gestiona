/**
 * URL canónica de la cola de pedidos online.
 * Conserva filtros operativos; nunca escribe tab=orders (esa superficie murió).
 */
export function storeOrdersCanonicalPath(
  search?: URLSearchParams | string | null,
): string {
  const src =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search
        ? new URLSearchParams(search)
        : new URLSearchParams();
  const out = new URLSearchParams();
  for (const key of ["vista", "q", "orden", "medio", "pedido"] as const) {
    const value = src.get(key)?.trim();
    if (value) out.set(key, value);
  }
  const qs = out.toString();
  return qs ? `/pedidos-online?${qs}` : "/pedidos-online";
}
