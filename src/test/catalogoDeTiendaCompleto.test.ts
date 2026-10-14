import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { fetchStoreCatalog } from "@/lib/storeCatalogApi";

// 2026-10-14: la API corta toda lista en 1.000 filas y Famatina tiene 11.518
// productos publicados. La tienda, el feed y el sitemap leen el catálogo
// completo como un solo JSON (get_store_catalog_completo).
describe("catálogo de la tienda completo", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("feed y sitemap piden el JSON completo y recortan a las columnas pedidas", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      llamadas.push(url);
      return new Response(JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ id: `p${i}`, category: "c", name: "x", secreto: "no" }))), { status: 200 });
    }));
    const r = await fetchStoreCatalog<{ id: string; category: string }>({ supabaseUrl: "https://x", supabaseKey: "k", slug: "s", select: "id,category" });
    expect(llamadas[0]).toContain("/rpc/get_store_catalog_completo");
    expect(r.data).toHaveLength(1500);
    expect(r.data?.[0]).toEqual({ id: "p0", category: "c" });
  });

  it("si la función nueva no existe, cae a la lista de filas", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      llamadas.push(url);
      return url.includes("completo") ? new Response("{}", { status: 404 }) : new Response("[]", { status: 200 });
    }));
    const r = await fetchStoreCatalog({ supabaseUrl: "https://x", supabaseKey: "k", slug: "s", select: "id" });
    expect(llamadas[1]).toContain("/rpc/get_store_catalog_products");
    expect(r.data).toEqual([]);
  });

  it("con filtro (una ficha) sigue usando la lista de filas", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { llamadas.push(url); return new Response("[]", { status: 200 }); }));
    await fetchStoreCatalog({ supabaseUrl: "https://x", supabaseKey: "k", slug: "s", select: "id", filters: { id: "eq.1" }, limit: 1 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toContain("/rpc/get_store_catalog_products");
  });

  it("la tienda lee primero el catálogo completo", () => {
    const fuente = fs.readFileSync("src/lib/publicDataSource.ts", "utf8");
    expect(fuente.indexOf("'get_store_catalog_completo'")).toBeGreaterThan(-1);
    expect(fuente.indexOf("'get_store_catalog_completo'")).toBeLessThan(fuente.indexOf("'get_store_catalog_products',"));
  });
});
