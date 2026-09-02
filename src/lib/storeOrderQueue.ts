/**
 * Cola de pedidos de la tienda: lo que el comercio opera después de la venta.
 *
 * La paridad regional (Tiendanube, 2026-08-11) es búsqueda por número / cliente
 * / email / monto, filtros de entrega y pago, y exportar lo filtrado. Las
 * acciones masivas de despacho no viven acá: mutar envío sin autoridad
 * server-side sería un botón que miente. Este módulo es puro para que la
 * pantalla no decida sola qué es "para despachar" y qué es "para retirar".
 */
import { csvCell } from "@/lib/csv";
import {
  canFulfillStoreOrder,
  canRetryStorePayment,
  storeOrderPaymentLabel,
} from "@/lib/storeOrderPayment";

export const STORE_ORDER_QUEUE_LIMIT = 200;

export const STORE_ORDER_VIEW_IDS = [
  "todas",
  "retirar",
  "despachar",
  "pago",
  "enviadas",
  "entregadas",
  "canceladas",
] as const;

export type StoreOrderView = typeof STORE_ORDER_VIEW_IDS[number];

export const STORE_ORDER_VIEWS: { id: StoreOrderView; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "retirar", label: "Para retirar" },
  { id: "despachar", label: "Para despachar" },
  { id: "pago", label: "Pendientes de pago" },
  { id: "enviadas", label: "Enviadas" },
  { id: "entregadas", label: "Entregadas" },
  { id: "canceladas", label: "Canceladas" },
];

export interface StoreOrderQueueRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total: number;
  payment_status: string;
  payment_method?: string | null;
  carrier?: string | null;
  shipping_service?: string | null;
  fulfillment_status: string;
  tracking_number: string | null;
  created_at: string;
}

const FULFILLMENT_PENDING = new Set(["pending", "unfulfilled", "processing"]);

export function parseStoreOrderView(raw: string | null | undefined): StoreOrderView {
  return STORE_ORDER_VIEW_IDS.includes(raw as StoreOrderView)
    ? (raw as StoreOrderView)
    : "todas";
}

/** Square / Shopify: pickup no es un envío. Medido 2026-09-02: Exentry. */
export function esPedidoRetiro(order: {
  carrier?: string | null;
  shipping_service?: string | null;
} | null | undefined) {
  const carrier = String(order?.carrier ?? "").toLowerCase().trim();
  const service = String(order?.shipping_service ?? "").toLowerCase().trim();
  return carrier === "retiro" || service === "sucursal";
}

export function storeOrderFulfillmentLabel(
  status: string,
  order?: { carrier?: string | null; shipping_service?: string | null },
) {
  if (esPedidoRetiro(order) && FULFILLMENT_PENDING.has(status)) {
    return "Para retirar";
  }
  switch (status) {
    case "pending":
    case "unfulfilled":
      return "Pendiente";
    case "processing":
      return "Para despachar";
    case "shipped":
      return "Enviada";
    case "delivered":
      return "Entregada";
    case "cancelled":
      return "Cancelada";
    default:
      return status;
  }
}

export function storeOrderFulfillmentTone(status: string) {
  if (status === "delivered") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (status === "shipped") return "bg-blue-500/15 text-blue-400 border-0";
  if (status === "processing") return "bg-yellow-500/15 text-yellow-400 border-0";
  if (status === "cancelled") return "bg-destructive/15 text-destructive border-0";
  return "bg-zinc-500/15 text-zinc-400 border-0";
}

