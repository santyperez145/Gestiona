import { describe, expect, it } from "vitest";
import {
  RECENTLY_VIEWED_MAX,
  listRecentlyViewed,
  productsFromRecentlyViewed,
  recordView,
  recentlyViewedIds,
} from "@/lib/recentlyViewed";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.has(k) ? map.get(k)! : null; },
    key(i) { return [...map.keys()][i] ?? null; },
    removeItem(k) { map.delete(k); },
    setItem(k, v) { map.set(k, String(v)); },
  };
}

describe("recentlyViewed", () => {
  it("registra y ordena por más reciente", () => {
    const storage = memoryStorage();
    recordView("tienda-a", "p1", { now: 1, storage });
    recordView("tienda-a", "p2", { now: 2, storage });
    recordView("tienda-a", "p1", { now: 3, storage });
    expect(recentlyViewedIds("tienda-a", storage)).toEqual(["p1", "p2"]);
  });

  it("no mezcla slugs", () => {
    const storage = memoryStorage();
    recordView("a", "x", { storage });
    recordView("b", "y", { storage });
    expect(recentlyViewedIds("a", storage)).toEqual(["x"]);
    expect(recentlyViewedIds("b", storage)).toEqual(["y"]);
  });

  it("respeta el tope y cruza con catálogo", () => {
    const storage = memoryStorage();
    for (let i = 0; i < RECENTLY_VIEWED_MAX + 5; i++) {
      recordView("s", `p${i}`, { now: i, storage });
    }
    expect(listRecentlyViewed("s", storage)).toHaveLength(RECENTLY_VIEWED_MAX);
    // Tras el tope quedan los más recientes: p16 … p5.
    const catalog = [{ id: "p16" }, { id: "p15" }, { id: "missing" }];
    const products = productsFromRecentlyViewed("s", catalog, { storage, limit: 5 });
    expect(products.map(p => p.id)).toEqual(["p16", "p15"]);
  });
});
