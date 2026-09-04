import type { Json } from "@/integrations/supabase/types";

export const STORE_ASSORTMENT_PAGE_SIZE = 50;

export type StoreAssortmentFilter =
  | "all"
  | "published"
  | "hidden"
  | "customized"
  | "unavailable";

export interface StoreAssortmentRow {
  productId: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  coreCategory: string | null;
  effectiveCategory: string | null;
  corePriceArs: number;
  coreDiscountPriceArs: number | null;
  overridePriceArs: number | null;
  overrideCompareAtPriceArs: number | null;
  overrideCategorySlug: string | null;
  featuredOverride: boolean | null;
  effectivePriceArs: number;
  effectiveCompareAtPriceArs: number | null;
  stock: number;
  active: boolean;
  visibility: "published" | "hidden";
  featured: boolean;
  sortOrder: number | null;
  customized: boolean;
  hasVariants: boolean;
  sellable: boolean;
  totalCount: number;
}

export interface StoreAssortmentSummary {
  total: number;
  published: number;
  hidden: number;
  customized: number;
  unavailable: number;
  withoutWeight: number;
}

export interface StoreAssortmentDraft {
  priceArs: string;
  compareAtPriceArs: string;
  categorySlug: string;
  featured: "inherit" | "yes" | "no";
  sortOrder: string;
}

export interface StoreAssortmentChange {
  product_id: string;
  visibility: "published" | "hidden";
  price_ars: number | null;
  compare_at_price_ars: number | null;
  category_slug: string | null;
  featured: boolean | null;
  sort_order: number | null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseStoreAssortmentRow(value: unknown): StoreAssortmentRow | null {
  const row = objectOf(value);
  if (!row || typeof row.product_id !== "string" || typeof row.name !== "string") {
    return null;
  }
  const visibility = row.visibility === "hidden" ? "hidden" : "published";
  return {
    productId: row.product_id,
    name: row.name,
    brand: typeof row.brand === "string" ? row.brand : "",
    imageUrl: typeof row.image_url === "string" && row.image_url ? row.image_url : null,
    coreCategory: typeof row.core_category === "string" ? row.core_category : null,
    effectiveCategory: typeof row.effective_category === "string"
      ? row.effective_category
      : null,
    corePriceArs: finiteNumber(row.core_price_ars),
    coreDiscountPriceArs: nullableNumber(row.core_discount_price_ars),
    overridePriceArs: nullableNumber(row.override_price_ars),
    overrideCompareAtPriceArs: nullableNumber(row.override_compare_at_price_ars),
    overrideCategorySlug: typeof row.override_category_slug === "string"
      ? row.override_category_slug
      : null,
    featuredOverride: typeof row.featured_override === "boolean"
      ? row.featured_override
      : null,
    effectivePriceArs: finiteNumber(row.effective_price_ars),
    effectiveCompareAtPriceArs: nullableNumber(row.effective_compare_at_price_ars),
    stock: Math.trunc(finiteNumber(row.stock)),
    active: row.active === true,
    visibility,
    featured: row.featured === true,
    sortOrder: nullableNumber(row.sort_order),
    customized: row.customized === true,
    hasVariants: row.has_variants === true,
    sellable: row.sellable === true,
    totalCount: Math.max(0, Math.trunc(finiteNumber(row.total_count))),
  };
}

export function parseStoreAssortmentSummary(value: Json | unknown): StoreAssortmentSummary | null {
  const summary = objectOf(value);
  if (!summary) return null;
  const keys = ["total", "published", "hidden", "customized", "unavailable", "without_weight"];
  if (keys.some(key => !Number.isFinite(Number(summary[key])))) return null;
  return {
    total: Math.max(0, Math.trunc(Number(summary.total))),
    published: Math.max(0, Math.trunc(Number(summary.published))),
    hidden: Math.max(0, Math.trunc(Number(summary.hidden))),
    customized: Math.max(0, Math.trunc(Number(summary.customized))),
    unavailable: Math.max(0, Math.trunc(Number(summary.unavailable))),
    withoutWeight: Math.max(0, Math.trunc(Number(summary.without_weight))),
  };
}

export function storeAssortmentDraft(row: StoreAssortmentRow): StoreAssortmentDraft {
  return {
    priceArs: row.overridePriceArs !== null ? String(row.overridePriceArs) : "",
    compareAtPriceArs: row.overrideCompareAtPriceArs !== null
      ? String(row.overrideCompareAtPriceArs)
      : "",
    categorySlug: row.overrideCategorySlug ?? "",
    featured: row.featuredOverride === null
      ? "inherit"
      : row.featuredOverride ? "yes" : "no",
    sortOrder: row.sortOrder !== null ? String(row.sortOrder) : "",
  };
}

export function validateStoreAssortmentDraft(draft: StoreAssortmentDraft): string | null {
  const price = draft.priceArs.trim() ? Number(draft.priceArs) : null;
  const compare = draft.compareAtPriceArs.trim()
    ? Number(draft.compareAtPriceArs)
    : null;
  if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 999999999999)) {
    return "Ingresá un precio válido mayor a cero.";
  }
  if (compare !== null && price === null) {
    return "El precio de referencia necesita un precio propio para esta tienda.";
  }
  if (compare !== null && (!Number.isFinite(compare) || compare <= (price ?? 0))) {
    return "El precio de referencia debe ser mayor al precio que se cobra.";
  }
  const sortOrder = draft.sortOrder.trim() ? Number(draft.sortOrder) : null;
  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 2147483647)) {
    return "El orden manual debe ser un número entero igual o mayor a cero.";
  }
  return null;
}

export function buildStoreAssortmentChange(
  row: StoreAssortmentRow,
  draft: StoreAssortmentDraft,
): StoreAssortmentChange {
  return {
    product_id: row.productId,
    visibility: row.visibility,
    price_ars: draft.priceArs.trim() ? Number(draft.priceArs) : null,
    compare_at_price_ars: draft.compareAtPriceArs.trim()
      ? Number(draft.compareAtPriceArs)
      : null,
    category_slug: draft.categorySlug || null,
    featured: draft.featured === "inherit" ? null : draft.featured === "yes",
    sort_order: draft.sortOrder.trim() ? Number(draft.sortOrder) : null,
  };
}

export function visibilityChange(
  row: StoreAssortmentRow,
  visibility: "published" | "hidden",
): StoreAssortmentChange {
  return {
    product_id: row.productId,
    visibility,
    price_ars: row.overridePriceArs,
    compare_at_price_ars: row.overrideCompareAtPriceArs,
    category_slug: row.overrideCategorySlug,
    featured: row.featuredOverride,
    sort_order: row.sortOrder,
  };
}

export function assortmentPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / STORE_ASSORTMENT_PAGE_SIZE));
}