function fold(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Monto escrito como lo escribe un comercio argentino: $15.000 o 15000,50. */
function looksLikeAmount(query: string) {
  return /^\$?\s*\d[\d.\s]*([,]\d{1,2})?$/.test(query.trim());
}

function parseAmountQuery(query: string): number | null {
  const compact = query.trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function matchesStoreOrderSearch(order: StoreOrderQueueRow, query: string) {
  const q = fold(query);
  if (!q) return true;
  const fields = [
    order.order_number,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.tracking_number,
  ].map(fold);
  if (fields.some(field => field.includes(q))) return true;
  if (!looksLikeAmount(query)) return false;
  const amount = parseAmountQuery(query);
  if (amount == null) return false;
  return Math.abs(Number(order.total) - amount) < 0.005;
}

/**
 * Pagado y todavía no salió / no se retiró.
 * Un pago revertido no entra: no se despacha lo que ya no está acreditado.
 */
export function isStoreOrderAwaitingFulfillment(order: {
  payment_status: string;
  fulfillment_status: string;
}) {
  return canFulfillStoreOrder(order.payment_status)
    && FULFILLMENT_PENDING.has(order.fulfillment_status);
}

export function isStoreOrderAwaitingPickup(order: StoreOrderQueueRow) {
  return isStoreOrderAwaitingFulfillment(order) && esPedidoRetiro(order);
}

export function isStoreOrderAwaitingShipment(order: StoreOrderQueueRow) {
  return isStoreOrderAwaitingFulfillment(order) && !esPedidoRetiro(order);
}

/** Pulse: domicilio vs mostrador. La cola histórica sigue listando ambos. */
export function countFulfillmentPulse(
  rows: Array<{
    payment_status: string;
    fulfillment_status: string;
    carrier?: string | null;
    shipping_service?: string | null;
  }>,
): { despachar: number; retirar: number } {
  let despachar = 0;
  let retirar = 0;
  for (const row of rows) {
    if (!isStoreOrderAwaitingFulfillment(row)) continue;
    if (esPedidoRetiro(row)) retirar += 1;
    else despachar += 1;
  }
  return { despachar, retirar };
}

export function storeOrderFulfillmentActionLabel(order: StoreOrderQueueRow) {
  if (!canFulfillStoreOrder(order.payment_status)) return "";
  if (esPedidoRetiro(order)) {
    return FULFILLMENT_PENDING.has(order.fulfillment_status) ? "Marcar retiro" : "Ver retiro";
  }
  return order.tracking_number ? "Ver envío" : "Preparar";
}

export function orderMatchesStoreView(order: StoreOrderQueueRow, view: StoreOrderView) {
  switch (view) {
    case "todas":
      return true;
    case "retirar":
      return isStoreOrderAwaitingPickup(order);
    case "despachar":
      return isStoreOrderAwaitingShipment(order);
    case "pago":
      return canRetryStorePayment(order.payment_status);
    case "enviadas":
      return order.fulfillment_status === "shipped";
    case "entregadas":
      return order.fulfillment_status === "delivered";
    case "canceladas":
      return order.fulfillment_status === "cancelled";
  }
}

export function filterStoreOrders(
  orders: StoreOrderQueueRow[],
  input: { query?: string; view?: StoreOrderView },
) {
  const view = parseStoreOrderView(input.view);
  const query = input.query ?? "";
  return orders.filter(order =>
    orderMatchesStoreView(order, view) && matchesStoreOrderSearch(order, query),
  );
}

export function countStoreOrderViews(orders: StoreOrderQueueRow[]): Record<StoreOrderView, number> {
  const counts = {
    todas: orders.length,
    retirar: 0,
    despachar: 0,
    pago: 0,
    enviadas: 0,
    entregadas: 0,
    canceladas: 0,
  };
  for (const order of orders) {
    if (isStoreOrderAwaitingPickup(order)) counts.retirar += 1;
    if (isStoreOrderAwaitingShipment(order)) counts.despachar += 1;
    if (canRetryStorePayment(order.payment_status)) counts.pago += 1;
    if (order.fulfillment_status === "shipped") counts.enviadas += 1;
    if (order.fulfillment_status === "delivered") counts.entregadas += 1;
    if (order.fulfillment_status === "cancelled") counts.canceladas += 1;
  }
  return counts;
}

export function buildStoreOrdersCsv(orders: StoreOrderQueueRow[]) {
  const header = [
    "numero",
    "cliente",
    "email",
    "telefono",
    "total",
    "pago",
    "entrega",
    "seguimiento",
    "fecha",
  ];
  const lines = orders.map(order => [
    order.order_number,
    order.customer_name,
    order.customer_email,
    order.customer_phone ?? "",
    Number(order.total),
    storeOrderPaymentLabel(order.payment_status),
    storeOrderFulfillmentLabel(order.fulfillment_status, order),
    order.tracking_number ?? "",
    String(order.created_at ?? "").slice(0, 10),
  ]);
  return [header, ...lines].map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function storeOrdersCsvFilename(date = new Date()) {
  return `gestiona-pedidos-tienda-${date.toISOString().slice(0, 10)}.csv`;
}
