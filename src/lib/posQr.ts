import { posParseFacturarResult, type PosFacturaEstado } from "@/lib/posComprobante";

export type PosQrState =
  | "preparing"
  | "pending"
  | "accredited"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed"
  | "manual_review"
  | "refunded";

export interface PosQrSession {
  session_id: string;
  org_id: string;
  state: PosQrState;
  amount: number;
  platform_fee: number;
  currency: string;
  expires_at: string;
  provider_order_id?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_payment_id?: string | null;
  qr_data?: string | null;
  sale_transaction_id?: string | null;
  failure_reason?: string | null;
  payment_attempt_id: string;
  invoice_requested?: boolean;
  invoice_preparation_error?: string | null;
  invoice?: { invoice_id: string; number?: string; cae?: string | null; afip_status?: string | null; ok: boolean; autorizar?: boolean } | null;
  items?: Array<{
    product_id: string;
    title: string;
    unit_price: number | string;
    quantity: number | string;
  }>;
}

export function posQrFiscalResult(session: PosQrSession): PosFacturaEstado | null {
  if (!session.invoice_requested || session.state !== "completed") return null;
  if (session.invoice?.invoice_id) return {
    ...posParseFacturarResult(session.invoice),
    cae: session.invoice.cae ?? undefined,
    afipStatus: session.invoice.afip_status ?? undefined,
  };
  const detail = session.invoice_preparation_error === "permission_required"
    ? "La venta está cobrada. Un encargado con permiso fiscal debe preparar su factura desde Ventas."
    : session.invoice_preparation_error === "configuration_required"
      ? "La venta está cobrada. Completá la configuración fiscal y reintentá su factura desde Ventas."
      : "La venta está cobrada, pero su factura requiere revisión desde Ventas. No vuelvas a cobrar.";
  return { ok: false, motivo: detail };
}

export interface PosQrSetupPayload {
  storeName: string;
  streetName: string;
  streetNumber: string;
  cityName: string;
  stateName: string;
  latitude: number;
  longitude: number;
  reference?: string;
}

export type PosQrPhase = "preparing" | "setup" | "pending" | "cancelling" | "error";

export const POS_QR_TERMINAL_STATES = new Set<PosQrState>([
  "completed", "cancelled", "expired", "failed", "manual_review", "refunded",
]);

export const POS_QR_RETRYABLE_TERMINAL_STATES = new Set<PosQrState>([
  "cancelled", "expired", "failed",
]);

export function posQrRequiresManualReview(session: PosQrSession | null | undefined): boolean {
  return session?.state === "manual_review";
}

export function posQrRemainingSeconds(expiresAt: string | null | undefined, now = Date.now()): number {
  const expiry = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 1000)) : 0;
}

export function posQrRemainingLabel(seconds: number): string {
  const safe = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function posQrFailureCopy(session: PosQrSession | null | undefined): string {
  switch (session?.state) {
    case "expired": return "El QR venció y la reserva de stock fue liberada.";
    case "cancelled": return "El cobro fue cancelado y no se registró ninguna venta.";
    case "manual_review": return session.failure_reason
      ? `${session.failure_reason}. No vuelvas a cobrar: consultá el mismo intento o revisalo en Mercado Pago.`
      : "Mercado Pago informó un importe distinto o datos de pago incompletos. La venta no se cerró y requiere revisión.";
    case "refunded": return "Mercado Pago informó que el cobro fue reintegrado.";
    case "failed": return session.failure_reason || "Mercado Pago no pudo preparar este cobro.";
    default: return "No se pudo continuar con el cobro QR.";
  }
}
