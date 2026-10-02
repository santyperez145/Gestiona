import { z } from "zod";
import { labelMissingMarginComponent } from "@/lib/channelMargins";

const money = z.number().finite().nullable();
const count = z.number().int().nonnegative();
const strings = z.array(z.string()).nullable();
export const PROFIT_CHANNELS = { pos: "Mostrador", tienda_online: "Tienda propia", mercadolibre: "Mercado Libre", sin_atribuir: "Sin atribuir" } as const;
export type ProfitMode = "products" | "sku" | "operations";
const filtersSchema = z.object({ storeId: z.string().uuid().nullable(), channel: z.enum(["pos", "tienda_online", "mercadolibre", "sin_atribuir"]).nullable(), groupBy: z.enum(["product", "sku"]) });
const storeSchema = z.object({ id: z.string().uuid(), name: z.string(), active: z.boolean() });
export type ProfitFilters = Required<z.infer<typeof filtersSchema>>;
export type ProfitStore = Required<z.infer<typeof storeSchema>>;
const operationSchema = z.object({
  org_id: z.string(), operation_key: z.string(), operation_id: z.string(),
  operation_reference: z.string().nullable(), operation_type: z.string().nullable(),
  channel: z.string().nullable(), recorded_source: z.string().nullable(), sold_at: z.string().nullable(),
  line_count: count, units: z.number().int(), revenue_ars: money,
  cogs_ars: money, payment_fee_ars: money, shipping_cost_ars: money, tax_ars: money,
  contribution_margin_ars: money, known_components: count, coverage_pct: money,
  missing_components: strings, margin_blockers: strings, is_explainable: z.boolean(), quality_status: z.string(),
  cogs_sources: strings, payment_fee_sources: strings, shipping_sources: strings, tax_sources: strings,
  payment_methods: strings, payment_mix: z.array(z.object({ method: z.string(), amount_ars: money })),
  payment_mix_difference_ars: money, has_promotion: z.boolean(), measured_discount_ars: money,
  coupon_codes: strings, price_discount_lines: count, promotion_missing_evidence: strings,
  promotion_evidence_status: z.string(), returned_units: z.number().int(),
});
const productSchema = z.object({
  productId: z.string(), productName: z.string(), channel: z.string(), lines: count,
  units: z.number().int(), revenueARS: z.number().finite(), cogsARS: money,
  paymentFeeARS: money, shippingCostARS: money, taxARS: money, contributionMarginARS: money,
  coveragePct: money, pendingCodes: z.array(z.string()),
  variantId: z.string().nullable(), sku: z.string().nullable(), variantName: z.string().nullable(),
  skuSource: z.enum(["current_catalog", "unavailable"]).nullable(),
});
const profitPeriodBaseSchema = z.object({
  version: z.literal(1), currency: z.literal("ARS"), timeZone: z.literal("America/Argentina/Buenos_Aires"),
  from: z.string().nullable(), to: z.string().nullable(), pageSize: z.number().int().min(1).max(100),
  productCount: count, operationCount: count, productPage: z.number().int().positive(), operationPage: z.number().int().positive(),
  filters: filtersSchema, stores: z.array(storeSchema),
  coverage: z.object({
    lines: count, explainableLines: count, revenueARS: z.number().finite(), explainableRevenueARS: z.number().finite(),
    explainableRevenuePct: money, averageCoveragePct: money, cogsKnownLines: count, paymentFeeKnownLines: count,
    shippingKnownLines: count, taxKnownLines: count, measuredContributionARS: money, contributionMarginARS: money,
  }),
  products: z.array(productSchema), operations: z.array(operationSchema),
}).superRefine((period, context) => {
  if (period.products.length > period.pageSize || period.operations.length > period.pageSize
    || period.productPage > Math.max(1, Math.ceil(period.productCount / period.pageSize))
    || period.operationPage > Math.max(1, Math.ceil(period.operationCount / period.pageSize))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid population or page" });
  }
});
export type ProfitProduct = Required<z.infer<typeof productSchema>>;
export type ProfitPeriod = Required<Omit<z.infer<typeof profitPeriodBaseSchema>, "coverage" | "products" | "operations" | "filters" | "stores">> & {
  filters: ProfitFilters; stores: ProfitStore[];
  coverage: Required<z.infer<typeof profitPeriodBaseSchema>["coverage"]>;
  products: ProfitProduct[];
  operations: Required<z.infer<typeof operationSchema>>[];
};
// The repo disables strictNullChecks; Zod inference otherwise makes every field optional.
export const profitPeriodSchema = profitPeriodBaseSchema.transform(value => value as ProfitPeriod);

export function profitPendingLabels(product: ProfitProduct) {
  return product.pendingCodes.map(labelMissingMarginComponent);
}

export function profitSourceError(error: { code?: string }) {
  if (error.code === "42501" || error.code === "PGRST301") {
    return "No tenés permiso para consultar rentabilidad. Revisá el acceso con un administrador.";
  }
  if (["42883", "PGRST202"].includes(error.code || "")) {
    return "La lectura completa de rentabilidad todavía no está disponible. No se muestran totales parciales como completos.";
  }
  if (error.code === "22023") return "Revisá las fechas, la tienda y el canal. Podés volver a todas las tiendas si la selección ya no está disponible.";
  return "No pudimos actualizar la rentabilidad. Volvé a intentar; no se reemplazaron datos por ceros.";
}
