/**
 * El estado del pago de una orden de tienda es una decisión operativa: no basta
 * con pintarlo. Una devolución o contracargo no autoriza otro despacho ni otro
 * intento de cobro sobre la misma orden.
 */
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
