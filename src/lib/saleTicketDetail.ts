export interface SaleTicketLine {
  id: string;
  sale_transaction_id?: string | null;
  /** Orden de tienda: la autoridad de margen usa este id, no el de la línea. */
  ecommerce_order_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  unit_price_ars?: number | null;
  total_ars?: number | null;
  cost_of_goods_ars?: number | null;
  profit_ars?: number | null;
  paid?: boolean | null;
  returned?: boolean | null;
  returned_quantity?: number | null;
  invoice_id?: string | null;
  payment_method?: string | null;
  source?: string | null;
  date?: string | null;
  customer_name?: string | null;
  seller_name?: string | null;
  coupon_code?: string | null;
  discount_applied?: boolean | null;
}

export interface SaleTicketDetail {
  id: string;
  /**
   * Id que entiende `sale_margin_operations`:
   * online → ecommerce_order_id; ticket POS → sale_transaction_id; legacy → sales.id.
   */
  marginOperationId: string;
  ecommerceOrderId: string | null;
  code: string;
  selected: SaleTicketLine;
  lines: SaleTicketLine[];
  isGrouped: boolean;
  units: number;
  totalArs: number;
  costArs: number;
  profitArs: number;
  marginPercent: number | null;
  allPaid: boolean;
  partiallyPaid: boolean;
  invoicedLines: number;
  hasReturn: boolean;
  returnedUnits: number;
  customerName: string | null;
  sellerNames: string[];
  paymentMethods: string[];
  sources: string[];
  date: string | null;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean) as string[])];
}

/**
 * Clave de margen canónico para un renglón / ticket.
 * Espejo de `sale_margin_operations.operation_id` (migración 20260822000004):
 * tienda_online → ecommerce_order_id; si falta el enlace, cae al ticket/línea.
 */
export function marginOperationIdForSale(line: {
  id: string;
  source?: string | null;
  ecommerce_order_id?: string | null;
  sale_transaction_id?: string | null;
}): string {
  const source = String(line.source ?? "").trim();
  const orderId = line.ecommerce_order_id?.trim() || null;
  if (source === "tienda_online" && orderId) return orderId;
  return line.sale_transaction_id?.trim() || line.id;
}

/**
 * Construye la lectura de un ticket desde las líneas que ya devolvió la
 * autoridad tenant-scoped de Ventas. No vuelve a consultar ni mezcla la lista
 * filtrada: abrir/cerrar el inspector no cambia la población de trabajo.
 */
export function buildSaleTicketDetail(
  sales: SaleTicketLine[],
  selectedId: string | null | undefined,
): SaleTicketDetail | null {
  if (!selectedId) return null;

  const selected = sales.find(sale => sale.id === selectedId);
  if (!selected) return null;

  const transactionId = selected.sale_transaction_id?.trim() || null;
  const lines = transactionId
    ? sales.filter(sale => sale.sale_transaction_id === transactionId)
    : [selected];
  const units = lines.reduce((total, line) => total + finiteNumber(line.quantity), 0);
  const totalArs = lines.reduce((total, line) => total + finiteNumber(line.total_ars), 0);
  const costArs = lines.reduce((total, line) => total + finiteNumber(line.cost_of_goods_ars), 0);
  const profitArs = lines.reduce((total, line) => total + finiteNumber(line.profit_ars), 0);
  const paidLines = lines.filter(line => line.paid === true).length;
  const id = transactionId || selected.id;
  const ecommerceOrderId = lines
    .map((line) => line.ecommerce_order_id?.trim())
    .find(Boolean) || null;

  return {
    id,
    marginOperationId: marginOperationIdForSale({
      ...selected,
      ecommerce_order_id: ecommerceOrderId ?? selected.ecommerce_order_id,
    }),
    ecommerceOrderId,
    code: id.slice(-8).toUpperCase(),
    selected,
    lines,
    isGrouped: Boolean(transactionId),
    units,
    totalArs,
    costArs,
    profitArs,
    marginPercent: totalArs > 0 ? (profitArs / totalArs) * 100 : null,
    allPaid: paidLines === lines.length,
    partiallyPaid: paidLines > 0 && paidLines < lines.length,
    invoicedLines: lines.filter(line => Boolean(line.invoice_id)).length,
    hasReturn: lines.some(line => line.returned === true),
    returnedUnits: lines.reduce((total, line) => (
      total + (line.returned ? Math.max(0, finiteNumber(line.returned_quantity)) : 0)
    ), 0),
    customerName: lines.find(line => line.customer_name?.trim())?.customer_name?.trim() || null,
    sellerNames: uniqueText(lines.map(line => line.seller_name)),
    paymentMethods: uniqueText(lines.map(line => line.payment_method)),
    sources: uniqueText(lines.map(line => line.source)),
    date: selected.date || null,
  };
}
