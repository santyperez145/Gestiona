/**
 * usePriceList — Compute adjusted prices for a given price list.
 *
 * Given a list of products and a selected price list, returns the adjusted
 * ARS price for each product. Used in POS and product display.
 *
 * Priority order:
 *   1. Product-specific override in `price_list_items` (if set)
 *   2. Global discount_type/value of the price list applied to `sale_price_ars`
 *   3. Base `sale_price_ars` (no adjustment)
 *
 * Usage:
 *   const { getPrice, loading } = usePriceList(priceListId);
 *
 *   // In POS item renderer:
 *   const price = getPrice(product); // returns adjusted ARS price
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface PriceListItem {
  product_id: string;
  custom_price: number | null;
  discount_pct: number | null;
  min_quantity: number;
}

interface PriceListMeta {
  id: string;
  name: string;
  discount_type: string;
  discount_value: number;
  is_default: boolean;
}

interface UsePriceListReturn {
  /** True while fetching price list data */
  loading: boolean;
  /** Price list metadata */
  meta: PriceListMeta | null;
  /**
   * Get the adjusted price for a product.
   * Returns the modified ARS price, or the product's base price if no list is active.
   */
  getPrice: (product: { id: string; sale_price_ars?: number | null }) => number;
  /** The per-product override map */
  items: Record<string, PriceListItem>;
}

export function usePriceList(priceListId: string | null | undefined): UsePriceListReturn {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<PriceListMeta | null>(null);
  const [items, setItems] = useState<Record<string, PriceListItem>>({});

  useEffect(() => {
    if (!priceListId) {
      setMeta(null);
      setItems({});
      return;
    }
    setLoading(true);
    Promise.all([
      supabase.from("price_lists").select("id,name,discount_type,discount_value,is_default").eq("id", priceListId).single(),
      supabase.from("price_list_items").select("product_id,custom_price,discount_pct,min_quantity").eq("price_list_id", priceListId).order("min_quantity", { ascending: false }),
    ]).then(([listRes, itemsRes]) => {
      if (listRes.data) setMeta(listRes.data as PriceListMeta);
      if (itemsRes.data) {
        const map: Record<string, PriceListItem> = {};
        (itemsRes.data as PriceListItem[]).forEach(i => { map[i.product_id] = i; });
        setItems(map);
      }
    }).finally(() => setLoading(false));
  }, [priceListId]);

  const getPrice = useCallback(
    (product: { id: string; sale_price_ars?: number | null }): number => {
      const base = Number(product.sale_price_ars ?? 0);
      if (!meta || !priceListId) return base;

      const override = items[product.id];
      if (override) {
        if (override.custom_price != null) return override.custom_price;
        if (override.discount_pct != null) return Math.round(base * (1 - override.discount_pct / 100));
      }

      // Apply global list discount
      if (meta.discount_type === "percentage" && meta.discount_value > 0) return Math.round(base * (1 - meta.discount_value / 100));
      if (meta.discount_type === "fixed" && meta.discount_value > 0) return Math.max(0, Math.round(base - meta.discount_value));
      return base;
    },
    [meta, items, priceListId]
  );

  return { loading, meta, items, getPrice };
}
