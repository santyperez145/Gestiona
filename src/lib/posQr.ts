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
  items?: Array<{
    product_id: string;
    title: string;
    unit_price: number | string;
    quantity: number | string;
  }>;
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
    case "manual_review": return "Mercado Pago informó un importe distinto. La venta no se cerró y requiere revisión.";
    case "refunded": return "Mercado Pago informó que el cobro fue reintegrado.";
    case "failed": return session.failure_reason || "Mercado Pago no pudo preparar este cobro.";
    default: return "No se pudo continuar con el cobro QR.";
  }
}
