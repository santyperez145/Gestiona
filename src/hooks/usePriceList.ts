/**
 * usePriceList — el precio que le corresponde a un cliente según su lista.
 *
 * La cuenta **no está acá**: vive en `src/lib/priceListCalc.ts`, testeada. Este
 * hook sólo trae los datos y se los pasa.
 *
 * ⚠️ Antes la cuenta estaba duplicada acá y en la página de listas, sobre dos
 * generaciones de columnas distintas, y no coincidían: este hook leía
 * `price_lists.discount_pct` mientras la página escribía `discount_value`. Una
 * lista "Mayorista 20%" creada desde el menú cobraba el precio completo en el
 * POS, en silencio.
 *
 * Usage:
 *   const { getPrice, meta } = usePriceList(priceListId);
 *   const precio = getPrice(product, cantidad);
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  precioDeLista, type ListaDePrecios, type ItemDeLista,
} from "@/lib/priceListCalc";

interface UsePriceListReturn {
  loading: boolean;
  meta: ListaDePrecios | null;
  /**
   * Precio unitario ajustado. La cantidad importa: una lista puede tener
   * tramos ("desde 12 unidades, 30%").
   */
  getPrice: (product: { id: string; sale_price_ars?: number | null }, cantidad?: number) => number;
  items: ItemDeLista[];
}

export function usePriceList(priceListId: string | null | undefined): UsePriceListReturn {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<ListaDePrecios | null>(null);
  const [items, setItems] = useState<ItemDeLista[]>([]);

  useEffect(() => {
    if (!priceListId) {
      setMeta(null);
      setItems([]);
      return;
    }
    let cancelado = false;
    setLoading(true);
    Promise.all([
      supabase.from("price_lists")
        .select("id,name,discount_type,discount_value,is_default,is_active,valid_from,valid_until")
        .eq("id", priceListId).single(),
      supabase.from("price_list_items")
        .select("product_id,custom_price,discount_pct,min_quantity")
        .eq("price_list_id", priceListId),
    ]).then(([listRes, itemsRes]) => {
      if (cancelado) return;
      // Un error acá no puede volverse "esta lista no descuenta": sería cobrarle
      // el precio de mostrador a un mayorista sin avisarle a nadie.
      if (listRes.error) {
        console.error("No se pudo leer la lista de precios", listRes.error);
      }
      if (itemsRes.error) {
        console.error("No se pudieron leer los precios de la lista", itemsRes.error);
      }
      setMeta((listRes.data as ListaDePrecios) ?? null);
      setItems((itemsRes.data as ItemDeLista[]) ?? []);
    }).finally(() => { if (!cancelado) setLoading(false); });

    return () => { cancelado = true; };
  }, [priceListId]);

  const getPrice = useCallback(
    (product: { id: string; sale_price_ars?: number | null }, cantidad = 1): number =>
      precioDeLista(Number(product.sale_price_ars ?? 0), meta, items, product.id, cantidad).precio,
    [meta, items],
  );

  return { loading, meta, items, getPrice };
}
