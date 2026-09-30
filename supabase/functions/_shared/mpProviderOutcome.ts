const AMBIGUOUS_HTTP_STATUSES = new Set([408, 409, 425, 429]);

/**
 * A response is ambiguous when Mercado Pago could have accepted the operation
 * even though Nerqia did not receive a conclusive result. Retrying these cases
 * as a fresh failure could duplicate a money movement.
 */
export function isAmbiguousMercadoPagoStatus(status: number): boolean {
  return AMBIGUOUS_HTTP_STATUSES.has(status) || status >= 500;
}

/** User-facing copy never exposes provider payloads, tokens or internal IDs. */
export function mercadoPagoRefundPublicError(status: number): string {
  if (status === 401 || status === 403) {
    return "Mercado Pago necesita volver a autorizar la cuenta desde Integraciones.";
  }
  if (status === 404) {
    return "Mercado Pago no encontró el cobro original. Verificá la operación antes de continuar.";
  }
  if (status === 400 || status === 422) {
    return "Mercado Pago rechazó el reintegro. Revisá el estado y el saldo de la cuenta.";
  }
  return "Mercado Pago no pudo confirmar el reintegro. Verificá el estado antes de reintentar.";
}
