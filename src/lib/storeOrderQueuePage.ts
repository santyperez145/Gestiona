import { z } from "zod";
import { STORE_ORDER_VIEWS } from "@/lib/storeOrderQueue";
import type { StoreOrderView } from "@/lib/storeOrderQueue";
import type { StoreOrderInspectRow } from "@/lib/storeOrderDetail";

export const STORE_ORDER_PAGE_SIZE = 50;

export function parseStoreOrderPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 && page <= 2147483647 ? page : 1;
}

const count = z.number().int().nonnegative();
const rowSchema = z.object({
  id: z.string().uuid(), order_number: z.string(), customer_name: z.string(),
  customer_email: z.string(), customer_phone: z.string().nullable(),
  total: z.number().finite(), payment_status: z.string(), fulfillment_status: z.string(),
  tracking_number: z.string().nullable(), created_at: z.string().datetime({ offset: true }),
}).passthrough();
const pageSchema = z.object({
  rows: z.array(rowSchema).max(STORE_ORDER_PAGE_SIZE),
  total: count, store_total: count, attention: count,
  page: z.number().int().positive(), page_size: z.literal(STORE_ORDER_PAGE_SIZE),
  counts: z.object({ todas: count, retirar: count, despachar: count, atrasados: count,
    pago: count, enviadas: count, entregadas: count, canceladas: count }),
});

export interface StoreOrderQueuePage {
  rows: StoreOrderInspectRow[];
  total: number;
  store_total: number;
  attention: number;
  page: number;
  page_size: number;
  counts: Record<StoreOrderView, number>;
}

export function parseStoreOrderQueuePage(input: unknown): StoreOrderQueuePage {
  const data = pageSchema.parse(input);
  if (data.total > data.counts.todas || data.counts.todas > data.store_total
    || data.attention > data.store_total
    || STORE_ORDER_VIEWS.some(view => data.counts[view.id] > data.counts.todas)
    || data.page > Math.max(1, Math.ceil(data.total / data.page_size))
    || data.rows.length !== Math.min(data.page_size, Math.max(0, data.total - (data.page - 1) * data.page_size))
    || new Set(data.rows.map(row => row.id)).size !== data.rows.length) {
    throw new Error("Invalid store order queue response");
  }
  return data as StoreOrderQueuePage;
}
