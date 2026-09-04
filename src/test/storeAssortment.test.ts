import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assortmentPageCount,
  buildStoreAssortmentChange,
  parseStoreAssortmentRow,
  parseStoreAssortmentSummary,
  storeAssortmentDraft,
  validateStoreAssortmentDraft,
  visibilityChange,
  type StoreAssortmentRow,
} from "@/lib/storeAssortment";

const ROOT = resolve(import.meta.dirname, "..", "..");
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260904000130_store_assortment.sql"),
  "utf8",
);
const storePage = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
const editor = readFileSync(
  resolve(ROOT, "src/components/ecommerce/StoreAssortmentEditor.tsx"),
  "utf8",
);
const edgeCatalog = readFileSync(resolve(ROOT, "src/lib/storeCatalogApi.ts"), "utf8");
const feed = readFileSync(resolve(ROOT, "api/feed.ts"), "utf8");
const sitemap = readFileSync(resolve(ROOT, "api/sitemap.ts"), "utf8");
const og = readFileSync(resolve(ROOT, "api/og.ts"), "utf8");

const row: StoreAssortmentRow = {
  productId: "product-1",
  name: "Producto",
  brand: "Marca",
  imageUrl: null,
  coreCategory: "general",
  effectiveCategory: "liquidacion",
  corePriceArs: 12000,
  coreDiscountPriceArs: 10000,
  overridePriceArs: 9000,
  overrideCompareAtPriceArs: 11500,
  overrideCategorySlug: "liquidacion",
  featuredOverride: false,
  effectivePriceArs: 9000,
  effectiveCompareAtPriceArs: 11500,
  stock: 7,
  active: true,
  visibility: "published",
  featured: false,
  sortOrder: 3,
  customized: true,
  hasVariants: false,
  sellable: true,
  totalCount: 60,
};

describe("surtido multi-tienda", () => {
  it("parsea filas y resumen sin aceptar contratos rotos", () => {
    expect(parseStoreAssortmentRow({
      product_id: "p",
      name: "Nombre",
      visibility: "hidden",
      effective_price_ars: "25",
      total_count: "3",
    })).toMatchObject({
      productId: "p",
      visibility: "hidden",
      effectivePriceArs: 25,
      totalCount: 3,
    });
    expect(parseStoreAssortmentRow({ name: "Sin id" })).toBeNull();
    expect(parseStoreAssortmentSummary({
      total: 10,
      published: 7,
      hidden: 2,
      customized: 4,
      unavailable: 1,
      without_weight: 3,
    })).toEqual({
      total: 10,
      published: 7,
      hidden: 2,
      customized: 4,
      unavailable: 1,
      withoutWeight: 3,
    });
    expect(parseStoreAssortmentSummary({ total: "desconocido" })).toBeNull();
  });

  it("conserva overrides al cambiar visibilidad", () => {
    expect(visibilityChange(row, "hidden")).toEqual({
      product_id: "product-1",
      visibility: "hidden",
      price_ars: 9000,
      compare_at_price_ars: 11500,
      category_slug: "liquidacion",
      featured: false,
      sort_order: 3,
    });
  });

  it("distingue herencia y valida precios", () => {
    const draft = storeAssortmentDraft(row);
    expect(draft).toEqual({
      priceArs: "9000",
      compareAtPriceArs: "11500",
      categorySlug: "liquidacion",
      featured: "no",
      sortOrder: "3",
    });
    expect(validateStoreAssortmentDraft(draft)).toBeNull();
    expect(validateStoreAssortmentDraft({ ...draft, priceArs: "0" })).toMatch(/mayor a cero/);
    expect(validateStoreAssortmentDraft({
      ...draft,
      priceArs: "",
      compareAtPriceArs: "10000",
    })).toMatch(/necesita un precio propio/);
    expect(validateStoreAssortmentDraft({
      ...draft,
      priceArs: "10000",
      compareAtPriceArs: "9000",
    })).toMatch(/debe ser mayor/);
    expect(validateStoreAssortmentDraft({ ...draft, sortOrder: "1.5" })).toMatch(/número entero/);
    expect(buildStoreAssortmentChange(row, draft).price_ars).toBe(9000);
    expect(buildStoreAssortmentChange(row, draft).sort_order).toBe(3);
    expect(assortmentPageCount(0)).toBe(1);
    expect(assortmentPageCount(101)).toBe(3);
  });

  it("modela overrides tenant-safe sin duplicar producto ni stock", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.store_product_publications");
    expect(migration).toContain("PRIMARY KEY (store_id, product_id)");
    expect(migration).toContain("store_product_publications_member_read");
    expect(migration).toContain("store_product_publications_catalog_write");
    expect(migration).toContain("validate_store_product_publication");
    expect(migration).toContain("category.store_id = NEW.store_id");
    expect(migration).not.toMatch(/store_product_publications[\s\S]{0,500}\bstock\s+(integer|numeric)/i);
    expect(migration).not.toMatch(/store_product_publications[\s\S]{0,500}\bcost_/i);
  });

  it("hereda por defecto y aplica el surtido en catálogo, variantes y checkout", () => {
    expect(migration).toMatch(/COALESCE\(publication\.visibility, 'published'\)/);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_store_catalog_products");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_store_variants");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_store_categories");
    expect(migration).toContain("PERFORM set_config('nerqia.store_id'");
    expect(migration).toContain("Este producto ya no está publicado en la tienda");
    expect(migration).toContain("create_store_order_core");
    expect(migration).toContain("save_store_cart_v2_core");
  });

  it("ofrece una superficie operable y persistente dentro de Commerce", () => {
    expect(storePage).toContain('"products"');
    expect(storePage).toContain("<StoreAssortmentEditor");
    expect(editor).toContain("usePersistedState<StoreAssortmentFilter>");
    expect(editor).toContain("save_store_product_publications");
    expect(editor).toContain("get_store_assortment_summary");
    expect(editor).toContain("Seleccionar esta página");
    expect(editor).toContain("Con problemas");
  });

  it("feed, sitemap y SEO consultan por slug y no por organización", () => {
    expect(edgeCatalog).toContain("rpc/get_store_catalog_products");
    for (const source of [feed, sitemap, og]) {
      expect(source).toContain("fetchStoreCatalog");
      expect(source).not.toContain("/rest/v1/store_catalog_products?");
    }
  });
});
