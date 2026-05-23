/**
 * useProductRecommendations
 *
 * Computes "frequently bought together" recommendations using co-occurrence
 * analysis of the last 90 days of sales. Groups sales by exact `date`
 * (since POS assigns the same ISO timestamp to all items in one transaction).
 *
 * Returns a function: getRecommendations(productId) → top-N products
 */
import { useMemo } from "react";

interface SaleRow {
  product_id: string;
  product_name: string;
  date: string; // ISO string — same for all items in one POS transaction
  quantity: number;
}

export interface Recommendation {
  product_id: string;
  product_name: string;
  coCount: number; // how many times bought together
}

export function useProductRecommendations(
  sales: SaleRow[],
  topN = 3
): (productId: string) => Recommendation[] {
  // Build co-occurrence map: productA → { productB: count }
  const coMap = useMemo<Map<string, Map<string, { name: string; count: number }>>>(() => {
    // Group sales by exact date (same POS transaction)
    const byDate = new Map<string, { id: string; name: string }[]>();
    sales.forEach(s => {
      if (!s.product_id) return;
      const bucket = byDate.get(s.date) ?? [];
      // Avoid duplicate products in same transaction (shouldn't happen but safety check)
      if (!bucket.find(b => b.id === s.product_id)) {
        bucket.push({ id: s.product_id, name: s.product_name });
      }
      byDate.set(s.date, bucket);
    });

    // Build co-occurrence counts
    const coOccurrence = new Map<string, Map<string, { name: string; count: number }>>();
    byDate.forEach(items => {
      if (items.length < 2) return; // single-product transaction — no co-occurrence
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const a = items[i];
          const b = items[j];
          if (!coOccurrence.has(a.id)) coOccurrence.set(a.id, new Map());
          const inner = coOccurrence.get(a.id)!;
          const existing = inner.get(b.id);
          inner.set(b.id, { name: b.name, count: (existing?.count ?? 0) + 1 });
        }
      }
    });

    return coOccurrence;
  }, [sales]);

  return (productId: string): Recommendation[] => {
    const related = coMap.get(productId);
    if (!related) return [];
    return Array.from(related.entries())
      .map(([id, { name, count }]) => ({ product_id: id, product_name: name, coCount: count }))
      .sort((a, b) => b.coCount - a.coCount)
      .slice(0, topN);
  };
}
