/**
 * Lógica de devoluciones y arrepentimiento legal para pedidos de la tienda online.
 *
 * En Argentina, la Ley 24.240 (art. 34) exige el derecho de arrepentimiento de
 * 10 días corridos contados desde la entrega efectiva del producto.
 * Si no hay fecha de entrega registrada, el plazo no se extingue anticipadamente.
 */

export interface StoreOrderReturnSummary {
  id: string;
  rma_number: string;
  tipo: "arrepentimiento" | "falla" | string;
  status: "pending" | "approved" | "rejected" | "received" | "refunded" | "resolved" | "closed" | string;
  product_name: string;
  quantity: number;
  refund_amount?: number | null;
  resolution?: string | null;
  created_at: string;
}

/**
 * Calcula los días corridos restantes para ejercer el derecho legal de arrepentimiento.
 * Si la orden no fue entregada aún (delivered_at es null), devuelve 10 días completos
 * para no penalizar al comprador por demoras en el despacho o registro.
 */
export function calcularDiasArrepentimiento(deliveredAt: string | null | undefined, now = new Date()): number {
  if (!deliveredAt) return 10;
  const deliveryDate = new Date(deliveredAt);
  if (Number.isNaN(deliveryDate.getTime())) return 10;

  const diffMs = now.getTime() - deliveryDate.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  return Math.max(0, 10 - diffDays);
}

/**
 * Determina si una orden está dentro del plazo legal para solicitar arrepentimiento.
 */
export function estaEnPlazoArrepentimiento(deliveredAt: string | null | undefined, now = new Date()): boolean {
  return calcularDiasArrepentimiento(deliveredAt, now) > 0;
}

/**
 * Etiqueta legible para el estado de una devolución.
 */
export function returnStatusLabel(status: string): string {
  switch (status) {
    case "pending": return "Pendiente";
    case "approved": return "Aprobado";
    case "rejected": return "Rechazado";
    case "received": return "Mercadería recibida";
    case "refunded": return "Reintegrado";
    case "resolved": return "Resuelto";
    case "closed": return "Cerrado";
    default: return status;
  }
}

/**
 * Tono de color para el badge del estado.
 */
export function returnStatusTone(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-500/15 text-amber-500 border-amber-500/30";
    case "approved": return "bg-blue-500/15 text-blue-500 border-blue-500/30";
    case "received": return "bg-indigo-500/15 text-indigo-500 border-indigo-500/30";
    case "refunded":
    case "resolved": return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
    case "rejected":
    case "closed": return "bg-destructive/15 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

/**
 * Etiqueta para el tipo legal de devolución.
 */
export function returnTipoLabel(tipo: string): string {
  switch (tipo) {
    case "arrepentimiento": return "Arrepentimiento (Ley 24.240)";
    case "falla": return "Falla / Garantía legal";
    default: return tipo;
  }
}
