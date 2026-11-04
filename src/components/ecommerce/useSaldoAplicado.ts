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

/**
 * Lectura única del saldo aplicado (2026-11-04): el diálogo «¿Marcar como
 * cobrado?» de la fila no lo leía y pedía verificar el total entero aunque el
 * comprador hubiera pagado una parte con saldo a favor. Sin la columna da 0;
 * con error da null y lo registra (2026-11-04): el diálogo de cobro no puede
 * afirmar un importe exacto si no sabe si hubo saldo.
 */
export async function leerSaldoAplicado(orderId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.from("ecommerce_orders").select("*").eq("id", orderId).maybeSingle();
    if (error) {
      console.error("[pedido] no se pudo leer el saldo aplicado", error);
      return null;
    }
    const valor = Number((data as { saldo_aplicado_ars?: unknown } | null)?.saldo_aplicado_ars ?? 0);
    return Number.isFinite(valor) && valor > 0 ? valor : 0;
  } catch (error) {
    console.error("[pedido] no se pudo leer el saldo aplicado", error);
    return null;
  }
}

export function useSaldoAplicado(orderId: string | null | undefined, estado: string | null | undefined): number {
  const [saldo, setSaldo] = useState(0);
  useEffect(() => {
    let vivo = true;
    setSaldo(0);
    if (!orderId) return;
    void leerSaldoAplicado(orderId).then(valor => { if (vivo) setSaldo(valor ?? 0); });
    return () => { vivo = false; };
  }, [orderId, estado]);
  return saldo;
}
