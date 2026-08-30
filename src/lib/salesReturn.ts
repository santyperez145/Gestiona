export type SalesReturnPreviewLine = {
  sale_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  sold_quantity: number;
  returned_quantity: number;
  available_quantity: number;
  sold_amount: number;
  returned_amount: number;
  available_amount: number;
  unit_refund_amount: number;
  invoice_id: string | null;
  paid: boolean;
};

export type SalesReturnPreviewPayment = {
  payment_transaction_id: string | null;
  sale_method: string;
  provider: string;
  method: string;
  paid_amount: number;
  refunded_amount: number;
  available_amount: number;
  execution_mode: "cash" | "manual_external" | "mercadopago_api";
};

export type SalesReturnPreview = {
  sale_id: string;
  sale_transaction_id: string | null;
  ticket_code: string;
  source: string | null;
  customer_name: string | null;
  sold_at: string;
  location_id: string | null;
  open_cash_session_id: string | null;
  lines: SalesReturnPreviewLine[];
  payments: SalesReturnPreviewPayment[];
  invoices: Array<{
    invoice_id: string;
    number: string | null;
    authorized: boolean;
    cae: string | null;
  }>;
};

export type RefundAllocation = {
  payment_transaction_id: string | null;
  sale_method: string;
  amount: number;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Espejo de `create_sales_return_v1`: la última unidad absorbe el redondeo. */
export function salesReturnLineAmount(line: SalesReturnPreviewLine, quantity: number) {
  const safeQuantity = Math.max(0, Math.min(Math.trunc(quantity), line.available_quantity));
  if (safeQuantity === 0) return 0;
  if (safeQuantity === line.available_quantity) return money(line.available_amount);
  return money((line.sold_amount * safeQuantity) / line.sold_quantity);
}

export function salesReturnTotal(
  lines: SalesReturnPreviewLine[],
  quantities: Record<string, number>,
) {
  return money(lines.reduce(
    (total, line) => total + salesReturnLineAmount(line, quantities[line.sale_id] ?? 0),
    0,
  ));
}

/**
 * Reparte el reintegro en la misma proporción del saldo de cada cobro. La
 * última parte absorbe centavos y cada resultado queda limitado por su saldo.
 */
export function allocateSalesReturnRefund(
  payments: SalesReturnPreviewPayment[],
  total: number,
): RefundAllocation[] {
  const availablePayments = payments.filter((payment) => payment.available_amount > 0);
  const availableTotal = money(availablePayments.reduce(
    (sum, payment) => sum + payment.available_amount,
    0,
  ));
  if (total <= 0 || availableTotal <= 0 || total > availableTotal + 0.01) return [];

  let remaining = money(total);
  return availablePayments.map((payment, index) => {
    const isLast = index === availablePayments.length - 1;
    const proportional = isLast
      ? remaining
      : money(total * payment.available_amount / availableTotal);
    const amount = money(Math.min(payment.available_amount, proportional, remaining));
    remaining = money(remaining - amount);
    return {
      payment_transaction_id: payment.payment_transaction_id,
      sale_method: payment.sale_method,
      amount,
    };
  }).filter((allocation) => allocation.amount > 0);
}

export function salesReturnPaymentLabel(method: string) {
  const labels: Record<string, string> = {
    efectivo: "Efectivo",
    cash: "Efectivo",
    transferencia: "Transferencia",
    transfer: "Transferencia",
    debito: "Tarjeta de débito",
    debit: "Tarjeta de débito",
    credito: "Tarjeta de crédito",
    credit: "Tarjeta de crédito",
    qr: "QR",
    mercadopago: "Mercado Pago",
  };
  return labels[method.toLowerCase()] ?? method;
}

export function salesReturnStatusLabel(status: string | null) {
  return status === "completed" ? "Completada" : "Reintegro pendiente";
}
