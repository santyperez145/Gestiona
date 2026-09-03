import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeStoreOrderNumber } from "@/lib/storeOrderLookup";
import { ROBOTS_DISALLOW_TIENDA, parseRutaTienda } from "@/lib/storefrontSeo";

const ROOT = process.cwd();
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("consulta pública de pedido (Shopify / Tiendanube)", () => {
  it("normaliza el número sin inventar pedidos", () => {
    expect(normalizeStoreOrderNumber("  ab-12 ")).toBe("AB-12");
    expect(normalizeStoreOrderNumber("")).toBe("");
    expect(normalizeStoreOrderNumber(null)).toBe("");
  });

  it("la ruta /seguimiento es privada, indexada en robots y cableada", () => {
    expect(parseRutaTienda("/tienda/demo/seguimiento")?.kind).toBe("private");
    expect(ROBOTS_DISALLOW_TIENDA).toContain("/tienda/*/seguimiento");

    const page = leer("src/pages/StorefrontPage.tsx");
    expect(page).toContain('path="seguimiento"');
    expect(page).toContain("StoreOrderLookup");
    expect(page).toContain("Consultar pedido");

    const lookup = leer("src/storefront/StoreOrderLookup.tsx");
    expect(lookup).toContain("getStoreOrderSecure");
    expect(lookup).toContain("saveOrderAccessToken");
    expect(lookup).toContain("normalizeStoreOrderNumber");
    expect(lookup).not.toMatch(/from\(["']ecommerce_orders["']\)/);
    expect(lookup).toContain("min-h-11");

    const layout = leer("src/storefront/StoreLayout.tsx");
    expect(layout).toContain("/seguimiento");
    expect(layout).toMatch(/Consultar mi pedido/);

    const order = leer("src/storefront/StoreOrder.tsx");
    expect(order).toContain("/seguimiento");
  });
});
