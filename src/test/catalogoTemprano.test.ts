import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: el catálogo se pide junto con la tienda. Volver a pedirlo ante
// un error o un corte duplicaba los reintentos (8 en vez de 4, E2E del CI).
describe("catálogo temprano", () => {
  const src = fs.readFileSync("src/storefront/storeContext.tsx", "utf8");
  it("se pide con el slug antes de leer la tienda", () => {
    expect(src.indexOf('fetchStoreProducts("", slug, readOptions)')).toBeLessThan(src.indexOf('supabase.rpc("get_store_by_slug"'));
  });
  it("sólo se repite si el camino viejo necesita la organización", () => {
    expect(src).toContain("r.ok === false && r.error.code === CATALOGO_NECESITA_ORGANIZACION");
    expect(src).not.toContain("fetchStoreProducts(\"\", slug, readOptions).catch(() => null)");
  });
});
