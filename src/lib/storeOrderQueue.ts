/**
 * Cola de pedidos de la tienda: lo que el comercio opera después de la venta.
 *
 * La paridad regional (Tiendanube, 2026-08-11) es búsqueda por número / cliente
 * / email / monto, filtros de entrega y pago, y exportar lo filtrado. Las
 * Las acciones masivas llaman a una única RPC server-side que reutiliza la
 * transición individual. Este módulo sólo decide qué acción ofrecer: la base
 * vuelve a validar pago, tenant, permiso, preparación y estado.
 */
import { csvCell } from "@/lib/csv";
import { esMedioGestionaPay } from "@/lib/gestionaPay";
import {
  canFulfillStoreOrder,
  canRetryStorePayment,
  storeOrderPaymentLabel,
} from "@/lib/storeOrderPayment";

export const STORE_ORDER_QUEUE_LIMIT = 200;
export const STORE_ORDER_BULK_LIMIT = 50;
export const STORE_ORDER_BULK_STATUSES = ["shipped", "delivered"] as const;
export type StoreOrderBulkStatus = typeof STORE_ORDER_BULK_STATUSES[number];

export interface StoreOrderBulkResultItem {
  order_id: string | null;
  order_number: string | null;
  outcome: "changed" | "unchanged" | "skipped" | "duplicate";
  reason?: string;
}

export interface StoreOrderBulkResponse {
  ok: boolean;
  requested: number;
  unique: number;
  status: StoreOrderBulkStatus;
  changed: number;
  unchanged: number;
  skipped: number;
  duplicates: number;
  results: StoreOrderBulkResultItem[];
}

export function parseStoreOrderBulkResponse(raw: unknown): StoreOrderBulkResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (data.ok !== true || !STORE_ORDER_BULK_STATUSES.includes(data.status as StoreOrderBulkStatus)) {
    return null;
  }
  const numericKeys = ["requested", "unique", "changed", "unchanged", "skipped", "duplicates"] as const;
  if (numericKeys.some(key => !Number.isInteger(data[key]) || Number(data[key]) < 0)) return null;
  if (!Array.isArray(data.results)) return null;
  const results = data.results.filter((item): item is StoreOrderBulkResultItem => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const candidate = item as Record<string, unknown>;
    return ["changed", "unchanged", "skipped", "duplicate"].includes(String(candidate.outcome));
  });
  if (results.length !== data.results.length) return null;
  return {
    ok: true,
    requested: Number(data.requested),
    unique: Number(data.unique),
    status: data.status as StoreOrderBulkStatus,
    changed: Number(data.changed),
    unchanged: Number(data.unchanged),
    skipped: Number(data.skipped),
    duplicates: Number(data.duplicates),
    results,
  };
}

