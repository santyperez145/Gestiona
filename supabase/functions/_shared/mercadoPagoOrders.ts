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

/** Amounts requested are not proof of amounts paid. QR supports one payment. */
export function mercadoPagoQrEvidence(order: JsonRecord) {
  const payments = asRecord(order.transactions).payments;
  const list = Array.isArray(payments) ? payments : [];
  const payment = asRecord(list[0]);
  const amount = (value: unknown): number | null => {
    if ((typeof value !== "string" && typeof value !== "number")
      || !/^\d{1,16}(\.\d{1,2})?$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(Math.round(parsed * 100)) && parsed > 0 ? parsed : null;
  };
  const gross = amount(order.total_amount);
  const paid = amount(order.total_paid_amount);
  const paymentAmount = amount(payment.amount);
  const paymentPaid = amount(payment.paid_amount);
  const currency = cleanText(order.currency ?? order.currency_id, 8);
  const paymentReference = cleanText(asRecord(payment.reference).id ?? payment.reference_id, 180);
  const valid = order.type === "qr" && list.length === 1
    && order.status === "processed" && ["processed", "accredited"].includes(String(order.status_detail))
    && payment.status === "processed" && payment.status_detail === "accredited"
    && !!cleanText(payment.id, 180) && currency === "ARS"
    && gross !== null && paid === gross && paymentAmount === gross && paymentPaid === gross;
  return {
    valid, payment, paid, paymentReference,
    raw: {
      provider_evidence_version: 1,
      provider_order_type: cleanText(order.type, 30),
      provider_currency: currency,
      provider_merchant_id: cleanText(order.user_id, 180),
      external_reference: cleanText(order.external_reference, 180),
      order_total_amount: gross,
      order_paid_amount: paid,
      payment_count: list.length,
      payment_amount: paymentAmount,
      payment_paid_amount: paymentPaid,
      ...(typeof order.live_mode === "boolean" ? { provider_live_mode: order.live_mode } : {}),
    },
  };
}

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
  order: JsonRecord,
): Promise<{ net: number | null; source: string }> {
  const embeddedDetails = asRecord(payment.transaction_details);
  const embeddedNet = asNumber(embeddedDetails.net_received_amount ?? payment.net_received_amount);
  if (embeddedNet !== null) return { net: embeddedNet, source: "orders_api" };

  const paymentReference = cleanText(
    asRecord(payment.reference).id ?? payment.reference_id ?? payment.payment_id ?? payment.mp_payment_id,
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
    if (String(payload.id) !== paymentReference || payload.status !== "approved"
      || payload.currency_id !== (order.currency ?? order.currency_id)
      || asNumber(payload.transaction_amount) !== asNumber(order.total_paid_amount)
      || String(payload.collector_id) !== String(order.user_id)) {
      return { net: null, source: "payments_api_evidence_mismatch" };
    }
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

  const evidence = mercadoPagoQrEvidence(order);
  const payment = evidence.payment;
  const paymentId = cleanText(
    evidence.paymentReference ?? payment.id,
    250,
  );
  const gross = evidence.paid;
  const settlement = evidence.valid
    ? await fetchPaymentNet(accessToken, payment, order)
    : { net: null, source: "not_processed" };

  const raw = {
    source: "mercadopago_orders_api",
    ...evidence.raw,
    order_status: status,
    order_status_detail: cleanText(order.status_detail, 120),
    payment_transaction_id: cleanText(payment.id, 180),
    payment_reference_id: evidence.paymentReference,
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
