/**
 * Cuotas reales del comercio para un monto, pedidas a `mp-installments`.
 *
 * El hook no calcula nada: la función pregunta a MercadoPago con la clave del
 * comercio y devuelve lo que esa cuenta puede ofrecer. Ver `src/lib/installments.ts`
 * para por qué no se dividen el precio y listo.
 *
 * Falla en silencio a propósito. Si MercadoPago no contesta, o la tienda no
 * cobra con MercadoPago, o no está conectada por OAuth, la ficha simplemente no
 * muestra la línea de cuotas — que es como estaba antes. Un error acá no puede
 * romper la página del producto.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { convieneConsultar, type RespuestaCuotas } from "@/lib/installments";

/** Se cachea por tienda+monto: al cambiar de variante se repite el mismo pedido. */
const cache = new Map<string, RespuestaCuotas>();

export function useInstallments(slug: string | undefined, monto: number | null | undefined): RespuestaCuotas | null {
  const [datos, setDatos] = useState<RespuestaCuotas | null>(null);

  useEffect(() => {
    if (!slug || !convieneConsultar(monto)) { setDatos(null); return; }

    // Se redondea para no partir el caché por diferencias de centavos entre
    // variantes que cuestan casi lo mismo.
    const amount = Math.round(Number(monto));
    const clave = `${slug}:${amount}`;

    const enCache = cache.get(clave);
    if (enCache) { setDatos(enCache); return; }

    let cancelado = false;
    supabase.functions
      .invoke("mp-installments", { body: { slug, amount } })
      .then(({ data, error }) => {
        if (cancelado || error || !data) return;
        const r = data as RespuestaCuotas;
        cache.set(clave, r);
        setDatos(r);
      })
      .catch(() => { /* sin cuotas: la ficha se muestra igual */ });

    return () => { cancelado = true; };
  }, [slug, monto]);

  return datos;
}
