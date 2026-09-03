/**
 * Carritos abandonados — cola operativa al estilo Shopify Abandoned checkouts.
 *
 * El cron `recover-abandoned-carts` manda el email UNA vez. Acá el comercio ve
 * la población y el estado del aviso; no inventa un segundo canal de envío.
 *
 * La cola tiene que coincidir con `pending_abandoned_carts`: active + email +
 * ítems + idle ≥1 h. Filtrar sólo `status=abandoned` escondía los recuperables
 * (el RPC de save deja active; abandoned aparece al vaciar el carrito).
 */

export interface AbandonedCartItem {
  name?: string;
  quantity?: number;
  unit_price?: number;
}

export interface AbandonedCartRow {
  id: string;
  status: string;
  customer_email: string | null;
  items: AbandonedCartItem[] | unknown;
  subtotal: number;
  total: number;
  abandoned_email_sent: boolean;
  updated_at: string;
  created_at: string;
}

export type AbandonedRecoveryState = "enviado" | "pendiente" | "sin_email";

/** Misma espera que `pending_abandoned_carts(1)` — no avisar a quien todavía compra. */
export const ABANDONED_CART_IDLE_MS = 60 * 60 * 1000;

export function abandonedCartItemCount(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, row) => {
    const qty = Number((row as AbandonedCartItem)?.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }, 0);
}

export function abandonedCartRecoveryState(row: {
  customer_email?: string | null;
  abandoned_email_sent?: boolean | null;
}): AbandonedRecoveryState {
  if (row.abandoned_email_sent) return "enviado";
  const email = String(row.customer_email ?? "").trim();
  if (!email) return "sin_email";
  return "pendiente";
}

export function abandonedCartRecoveryLabel(state: AbandonedRecoveryState): string {
  switch (state) {
    case "enviado":
      return "Aviso enviado";
    case "sin_email":
      return "Sin email";
    case "pendiente":
      return "Pendiente de aviso";
  }
}

export function abandonedCartRecoveryTone(state: AbandonedRecoveryState): string {
  if (state === "enviado") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (state === "sin_email") return "bg-muted text-muted-foreground border-0";
  return "bg-yellow-500/15 text-yellow-500 border-0";
}

export function isRecoverableAbandonedCart(
  row: Pick<AbandonedCartRow, "status" | "customer_email" | "items" | "updated_at">,
  nowMs = Date.now(),
  idleMs = ABANDONED_CART_IDLE_MS,
): boolean {
  if (abandonedCartItemCount(row.items) <= 0) return false;
  if (row.status === "converted") return false;
  if (row.status === "abandoned") return true;
  if (row.status !== "active") return false;
  if (!String(row.customer_email ?? "").trim()) return false;
  const updated = Date.parse(row.updated_at);
  if (Number.isNaN(updated)) return true;
  return nowMs - updated >= idleMs;
}

/** Cola = mismos carritos que el cron puede recuperar (+ abandoned con ítems). */
export function filterAbandonedCartsForQueue(
  rows: AbandonedCartRow[],
  nowMs = Date.now(),
  idleMs = ABANDONED_CART_IDLE_MS,
): AbandonedCartRow[] {
  return rows
    .filter((row) => isRecoverableAbandonedCart(row, nowMs, idleMs))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function abandonedCartsQueueHref(): string {
  return "/tienda-online?tab=carritos";
}
