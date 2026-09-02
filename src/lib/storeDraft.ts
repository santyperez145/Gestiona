/**
 * La tienda no nace con la identidad de Exentry.
 *
 * Misma familia que `industry_code = perfumes` y `category = perfume_arabe`:
 * un default escrito se ve como una elección. Commerce sembraba «Mi Tienda
 * Online», el dorado `#f59e0b`, envío $2.500 y envío gratis desde $50.000.
 * Un Guardar sin tocar esos campos publicaba tarifas que nadie cargó y un
 * slug `mi-tienda-online` que choca entre comercios.
 *
 * El color de la vitrina puede ser el que eligió el comercio en el
 * onboarding. Lo que no puede ser es el dorado del workspace.
 */

import type { PaymentDiscounts } from "@/lib/paymentDiscount";
import { slugDeNombre } from "@/lib/storeCategories";

/** Violeta del workspace (`252 83% 62%`). El onboarding arranca igual. */
export const STORE_WORKSPACE_COLOR = "#6E4DEE";

const SLUGS_GENERICOS = new Set([
  "mi-tienda",
  "mi-tienda-online",
  "tienda",
  "tienda-online",
]);

const HEX = /^#[0-9A-Fa-f]{6}$/;

export type StoreFormDraft = {
  name: string;
  slug: string;
  theme: string;
  primary_color: string;
  currency: string;
  tax_included: boolean;
  free_shipping_above: string;
  shipping_cost: string;
  is_active: boolean;
  payment_methods: string[];
  payment_discounts: PaymentDiscounts;
  payment_discount_stacks: boolean;
  font: string;
  meta_title: string;
  meta_description: string;
  description: string;
  notification_email: string;
  meta_pixel_id: string;
  ga_measurement_id: string;
  tiktok_pixel_id: string;
  logo_url: string;
  banner_url: string;
  shipping_mode: string;
  pickup_enabled: boolean;
  pickup_address: string;
  pickup_instructions: string;
  default_item_weight_kg: string;
  fulfillment_location_id: string;
};

export type StoreOrgSeed = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  primary_color?: string | null;
};

export function nombreInicialDeTienda(orgName: string | null | undefined): string {
  return String(orgName ?? "").trim();
}

export function colorInicialDeTienda(orgColor: string | null | undefined): string {
  const color = String(orgColor ?? "").trim();
  if (HEX.test(color)) return color;
  return STORE_WORKSPACE_COLOR;
}

export function slugCandidatoDeTienda(input: {
  slugEscrito?: string | null;
  name?: string | null;
  orgSlug?: string | null;
  orgId: string;
}): string {
  const escrito = slugDeNombre(input.slugEscrito ?? "");
  if (escrito && !SLUGS_GENERICOS.has(escrito)) return escrito;

  const delNombre = slugDeNombre(input.name ?? "");
  if (delNombre && !SLUGS_GENERICOS.has(delNombre)) return delNombre;

  const deOrg = slugDeNombre(input.orgSlug ?? "");
  if (deOrg && !SLUGS_GENERICOS.has(deOrg)) return deOrg;

  const sufijo = String(input.orgId ?? "").replace(/-/g, "").slice(0, 8);
  return sufijo ? `tienda-${sufijo}` : "";
}

