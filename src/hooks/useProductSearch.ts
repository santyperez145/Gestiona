/**
 * useProductSearch — Real-time, offline-capable product search hook.
 *
 * Wraps Fuse.js fuzzy search over the product list with:
 *   - Configurable fields: name, barcode, category, brand, sku
 *   - Debounced query (default 200ms)
 *   - Stock filtering (in-stock only, low stock, etc.)
 *   - Category filter
 *   - Sorted results: exact matches first, then fuzzy
 *   - Returns highlighted match positions (for bolding matched text)
 *
 * Usage:
 *   const { results, setQuery, setFilter, query } = useProductSearch(products);
 *   // Attach to an Input; render results.map(r => r.item)
 *
 * Requires Fuse.js: import Fuse from "fuse.js"
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Fuse from "fuse.js";

interface Product {
  id: string;
  name: string;
  barcode?: string | null;
  category?: string | null;
  brand?: string | null;
  sku?: string | null;
  stock: number;
  sale_price_ars?: number | null;
  image_url?: string | null;
  low_stock_threshold?: number | null;
  [key: string]: unknown;
}

interface SearchFilter {
  category?: string;
  /** "all" | "instock" | "lowstock" | "outofstock" */
  stockFilter?: "all" | "instock" | "lowstock" | "outofstock";
  maxResults?: number;
}

export interface SearchResult {
  item: Product;
  score: number; // 0 = exact, 1 = worst
  matches?: ReadonlyArray<{ indices: ReadonlyArray<[number, number]>; key?: string }>;
}

const FUSE_KEYS = [
  { name: "name",     weight: 0.55 },
  { name: "brand",    weight: 0.20 },
  { name: "barcode",  weight: 0.15 },
  { name: "sku",      weight: 0.05 },
  { name: "category", weight: 0.05 },
];

function filterByStock(product: Product, filter: SearchFilter["stockFilter"]): boolean {
  if (!filter || filter === "all") return true;
  const threshold = product.low_stock_threshold ?? 3;
  if (filter === "instock")   return product.stock > threshold;
  if (filter === "lowstock")  return product.stock > 0 && product.stock <= threshold;
  if (filter === "outofstock") return product.stock <= 0;
  return true;
}

export function useProductSearch(products: Product[], defaultFilter?: SearchFilter) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>(defaultFilter ?? {});
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce query changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Build Fuse index on products change
  const fuse = useMemo(() => new Fuse<Product>(products, {
    keys: FUSE_KEYS,
    threshold: 0.4,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 1,
    shouldSort: true,
    useExtendedSearch: false,
  }), [products]);

  const results = useMemo((): SearchResult[] => {
    const maxResults = filter.maxResults ?? 50;
    let pool: SearchResult[];

    if (!debouncedQuery.trim()) {
      // No query: return all products sorted by name, apply filters
      pool = products.map(item => ({ item, score: 1, matches: [] }));
    } else {
      const raw = fuse.search(debouncedQuery);
      pool = raw.map(r => ({
        item: r.item,
        score: r.score ?? 1,
        matches: r.matches ?? [],
      }));
    }

    // Category filter
    if (filter.category && filter.category !== "all") {
      pool = pool.filter(r => r.item.category === filter.category);
    }

    // Stock filter
    if (filter.stockFilter && filter.stockFilter !== "all") {
      pool = pool.filter(r => filterByStock(r.item, filter.stockFilter));
    }

    return pool.slice(0, maxResults);
  }, [debouncedQuery, fuse, filter, products]);

  const clearSearch = useCallback(() => setQuery(""), []);

  return {
    query,
    setQuery,
    filter,
    setFilter,
    results,
    clearSearch,
    hasResults: results.length > 0,
    isEmpty: debouncedQuery.length > 0 && results.length === 0,
  };
}

/**
 * Utility: highlight matched characters in a product name.
 * Returns an array of { text, highlighted } segments.
 */
export function getHighlightSegments(
  text: string,
  matches?: ReadonlyArray<{ indices: ReadonlyArray<[number, number]>; key?: string }>,
  key = "name"
): Array<{ text: string; highlighted: boolean }> {
  if (!matches) return [{ text, highlighted: false }];
  const keyMatch = matches.find(m => m.key === key);
  if (!keyMatch?.indices.length) return [{ text, highlighted: false }];

  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let lastIndex = 0;
  for (const [start, end] of keyMatch.indices) {
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), highlighted: false });
    segments.push({ text: text.slice(start, end + 1), highlighted: true });
    lastIndex = end + 1;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), highlighted: false });
  return segments;
}
