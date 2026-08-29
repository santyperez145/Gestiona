/** Contrato mínimo de Mercado Pago Orders API usado por POS y webhook. */

const MP_API = "https://api.mercadopago.com";

export type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const cleanText = (value: unknown, max = 250): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, max) : null;
};

export class MercadoPagoOrderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: JsonRecord,
  ) {
    super(message);
  }
}

export async function fetchMercadoPagoOrder(
  accessToken: string,
  orderId: string,
): Promise<JsonRecord> {
  const response = await fetch(`${MP_API}/v1/orders/${encodeURIComponent(orderId)}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new MercadoPagoOrderError("Mercado Pago no pudo consultar la order", response.status, payload);
  }
  return payload;
}

/**
 * Orders confirma la venta, pero el neto/arancel suele vivir en Payments API.
 * Si todavía no está disponible devolvemos null: la venta queda pagada y el
 * margen settlement_pending, nunca con una comisión cero inventada.
 */
async function fetchPaymentNet(
  accessToken: string,
  payment: JsonRecord,
): Promise<{ net: number | null; source: string }> {
  const embeddedDetails = asRecord(payment.transaction_details);
  const embeddedNet = asNumber(embeddedDetails.net_received_amount ?? payment.net_received_amount);
  if (embeddedNet !== null) return { net: embeddedNet, source: "orders_api" };

  const paymentReference = cleanText(
    payment.reference_id ?? payment.payment_id ?? payment.mp_payment_id,
    180,
  );
  if (!paymentReference) return { net: null, source: "pending" };

  try {
    const response = await fetch(
      `${MP_API}/v1/payments/${encodeURIComponent(paymentReference)}`,
      {
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      },
    );
    const payload = asRecord(await response.json().catch(() => ({})));
    if (!response.ok) return { net: null, source: `payments_api_${response.status}` };
    const details = asRecord(payload.transaction_details);
    return {
      net: asNumber(details.net_received_amount ?? payload.net_received_amount),
      source: "payments_api",
    };
  } catch (error) {
    console.error("Mercado Pago payment settlement lookup:", error);
    return { net: null, source: "payments_api_network" };
  }
}

export async function reconcileMercadoPagoPosQrOrder(
  admin: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  },
  accessToken: string,
  sessionId: string,
  order: JsonRecord,
): Promise<JsonRecord> {
  const orderId = cleanText(order.id, 180);
  const status = cleanText(order.status, 80)?.toLowerCase();
  if (!orderId || !status) throw new Error("La respuesta de Mercado Pago no identifica order y estado");

  const transactions = asRecord(order.transactions);
  const payments = Array.isArray(transactions.payments) ? transactions.payments : [];
  const payment = asRecord(payments[0]);
  const paymentId = cleanText(
    payment.reference_id ?? payment.id ?? order.provider_payment_id,
    250,
  );
  const gross = asNumber(order.total_amount ?? payment.amount);
  const settlement = status === "processed"
    ? await fetchPaymentNet(accessToken, payment)
    : { net: null, source: "not_processed" };

  const raw = {
    source: "mercadopago_orders_api",
    order_status: status,
    order_status_detail: cleanText(order.status_detail, 120),
    payment_transaction_id: cleanText(payment.id, 180),
    payment_reference_id: cleanText(payment.reference_id, 180),
    payment_status: cleanText(payment.status, 80),
    payment_status_detail: cleanText(payment.status_detail, 120),
    settlement_source: settlement.source,
    last_updated_date: cleanText(order.last_updated_date, 80),
  };

  const { data, error } = await admin.rpc("pos_qr_apply_provider", {
    p_session_id: sessionId,
    p_provider_order_id: orderId,
    p_status: status,
    p_status_detail: cleanText(order.status_detail ?? payment.status_detail, 120),
    p_payment_id: paymentId,
    p_gross: gross,
    p_net: settlement.net,
    p_fee: null,
    p_raw: raw,
  });
  if (error) throw error;
  return asRecord(data);
}

export const mercadoPagoOrderInternals = { asRecord, asNumber, cleanText };