/** Vacío o inválido es $0, no $2.500 inventados. La columna no admite NULL. */
export function costoEnvioAlGuardar(raw: string | number | null | undefined): number {
  const t = String(raw ?? "").trim();
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Vacío es «nunca», no $50.000. NULL es el valor honesto. */
export function envioGratisAlGuardar(raw: string | number | null | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function esConflictoDeSlug(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = String(error.message ?? "").toLowerCase();
  return msg.includes("ecommerce_stores_slug") || msg.includes("duplicate key");
}

export function storeDraftInicial(
  org?: StoreOrgSeed,
  fulfillmentGlobal = "__stock_global__",
): StoreFormDraft {
  const name = nombreInicialDeTienda(org?.name);
  const orgId = org?.id ?? "";
  return {
    name,
    slug: orgId ? slugCandidatoDeTienda({ name, orgSlug: org?.slug, orgId }) : "",
    theme: "minimal",
    primary_color: colorInicialDeTienda(org?.primary_color),
    currency: "ARS",
    tax_included: true,
    free_shipping_above: "",
    shipping_cost: "",
    is_active: false,
    payment_methods: ["transferencia"],
    payment_discounts: {},
    payment_discount_stacks: false,
    font: "sistema",
    meta_title: "",
    meta_description: "",
    description: "",
    notification_email: "",
    meta_pixel_id: "",
    ga_measurement_id: "",
    tiktok_pixel_id: "",
    logo_url: "",
    banner_url: "",
    shipping_mode: "flat",
    pickup_enabled: false,
    pickup_address: "",
    pickup_instructions: "",
    default_item_weight_kg: "0.5",
    fulfillment_location_id: fulfillmentGlobal,
  };
}

type FilaTienda = {
  name?: string | null;
  slug?: string | null;
  theme?: string | null;
  primary_color?: string | null;
  currency?: string | null;
  tax_included?: boolean | null;
  free_shipping_above?: number | null;
  shipping_cost?: number | null;
  is_active?: boolean | null;
  payment_methods?: string[] | null;
  payment_discounts?: unknown;
  payment_discount_stacks?: boolean | null;
  font?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  description?: string | null;
  notification_email?: string | null;
  meta_pixel_id?: string | null;
  ga_measurement_id?: string | null;
  tiktok_pixel_id?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  shipping_mode?: string | null;
  pickup_enabled?: boolean | null;
  pickup_address?: string | null;
  pickup_instructions?: string | null;
  default_item_weight_kg?: number | null;
  fulfillment_location_id?: string | null;
};

/** Una fila guardada no se mezcla con los defaults del formulario vacío. */
export function storeFormDesdeFila(
  data: FilaTienda,
  fulfillmentGlobal = "__stock_global__",
): StoreFormDraft {
  const base = storeDraftInicial();
  return {
    ...base,
    name: data.name ?? "",
    slug: data.slug ?? "",
    theme: data.theme ?? base.theme,
    primary_color: data.primary_color ?? base.primary_color,
    currency: data.currency ?? base.currency,
    tax_included: data.tax_included ?? base.tax_included,
    free_shipping_above: data.free_shipping_above != null ? String(data.free_shipping_above) : "",
    shipping_cost: data.shipping_cost != null ? String(data.shipping_cost) : "",
    is_active: data.is_active ?? false,
    payment_methods: Array.isArray(data.payment_methods) && data.payment_methods.length > 0
      ? data.payment_methods
      : ["transferencia"],
    payment_discounts: data.payment_discounts && typeof data.payment_discounts === "object" && !Array.isArray(data.payment_discounts)
      ? data.payment_discounts as PaymentDiscounts
      : {},
    payment_discount_stacks: data.payment_discount_stacks ?? false,
    font: data.font ?? base.font,
    meta_title: data.meta_title ?? "",
    meta_description: data.meta_description ?? "",
    description: data.description ?? "",
    notification_email: data.notification_email ?? "",
    meta_pixel_id: data.meta_pixel_id ?? "",
    ga_measurement_id: data.ga_measurement_id ?? "",
    tiktok_pixel_id: data.tiktok_pixel_id ?? "",
    logo_url: data.logo_url ?? "",
    banner_url: data.banner_url ?? "",
    shipping_mode: data.shipping_mode ?? base.shipping_mode,
    pickup_enabled: data.pickup_enabled ?? false,
    pickup_address: data.pickup_address ?? "",
    pickup_instructions: data.pickup_instructions ?? "",
    default_item_weight_kg: data.default_item_weight_kg != null
      ? String(data.default_item_weight_kg)
      : base.default_item_weight_kg,
    fulfillment_location_id: data.fulfillment_location_id ?? fulfillmentGlobal,
  };
}
