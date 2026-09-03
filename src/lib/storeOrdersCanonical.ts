/**
 * URLs canónicas de pedidos online y recuperación.
 * Conservan filtros operativos; nunca escriben tab=orders / tab=carritos.
 */
import { abandonedCartsQueueHref as abandonedQueueBase } from "@/lib/abandonedCarts";
import { stockAlertsQueueHref } from "@/lib/stockAlerts";

/** Pedidos: conserva vista/q/orden/medio/pedido; nunca tab=orders. */
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

/** Recuperación: abandonados (+ opcional reposición). Una sola fuente de href. */
export function abandonedCartsQueueHref(vista?: "reposicion" | null): string {
  if (vista === "reposicion") return stockAlertsQueueHref();
  return abandonedQueueBase();
}

/** Bookmarks viejos `?tab=carritos` → cola canónica. */
export function storeRecoveryCanonicalPath(
  search?: URLSearchParams | string | null,
): string {
  const src =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search
        ? new URLSearchParams(search)
        : new URLSearchParams();
  const vista = src.get("vista") === "reposicion" ? "reposicion" : null;
  return abandonedCartsQueueHref(vista);
}

export function parseStoreOrdersCola(raw: string | null | undefined): "pedidos" | "recuperacion" {
  return raw === "recuperacion" ? "recuperacion" : "pedidos";
}
