/**
 * Saldo a favor aplicado a un pedido de la tienda (2026-10-30, migración
 * 20261030001400), para la ficha del comercio. La lista de pedidos se lee con
 * columnas fijas; esto lee sólo el pedido abierto con `*`, así funciona antes
 * y después de que la base tenga la columna (sin ella da 0).
 *
 * `estado` es el estado de pago y de entrega: si cambia, se vuelve a leer,
 * porque cancelar un pedido impago le devuelve el saldo al cliente
 * (20261030001500).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSaldoAplicado(orderId: string | null | undefined, estado: string | null | undefined): number {
  const [saldo, setSaldo] = useState(0);
  useEffect(() => {
    let vivo = true;
    setSaldo(0);
    if (!orderId) return;
    void supabase.from("ecommerce_orders").select("*").eq("id", orderId).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error("[pedido] no se pudo leer el saldo aplicado", error);
          return;
        }
        const valor = Number((data as { saldo_aplicado_ars?: unknown } | null)?.saldo_aplicado_ars ?? 0);
        setSaldo(Number.isFinite(valor) && valor > 0 ? valor : 0);
      });
    return () => { vivo = false; };
  }, [orderId, estado]);
  return saldo;
}
