import { z } from "zod";
import { csvCell } from "@/lib/csv";

const count = z.number().int().nonnegative();
const money = z.number().finite().nonnegative().nullable();
export const CAPITAL_REASONS = {
  negative_stock: "Stock negativo o sin saldo comprobable",
  variant_reconciliation: "Conciliar variantes con el stock del producto",
  negative_history: "Revisar movimientos con saldo negativo",
  movement_reconciliation: "Conciliar el Kardex con el stock actual",
  movement_order: "Verificar el orden de movimientos simultáneos",
  transfer_reconciliation: "Conciliar las dos puntas de la transferencia",
  missing_cost: "Completar evidencia de costo histórico",
} as const;
const layer = z.object({ movementId: z.string().uuid().nullable(), receivedAt: z.string().nullable(),
  source: z.enum(["opening", "movement_snapshot", "unverified_entry"]), remainingUnits: count,
  unitCostARS: money, valueARS: money });
const item = z.object({ product_id: z.string().uuid(), variant_id: z.string().uuid().nullable(),
  product_name: z.string(), variant_name: z.string().nullable(), sku: z.string().nullable(), stock_units: z.number().int().nullable(),
  known_units: count, unvalued_units: count, measured_value_ars: money, value_ars: money,
  coverage_pct: z.number().min(0).max(100).nullable(), reasons: z.array(z.enum(Object.keys(CAPITAL_REASONS) as [keyof typeof CAPITAL_REASONS, ...Array<keyof typeof CAPITAL_REASONS>])),
  last_sold_at: z.string().nullable(), sold_units_90: z.number().int(),
  days_without_sale: count.nullable(), days_of_stock: z.number().finite().nonnegative().nullable() });
const history = z.object({ snapshot_date: z.string(), captured_at: z.string(), products: count,
  verified: z.boolean().nullable(), units: z.number().int(), value_ars: money, measured_value_ars: money });
const base = z.object({ version: z.literal(1), orgId: z.string().uuid(), currency: z.literal("ARS"), method: z.literal("fifo_movement_snapshot"),
  asOf: z.string(), snapshotDate: z.string(), search: z.string().max(120), pageSize: z.number().int().min(1).max(100),
  itemCount: count, page: z.number().int().positive(), historyCount: count, historyPage: z.number().int().positive(),
  summary: z.object({ stockUnits: z.number().int(), positiveUnits: count, knownUnits: count, unvaluedUnits: count, blockedItems: count,
    valueARS: money, measuredValueARS: money, slowCapitalARS: money, coveragePct: z.number().min(0).max(100).nullable() }),
  items: z.array(item), history: z.array(history), layerCount: count, layerPage: z.number().int().positive(),
  layers: z.array(layer.extend({ product_id: z.string().uuid(), variant_id: z.string().uuid().nullable(), product_name: z.string(), variant_name: z.string().nullable(), sku: z.string().nullable() })),
}).superRefine((data, ctx) => {
  if (data.items.length > data.pageSize || data.history.length > data.pageSize || data.layers.length > data.pageSize
    || data.page > Math.max(1, Math.ceil(data.itemCount / data.pageSize))
    || data.historyPage > Math.max(1, Math.ceil(data.historyCount / data.pageSize))
    || data.layerPage > Math.max(1, Math.ceil(data.layerCount / data.pageSize))
    || data.summary.knownUnits + data.summary.unvaluedUnits !== data.summary.positiveUnits
    || data.summary.blockedItems > data.itemCount
    || (data.summary.valueARS !== null && (data.summary.unvaluedUnits > 0 || data.summary.blockedItems > 0))
    || data.items.some(row => row.known_units + row.unvalued_units !== Math.max(0, row.stock_units ?? 0)
      || (row.value_ars !== null && row.reasons.length > 0))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inventory capital coverage or population" });
  }
});
export type CapitalItem = Required<z.infer<typeof item>>;
export type InventoryCapital = Required<Omit<z.infer<typeof base>, "summary" | "items" | "history" | "layers">> & {
  summary: Required<z.infer<typeof base>["summary"]>; items: CapitalItem[]; history: Required<z.infer<typeof history>>[];
  layers: Required<z.infer<typeof base>["layers"][number]>[];
};
export const inventoryCapitalSchema = base.transform(value => value as InventoryCapital);
export const capitalCaptureSchema = z.object({ orgId: z.string().uuid(), date: z.string(), status: z.enum(["recorded", "already_recorded", "empty"]) });

export function capitalSourceError(code?: string) {
  if (code === "42501" || code === "PGRST301") return "Necesitás permisos de inventario y rentabilidad. Pedí a un administrador que revise tu acceso.";
  if (["42883", "PGRST202"].includes(code || "")) return "La lectura de capital todavía no está disponible. No se sustituyen costos históricos por precios actuales.";
  if (code === "22023") return "Revisá la búsqueda o actualizá la lectura antes de guardar el cierre del día.";
  return "No pudimos actualizar el capital en inventario. Volvé a intentar; los importes desconocidos no se reemplazan por ceros.";
}

export function inventoryCapitalCsv(data: InventoryCapital, view = "valuation") {
  if (view === "layers") return [
    ["Producto", "Variante", "SKU", "Ingreso", "Remanentes", "Costo unitario ARS", "Capital capa ARS", "Fuente", "Lectura", "Página de capas"],
    ...data.layers.map(row => [row.product_name, row.variant_name, row.sku, row.receivedAt, row.remainingUnits, row.unitCostARS, row.valueARS,
      row.source === "movement_snapshot" ? "Costo registrado en Kardex" : row.source === "opening" ? "Saldo inicial sin costo" : "Ingreso sin costo verificado",
      data.asOf, `${data.layerPage} de ${Math.max(1, Math.ceil(data.layerCount / data.pageSize))}`]),
  ].map(row => row.map(csvCell).join(",")).join("\r\n");
  if (view === "history") return [
    ["Fecha", "Productos", "Stock", "Capital completo ARS", "Subtotal trazable ARS", "Fuente", "Captura", "Página de cierres"],
    ...data.history.map(row => [row.snapshot_date, row.products, row.units, row.value_ars, row.measured_value_ars,
      row.verified ? "FIFO sobre Kardex" : "Registro anterior sin evidencia de costo", row.captured_at,
      `${data.historyPage} de ${Math.max(1, Math.ceil(data.historyCount / data.pageSize))}`]),
  ].map(row => row.map(csvCell).join(",")).join("\r\n");
  const rows: unknown[][] = [["Producto", "Variante", "SKU", "Stock", "Unidades con costo", "Unidades pendientes", "Capital completo ARS", "Subtotal trazable ARS", "Cobertura %", "Pendientes", "Última venta", "Ventas netas 90 días", "Cobertura de stock días", "Lectura", "Método", "Página"]];
  data.items.forEach(row => rows.push([row.product_name, row.variant_name, row.sku, row.stock_units, row.known_units, row.unvalued_units,
    row.value_ars, row.measured_value_ars, row.coverage_pct, row.reasons.map(reason => CAPITAL_REASONS[reason]).join("; "), row.last_sold_at,
    row.sold_units_90, row.days_of_stock, data.asOf, "FIFO sobre costo registrado en Kardex", `${data.page} de ${Math.max(1, Math.ceil(data.itemCount / data.pageSize))}`]));
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
