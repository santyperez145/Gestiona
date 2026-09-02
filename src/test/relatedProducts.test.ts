import { describe, expect, it } from "vitest";
import {
  RELATED_WEIGHTS,
  productIdsFromStoreOrders,
  scoreRelatedProducts,
  suggestionsFromOrderSeeds,
} from "@/lib/relatedProducts";

const c = (over: Partial<{ id: string; brand: string; category: string; stock: number; total_sold: number; maneja_stock: boolean }> & { id: string }) => ({
  brand: null as string | null,
  category: null as string | null,
  stock: 5,
  total_sold: 0,
  maneja_stock: true,
  ...over,
});

describe("scoreRelatedProducts", () => {
  it("prioriza coocurrencia sobre misma categoría", () => {
    const seed = { brand: "A", category: "cat" };
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed,
      candidates: [
        c({ id: "cooc", category: "otra", total_sold: 0 }),
        c({ id: "cat", category: "cat", total_sold: 100 }),
      ],
      cooccurrenceScores: { cooc: 10 },
      limit: 2,
    });
    expect(out[0].product.id).toBe("cooc");
    expect(out[0].reasons).toContain("cooccurrence");
  });

  it("penaliza sin stock cuando maneja_stock", () => {
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed: { brand: "X", category: "c" },
      candidates: [
        c({ id: "agotado", brand: "X", category: "c", stock: 0 }),
        c({ id: "ok", brand: "X", category: "c", stock: 3, total_sold: 1 }),
      ],
      preferInStock: true,
    });
    expect(out[0].product.id).toBe("ok");
  });

  it("no penaliza servicios (maneja_stock false)", () => {
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed: { brand: null, category: "svc" },
      candidates: [c({ id: "corte", category: "svc", stock: 0, maneja_stock: false, total_sold: 5 })],
      preferInStock: true,
    });
    expect(out.map(x => x.product.id)).toContain("corte");
    expect(out[0].score).toBeGreaterThan(0);
  });

  it("excluye la semilla y excludeIds", () => {
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed: { brand: "B", category: "c" },
      candidates: [c({ id: "seed", brand: "B" }), c({ id: "x", brand: "B" }), c({ id: "y", brand: "B" })],
      excludeIds: ["x"],
    });
    expect(out.map(r => r.product.id)).toEqual(["y"]);
  });

  it("suma boost de afinidad sin reemplazar coocurrencia ni asumir rubro", () => {
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed: { brand: null, category: null },
      candidates: [c({ id: "p1" }), c({ id: "p2" })],
      cooccurrenceScores: { p1: 2 },
      attributeScores: { p2: 100 },
    });
    expect(out[0].product.id).toBe("p1");
    expect(RELATED_WEIGHTS.cooccurrence).toBeGreaterThan(RELATED_WEIGHTS.attribute);
  });

  it("sin attributeScores funciona igual (tienda de cualquier rubro)", () => {
    const out = scoreRelatedProducts({
      seedId: "seed",
      seed: { brand: "Acme", category: "herramientas" },
      candidates: [
        c({ id: "taladro", brand: "Acme", category: "herramientas", total_sold: 4 }),
        c({ id: "otro", brand: "Otra", category: "pintura" }),
      ],
    });
    expect(out[0].product.id).toBe("taladro");
    expect(out[0].reasons).not.toContain("affinity");
  });
});

describe("productIdsFromStoreOrders / suggestionsFromOrderSeeds", () => {
  it("extrae product_id sin duplicar, recientes primero", () => {
    const ids = productIdsFromStoreOrders([
      { created_at: "2026-01-01", items: [{ product_id: "a" }] },
      { created_at: "2026-02-01", items: [{ product_id: "b" }, { product_id: "a" }] },
    ]);
    expect(ids).toEqual(["b", "a"]);
  });

  it("sugiere desde semillas excluyendo ya comprados", () => {
    const catalog = [
      c({ id: "comprado", brand: "M", category: "c" }),
      c({ id: "parecido", brand: "M", category: "c", total_sold: 3 }),
      c({ id: "otro", brand: "Z", category: "x" }),
    ];
    const out = suggestionsFromOrderSeeds(["comprado"], catalog, { limit: 4 });
    expect(out.map(x => x.product.id)).toContain("parecido");
    expect(out.map(x => x.product.id)).not.toContain("comprado");
  });
});
