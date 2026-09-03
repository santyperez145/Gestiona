/**
 * Avisos de reposición — demanda OOS al estilo Shopify / Klaviyo Back in stock.
 *
 * El comprador pide aviso en el storefront; el cron `notify-back-in-stock`
 * manda UNA vez con link al producto. Acá el comercio ve la cola: sin UI era
 * built-but-dark (demanda real invisible).
 */

export interface StockAlertRow {
  id: string;
  email: string;
  product_id: string;
  variant_id: string | null;
  notified_at: string | null;
  created_at: string;
  /** Join opcional para la cola. */
  product_name?: string | null;
  product_stock?: number | null;
}

export type StockAlertState = "pendiente" | "listo_para_avisar" | "enviado";

export function stockAlertState(row: {
  notified_at?: string | null;
  product_stock?: number | null;
}): StockAlertState {
  if (row.notified_at) return "enviado";
  const stock = Number(row.product_stock);
  if (Number.isFinite(stock) && stock > 0) return "listo_para_avisar";
  return "pendiente";
}

export function stockAlertStateLabel(state: StockAlertState): string {
  switch (state) {
    case "enviado":
      return "Aviso enviado";
    case "listo_para_avisar":
      return "Hay stock — aviso pendiente";
    case "pendiente":
      return "Esperando reposición";
  }
}

export function stockAlertStateTone(state: StockAlertState): string {
  if (state === "enviado") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (state === "listo_para_avisar") return "bg-yellow-500/15 text-yellow-500 border-0";
  return "bg-muted text-muted-foreground border-0";
}

/** Cola operativa: todavía no avisados. */
export function filterPendingStockAlerts(rows: StockAlertRow[]): StockAlertRow[] {
  return rows
    .filter((row) => !row.notified_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function countPendingStockAlerts(rows: StockAlertRow[]): number {
  return filterPendingStockAlerts(rows).length;
}

/** Agrupa demanda por producto para el Pulse (≤5 oportunidades). */
export function stockAlertsByProduct(rows: StockAlertRow[]): {
  productId: string;
  name: string;
  waiting: number;
  ready: number;
}[] {
  const map = new Map<string, { productId: string; name: string; waiting: number; ready: number }>();
  for (const row of filterPendingStockAlerts(rows)) {
    const key = row.product_id;
    const cur = map.get(key) ?? {
      productId: key,
      name: String(row.product_name ?? "Producto").trim() || "Producto",
      waiting: 0,
      ready: 0,
    };
    const state = stockAlertState(row);
    if (state === "listo_para_avisar") cur.ready += 1;
    else cur.waiting += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (b.ready + b.waiting) - (a.ready + a.waiting));
}

export function stockAlertsQueueHref(): string {
  return "/tienda-online?tab=carritos&vista=reposicion";
}
