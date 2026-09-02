/**
 * Lectura de un pedido de tienda para el inspector del comercio.
 *
 * Igual que Ventas con `?sale=`: la selección vive en la URL, se busca en la
 * cola tenant-scoped ya cargada (no en el recorte filtrado) y un id ajeno no
 * inventa ficha. No calcula margen: el costo de esa venta está en el Core, no
 * en el JSON del checkout.
 */
import type { StoreOrderQueueRow } from "@/lib/storeOrderQueue";

/** Lista plana: el `.select()` de la página tiene que ser este literal, no la constante. */
export const STORE_ORDER_LIST_SELECT =
  "id, order_number, customer_name, customer_email, customer_phone, total, subtotal, shipping_cost, discount_amount, coupon_code, coupon_discount_ars, tax_amount, payment_status, payment_method, fulfillment_status, tracking_number, shipping_address, items, notes, shipped_at, delivered_at, created_at";

export interface StoreOrderItem {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface StoreOrderInspectRow extends StoreOrderQueueRow {
  subtotal?: number | null;
  shipping_cost?: number | null;
  discount_amount?: number | null;
  coupon_code?: string | null;
  coupon_discount_ars?: number | null;
  tax_amount?: number | null;
  payment_method?: string | null;
  shipping_address?: Record<string, string> | null;
  items?: unknown;
  notes?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
}

export interface StoreOrderDetail {
  order: StoreOrderInspectRow;
  items: StoreOrderItem[];
  units: number;
  itemsTotal: number;
  address: {
    calle: string;
    ciudad: string;
    provincia: string;
    cp: string;
    texto: string;
  };
  paymentMethodLabel: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStoreOrderInspectId(value: string | null | undefined): value is string {
  return Boolean(value && UUID.test(value));
}

/**
 * La ficha se arma sobre la cola completa, nunca sobre el recorte de búsqueda:
 * un filtro no puede hacer desaparecer un deep link de la misma organización.
 */
export function findStoreOrderForInspect(
  orders: StoreOrderInspectRow[],
  selectedId: string | null | undefined,
): StoreOrderInspectRow | null {
  if (!selectedId) return null;
  return orders.find(order => order.id === selectedId) ?? null;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseStoreOrderItems(raw: unknown): StoreOrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => {
    const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    const name = String(row.name ?? row.product_name ?? "Ítem");
    const quantity = finiteNumber(row.quantity);
    const unit_price = finiteNumber(row.unit_price ?? row.unit_price_ars);
    const total = finiteNumber(row.total ?? row.total_ars);
    return {
      name,
      quantity,
      unit_price,
      total: total || unit_price * quantity,
    };
  });
}

export function storeOrderPaymentMethodLabel(method: string | null | undefined) {
  if (method === "gestiona_pay" || method === "mercadopago") return "Gestiona Pay";
  if (method === "transferencia") return "Transferencia";
  if (method === "efectivo") return "Efectivo / retiro";
  return method?.trim() || "Sin medio";
}

export function formatStoreOrderAddress(raw: Record<string, string> | null | undefined) {
  const source = raw ?? {};
  const calle = source.calle || source.street || source.address || "";
  const ciudad = source.ciudad || source.city || "";
  const provincia = source.provincia || source.province || source.state || "";
  const cp = source.cp || source.zip || source.postal_code || "";
  const texto = [calle, [ciudad, provincia].filter(Boolean).join(", "), cp].filter(Boolean).join(" · ");
  return { calle, ciudad, provincia, cp, texto };
}

export function buildStoreOrderDetail(order: StoreOrderInspectRow | null): StoreOrderDetail | null {
  if (!order) return null;
  const items = parseStoreOrderItems(order.items);
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  return {
    order,
    items,
    units,
    itemsTotal,
    address: formatStoreOrderAddress(order.shipping_address),
    paymentMethodLabel: storeOrderPaymentMethodLabel(order.payment_method),
  };
}
