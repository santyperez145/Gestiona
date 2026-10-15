import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: la tienda muestra la primera página (48 productos, 23 KB en
// Famatina) y el catálogo entero (5,5 MB) llega detrás.
describe("catálogo progresivo de la tienda", () => {
  const ctx = fs.readFileSync("src/storefront/storeContext.tsx", "utf8");
  it("pide la primera página y el completo a la vez", () => {
    expect(ctx).toContain("fetchStoreCatalogInicio(slug, readOptions)");
    expect(ctx).toContain('fetchStoreProducts("", slug, readOptions)');
  });
  it("el carrito nunca se rearma con la primera página", () => {
    expect(ctx).toContain("if (loading || catalogoParcial || loadError || buyerIdentityLoading || !store || !cartToken) return;");
    expect(fs.readFileSync("src/storefront/StoreCartRecovery.tsx", "utf8")).toContain("if (!token || !store || loading || catalogoParcial) return;");
  });
  it("un producto del resto no figura «no encontrado» mientras llega, y el checkout espera", () => {
    const prod = fs.readFileSync("src/storefront/StoreProduct.tsx", "utf8");
    expect(prod.indexOf("if (!p && catalogoParcial)")).toBeLessThan(prod.indexOf("Producto no encontrado"));
    expect(fs.readFileSync("src/storefront/StoreCheckout.tsx", "utf8")).toContain("if (catalogoParcial) {");
  });
  it("si el completo falla después de la primera página, muestra el error de siempre", () => {
    expect(ctx).toMatch(/if \(parcial\) \{\s+const r = await completo;\s+if \(cancelled\) return;\s+if \(!r\.ok\) \{ setLoadError\(true\); return; \}/);
  });
});
