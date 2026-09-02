import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Guardas de la Fase 4: inteligencia de tienda sin PII ni margen en público. */
describe("storefront intelligence surface", () => {
  it("StoreProduct usa scoreRelatedProducts + afinidad opcional + recentlyViewed", () => {
    const page = src("src/storefront/StoreProduct.tsx");
    expect(page).toContain("scoreRelatedProducts");
    expect(page).toContain("attributeScores");
    expect(page).toContain("recommendSimilar");
    expect(page).toContain("get_store_product_recommendations");
    expect(page).toContain("recordView");
    expect(page).toContain("Vistos recientemente");
  });

  it("home no promete fragancias: la tienda es multi-rubro", () => {
    const home = src("src/storefront/StoreHome.tsx");
    expect(home).not.toMatch(/fragancia/i);
    expect(src("src/lib/relatedProducts.ts")).toMatch(/cualquier comercio legal|no sólo perfumes/i);
  });

  it("home y cuenta alimentan sugerencias desde pedidos", () => {
    expect(src("src/storefront/StoreHome.tsx")).toContain("suggestionsFromOrderSeeds");
    expect(src("src/storefront/StoreHome.tsx")).toContain("Porque compraste");
    expect(src("src/storefront/StoreAccount.tsx")).toContain("suggestionsFromOrderSeeds");
    expect(src("src/storefront/StoreAccount.tsx")).toContain("signInWithEmailOtp");
    expect(src("src/storefront/storeAuth.tsx")).toContain('account_type: "store_customer"');
  });

  it("algoritmos puros no nombran costo ni credenciales", () => {
    for (const file of ["src/lib/relatedProducts.ts", "src/lib/recentlyViewed.ts"]) {
      const body = src(file);
      expect(body).not.toMatch(/cost_usd|cost_ars|margin|access_token|api_key/i);
    }
  });

  it("RPC pública de recomendaciones está versionada", () => {
    const mig = src("supabase/migrations/20260902000070_store_product_recommendations.sql");
    expect(mig).toContain("get_store_product_recommendations");
    expect(mig).toContain("SECURITY DEFINER");
    expect(mig).toContain("GRANT EXECUTE");
    expect(mig).toContain("anon");
  });
});
