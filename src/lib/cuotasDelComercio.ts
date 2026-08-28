import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Las cuotas que el comercio ofrece de verdad, para mostrarlas donde antes
 * había un texto fijo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ El catálogo prometía **«Tarjeta 3 cuotas sin interés»** escrito a mano, en
 * tres lugares: la pantalla, el PDF que se manda por WhatsApp y el catálogo
 * público. Sin mirar la configuración.
 *
 * Medido el 2026-08-27: el comercio tenía **3 y 12** cuotas sin interés
 * configuradas. El texto fijo le subestimaba la oferta — y a un comercio que no
 * ofrece cuotas se las prometía igual.
 *
 * 📌 Una financiación que se promete y no existe es lo que hace que alguien
 * decida comprar y después no pueda.
 */

export interface CuotaOfrecida {
  installments: number;
  sin_interes: boolean;
  monto_minimo: number;
}

/**
 * Lee las cuotas activas del comercio. Una sola consulta por pantalla: el
 * catálogo tiene cientos de productos y pedirlo por producto sería una consulta
 * por fila.
 */
export function useCuotasDelComercio(orgId?: string | null) {
  const [cuotas, setCuotas] = useState<CuotaOfrecida[]>([]);

  useEffect(() => {
    if (!orgId) { setCuotas([]); return; }
    let vivo = true;
    void (async () => {
      const { data, error } = await supabase.rpc("cuotas_publicas", { p_org: orgId });
      if (!vivo) return;
      if (error) {
        // No se traga en silencio: sin esto no se muestran cuotas, y saber por
        // qué es la diferencia entre «no ofrece» y «no se pudo leer».
        console.error("cuotas_publicas falló", error);
        setCuotas([]);
        return;
      }
      setCuotas((data ?? []) as CuotaOfrecida[]);
    })();
    return () => { vivo = false; };
  }, [orgId]);

  return cuotas;
}

/**
 * La mejor opción sin interés para un precio: la de más cuotas cuyo mínimo
 * alcanza.
 *
 * 📌 Sólo sin interés. «6 cuotas con interés» no es un gancho: el comprador
 * ve un total más caro y se va. Si el comercio sólo ofrece con interés, esto
 * devuelve `null` y no se muestra nada — que es más honesto que anunciar una
 * financiación que encarece.
 */
export function mejorSinInteres(
  cuotas: CuotaOfrecida[], precio: number,
): CuotaOfrecida | null {
  const aptas = cuotas.filter(
    c => c.sin_interes && c.installments > 1 && precio >= Number(c.monto_minimo ?? 0),
  );
  if (aptas.length === 0) return null;
  return aptas.reduce((a, b) => (b.installments > a.installments ? b : a));
}

/** «3 cuotas sin interés de $12.500». Vacío si no hay ninguna que aplique. */
export function textoDeCuotas(
  cuotas: CuotaOfrecida[], precio: number, fmt: (n: number) => string,
): string {
  const mejor = mejorSinInteres(cuotas, precio);
  if (!mejor) return "";
  return `${mejor.installments} cuotas sin interés de ${fmt(precio / mejor.installments)}`;
}