export const STORE_ORDER_VIEW_IDS = [
  "todas",
  "retirar",
  "despachar",
  "atrasados",
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
  { id: "atrasados", label: "Atrasados" },
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

/** Pagado y sin salir hace más de esto: entra a Atrasados (Shopify: unfulfilled aging). */
export const STORE_ORDER_STALE_HOURS = 24;

export const STORE_ORDER_SORT_IDS = ["recientes", "antiguos", "mayor", "menor"] as const;
export type StoreOrderSort = typeof STORE_ORDER_SORT_IDS[number];

export const STORE_ORDER_SORTS: { id: StoreOrderSort; label: string }[] = [
  { id: "recientes", label: "Más recientes" },
  { id: "antiguos", label: "Más antiguos" },
  { id: "mayor", label: "Mayor monto" },
  { id: "menor", label: "Menor monto" },
];

export const STORE_ORDER_MEDIO_IDS = ["todos", "transferencia", "efectivo", "digital"] as const;
export type StoreOrderMedio = typeof STORE_ORDER_MEDIO_IDS[number];

export const STORE_ORDER_MEDIOS: { id: StoreOrderMedio; label: string }[] = [
  { id: "todos", label: "Cualquier medio" },
  { id: "transferencia", label: "Transferencia" },
  { id: "efectivo", label: "Efectivo" },
  { id: "digital", label: "Nerqia Pay" },
];

export function parseStoreOrderView(raw: string | null | undefined): StoreOrderView {
  return STORE_ORDER_VIEW_IDS.includes(raw as StoreOrderView)
    ? (raw as StoreOrderView)
    : "todas";
}

export function parseStoreOrderSort(raw: string | null | undefined): StoreOrderSort {
  return STORE_ORDER_SORT_IDS.includes(raw as StoreOrderSort)
    ? (raw as StoreOrderSort)
    : "recientes";
}

export function parseStoreOrderMedio(raw: string | null | undefined): StoreOrderMedio {
  return STORE_ORDER_MEDIO_IDS.includes(raw as StoreOrderMedio)
    ? (raw as StoreOrderMedio)
    : "todos";
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

/** Seleccionable significa que al menos una de las dos transiciones masivas
 * puede aplicar. La RPC sigue siendo la autoridad final. */
export function isStoreOrderBulkSelectable(order: StoreOrderQueueRow) {
  return canFulfillStoreOrder(order.payment_status)
    && (isStoreOrderAwaitingFulfillment(order) || order.fulfillment_status === "shipped");
}

export function canBulkFulfillStoreOrder(
  order: StoreOrderQueueRow,
  status: StoreOrderBulkStatus,
) {
  if (!isStoreOrderBulkSelectable(order)) return false;
  if (status === "shipped") {
    return !esPedidoRetiro(order) && isStoreOrderAwaitingFulfillment(order);
  }
  return esPedidoRetiro(order)
    ? isStoreOrderAwaitingFulfillment(order)
    : order.fulfillment_status === "shipped";
}

export function countBulkFulfillmentCandidates(
  orders: StoreOrderQueueRow[],
  status: StoreOrderBulkStatus,
) {
  return orders.filter(order => canBulkFulfillStoreOrder(order, status)).length;
}

function createdAtMs(iso: string | null | undefined) {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function isStoreOrderStale(
  order: Pick<StoreOrderQueueRow, "payment_status" | "fulfillment_status" | "created_at">,
  now: Date = new Date(),
) {
  if (!isStoreOrderAwaitingFulfillment(order)) return false;
  const created = createdAtMs(order.created_at);
  if (!created) return false;
  return (now.getTime() - created) > STORE_ORDER_STALE_HOURS * 3600e3;
}

export function orderMatchesStoreMedio(order: StoreOrderQueueRow, medio: StoreOrderMedio) {
  if (medio === "todos") return true;
  const method = String(order.payment_method ?? "").toLowerCase().trim();
  if (medio === "digital") return esMedioGestionaPay(method);
  if (medio === "transferencia") return method === "transferencia";
  if (medio === "efectivo") return method === "efectivo";
  return true;
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

export function orderMatchesStoreView(
  order: StoreOrderQueueRow,
  view: StoreOrderView,
  now: Date = new Date(),
) {
  switch (view) {
    case "todas":
      return true;
    case "retirar":
      return isStoreOrderAwaitingPickup(order);
    case "despachar":
      return isStoreOrderAwaitingShipment(order);
    case "atrasados":
      return isStoreOrderStale(order, now);
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

export function sortStoreOrders(orders: StoreOrderQueueRow[], sort: StoreOrderSort) {
  const byDateDesc = (a: StoreOrderQueueRow, b: StoreOrderQueueRow) => createdAtMs(b.created_at) - createdAtMs(a.created_at);
  const list = [...orders];
  switch (sort) {
    case "antiguos":
      return list.sort((a, b) => createdAtMs(a.created_at) - createdAtMs(b.created_at));
    case "mayor":
      return list.sort((a, b) => Number(b.total) - Number(a.total) || byDateDesc(a, b));
    case "menor":
      return list.sort((a, b) => Number(a.total) - Number(b.total) || byDateDesc(a, b));
    case "recientes":
    default:
      return list.sort(byDateDesc);
  }
}

export function filterStoreOrders(
  orders: StoreOrderQueueRow[],
  input: { query?: string; view?: StoreOrderView; sort?: StoreOrderSort; medio?: StoreOrderMedio; now?: Date },
) {
  const view = parseStoreOrderView(input.view);
  const sort = parseStoreOrderSort(input.sort);
  const medio = parseStoreOrderMedio(input.medio);
  const query = input.query ?? "";
  const now = input.now ?? new Date();
  const filtered = orders.filter(order =>
    orderMatchesStoreView(order, view, now) && orderMatchesStoreMedio(order, medio) && matchesStoreOrderSearch(order, query),
  );
  if (view === "atrasados") {
    return sortStoreOrders(filtered, "antiguos");
  }
  return sortStoreOrders(filtered, sort);
}

export function countStoreOrderViews(orders: StoreOrderQueueRow[]): Record<StoreOrderView, number> {
  const counts = {
    todas: orders.length,
    retirar: 0,
    despachar: 0,
    atrasados: 0,
    pago: 0,
    enviadas: 0,
    entregadas: 0,
    canceladas: 0,
  };
  for (const order of orders) {
    if (isStoreOrderAwaitingPickup(order)) counts.retirar += 1;
    if (isStoreOrderAwaitingShipment(order)) counts.despachar += 1;
    if (isStoreOrderStale(order)) counts.atrasados += 1;
    if (canRetryStorePayment(order.payment_status)) counts.pago += 1;
    if (order.fulfillment_status === "shipped") counts.enviadas += 1;
    if (order.fulfillment_status === "delivered") counts.entregadas += 1;
    if (order.fulfillment_status === "cancelled") counts.canceladas += 1;
  }
  return counts;
}

/** Badge de la tab Pedidos: trabajo operativo, no el historial entero. */
export function countStoreOrdersNeedingAttention(orders: StoreOrderQueueRow[]): number {
  const c = countStoreOrderViews(orders);
  return c.retirar + c.despachar + c.atrasados + c.pago;
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
  return `nerqia-pedidos-tienda-${date.toISOString().slice(0, 10)}.csv`;
}
