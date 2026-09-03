import { esMedioGestionaPay } from "@/lib/gestionaPay";

/**
 * El estado del pago de una orden de tienda es una decisión operativa: no basta
 * con pintarlo. Una devolución o contracargo no autoriza otro despacho ni otro
 * intento de cobro sobre la misma orden.
 */

/**
 * Ventana en la que un cobro digital (Nerqia Pay / Mercado Pago) sigue
 * siendo trabajo de hoy. Shopify Abandoned checkouts y Tiendanube no ponen
 * en el home un checkout de hace un mes. La preferencia de MP ya venció;
 * confirmar a mano no aplica: el webhook es la autoridad.
 */
export const HORAS_PAGO_DIGITAL_VIVO = 72;
export type StoreOrderPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "charged_back"
  | "partial"
  | string;

export function isStorePaymentReversed(status: StoreOrderPaymentStatus) {
  return status === "refunded" || status === "charged_back";
}

/** Sólo una orden pendiente o rechazada puede volver a intentar su pago. */
export function canRetryStorePayment(status: StoreOrderPaymentStatus) {
  return status === "pending" || status === "failed";
}

/** Transferencia y efectivo: el comercio acredita a mano. Pay no. */
export function esMedioPagoManualTienda(method: string | null | undefined) {
  const m = String(method ?? "").toLowerCase().trim();
  return m === "transferencia" || m === "efectivo";
}

/**
 * ¿El comercio puede marcar este pedido como cobrado desde el panel?
 * Nerqia Pay / mercadopago quedan afuera: los acredita el webhook.
 */
export function canConfirmManualStorePayment(input: {
  payment_status?: StoreOrderPaymentStatus | null;
  payment_method?: string | null;
}) {
  const status = input.payment_status ?? "";
  if (!(status === "pending" || status === "failed" || status === "partial")) return false;
  return esMedioPagoManualTienda(input.payment_method);
}

/**
 * ¿El Foco / Pulse debe gritar este cobro?
 *
 * Transferencia y efectivo: sí, el comercio puede acreditarlos.
 * Nerqia Pay: sólo si el pedido es reciente — un `pending` de julio no
 * se cobra hoy y enseña a ignorar la lista (medido 2026-09-02: 3 de 4
 * pendientes de Exentry eran MP de 2026-07-29/31).
 */
export function isStorePaymentActionableNow(
  input: {
    payment_status?: StoreOrderPaymentStatus | null;
    payment_method?: string | null;
    created_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  const status = input.payment_status ?? "";
  if (!canRetryStorePayment(status)) return false;
  if (canConfirmManualStorePayment(input)) return true;
  if (!esMedioGestionaPay(input.payment_method)) return false;
  const created = Date.parse(String(input.created_at ?? ""));
  if (!Number.isFinite(created)) return false;
  return (now.getTime() - created) <= HORAS_PAGO_DIGITAL_VIVO * 3600e3;
}

export function countActionableUnpaidOrders(
  rows: Array<{
    payment_status?: StoreOrderPaymentStatus | null;
    payment_method?: string | null;
    created_at?: string | null;
  }>,
  now: Date = new Date(),
): number {
  return rows.filter((row) => isStorePaymentActionableNow(row, now)).length;
}

/** La logística sólo puede avanzar cuando el pago sigue acreditado. */
export function canFulfillStoreOrder(status: StoreOrderPaymentStatus) {
  return status === "paid";
}

export function storeOrderPaymentLabel(status: StoreOrderPaymentStatus) {
  switch (status) {
    case "paid": return "Pagado";
    case "pending": return "Pendiente de pago";
    case "failed": return "Pago rechazado";
    case "refunded": return "Pago devuelto";
    case "charged_back": return "Contracargo";
    case "partial": return "Pago parcial";
    default: return status;
  }
}

export function storeOrderPaymentTone(status: StoreOrderPaymentStatus) {
  if (status === "paid") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (isStorePaymentReversed(status) || status === "failed") {
    return "bg-destructive/15 text-destructive border-0";
  }
  return "bg-yellow-500/15 text-yellow-500 border-0";
}
