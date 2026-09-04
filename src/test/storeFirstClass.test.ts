import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseCommerceStoreId,
  type CommerceStore,
} from "@/hooks/useCommerceStores";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MIGRATION = readFileSync(
  resolve(ROOT, "supabase/migrations/20260904000110_store_first_class.sql"),
  "utf8",
);
const STORE_PAGE = readFileSync(
  resolve(ROOT, "src/pages/EcommerceStorePage.tsx"),
  "utf8",
);
const ORDERS_PAGE = readFileSync(
  resolve(ROOT, "src/pages/StoreOrdersPage.tsx"),
  "utf8",
);
const RECOVERY = readFileSync(
  resolve(ROOT, "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
  "utf8",
);
const PUBLIC_DATA = readFileSync(
  resolve(ROOT, "src/lib/publicDataSource.ts"),
  "utf8",
);
const STORE_CONTEXT = readFileSync(
  resolve(ROOT, "src/storefront/storeContext.tsx"),
  "utf8",
);
const CATEGORIES = readFileSync(
  resolve(ROOT, "src/components/ecommerce/CategoriesEditor.tsx"),
  "utf8",
);

function store(id: string, primary = false): CommerceStore {
  return { id, is_primary: primary } as CommerceStore;
}

describe("tiendas first-class sobre un único Business Core", () => {
  it("elige URL, persistencia y principal en ese orden", () => {
    const stores = [store("one"), store("primary", true), store("requested")];

    expect(chooseCommerceStoreId(stores, "requested", "one")).toBe("requested");
    expect(chooseCommerceStoreId(stores, null, "one")).toBe("one");
    expect(chooseCommerceStoreId(stores, null, "missing")).toBe("primary");
    expect(chooseCommerceStoreId([store("first")], null, null)).toBe("first");
    expect(chooseCommerceStoreId([], null, null)).toBeNull();
  });

  it("quita el límite de una tienda y preserva exactamente una principal", () => {
    expect(MIGRATION).toContain("pg_get_constraintdef(c.oid) = 'UNIQUE (org_id)'");
    expect(MIGRATION).toContain("ecommerce_stores_one_primary_per_org_idx");
    expect(MIGRATION).toMatch(/WHERE is_primary;/);
    expect(MIGRATION).toContain("trg_assign_primary_ecommerce_store");
    expect(MIGRATION).toContain("trg_reassign_primary_ecommerce_store");
    expect(MIGRATION).toContain("trg_protect_primary_ecommerce_store");
  });

  it("cambia la principal sólo por RPC tenant-safe y auditado", () => {
    const start = MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.set_primary_ecommerce_store",
    );
    const end = MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_published_store_slug",
    );
    const body = MIGRATION.slice(start, end);

    expect(body).toContain("public.has_org_role");
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toContain("store.primary.change");
    expect(body).toContain("FROM PUBLIC, anon");
  });

  it("aísla devoluciones, despachos, métricas y analítica por store_id", () => {
    expect(MIGRATION).toContain("AND o.store_id = v_store.id");
    expect(MIGRATION).toContain("WHERE s.id = v_order.store_id");
    expect(MIGRATION).toContain("visit.store_id = p_store_id");
    expect(MIGRATION).toContain("cart.store_id = p_store_id");
    expect(MIGRATION).toContain("store_id = p_store_id");
    expect(MIGRATION).toContain(
      "public.set_store_first_party_analytics(\n  uuid, uuid, boolean, boolean",
    );
  });

  it("el catálogo público resuelve la vitrina por slug sin duplicar productos", () => {
    expect(MIGRATION).toContain(
      "CREATE OR REPLACE FUNCTION public.get_store_catalog_products(p_slug text)",
    );
    expect(MIGRATION).toContain("LEFT JOIN LATERAL");
    expect(PUBLIC_DATA).toContain("'get_store_catalog_products'");
    expect(PUBLIC_DATA).toContain("{ p_slug: storeSlug }");
    expect(STORE_CONTEXT).toContain("fetchStoreProducts(row.org_id, row.slug)");
  });

  it("configuración, pedidos y recuperación comparten el mismo selector", () => {
    expect(STORE_PAGE).toContain("<StoreWorkspacePicker");
    expect(STORE_PAGE).toContain('.eq("store_id", store.id)');
    expect(STORE_PAGE).not.toContain('upsert(row, { onConflict: "org_id" })');
    expect(ORDERS_PAGE).toContain("<StoreWorkspacePicker");
    expect(ORDERS_PAGE).toContain('.eq("store_id", commerceStores.selectedStoreId)');
    expect(RECOVERY).toContain('.eq("store_id", storeId)');
  });

  it("las categorías siguen siendo del Core y no de una vitrina", () => {
    expect(CATEGORIES).toContain("org_id: orgId, store_id: null");
    expect(MIGRATION).toContain("p_org_id, NULL, v_name");
  });
});
