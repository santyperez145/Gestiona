import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * ¿Esta organización exige segundo factor a sus administradores? (2026-10-15)
 *
 * Había tres copias de esta lectura. El panel principal arrancaba en «no
 * exige» y, si `settings` no se podía leer, se quedaba en «no exige»: fallaba
 * abierto. Finance esperaba la respuesta, pero ante un error también decía
 * «no exige». Sólo Influencers fallaba cerrado. Ahora las tres usan esto:
 * mientras no se sabe, `cargando`; si no se pudo leer, `requerido: true`.
 */
const ESPERAS_MS = [700, 2_000];

export function usePoliticaMfa(orgId: string | null | undefined): { cargando: boolean; requerido: boolean } {
  const [politica, setPolitica] = useState<{ orgId: string; requerido: boolean } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelado = false;
    // Un error pasajero se reintenta antes de concluir: sin esto, un corte de
    // red mandaba a un administrador sin factor a dar de alta uno.
    const leer = (intento: number) => {
      const fallo = () => {
        if (cancelado) return;
        const espera = ESPERAS_MS[intento];
        if (espera === undefined) setPolitica({ orgId, requerido: true });
        else window.setTimeout(() => { if (!cancelado) leer(intento + 1); }, espera);
      };
      supabase.from("settings").select("mfa_required").eq("org_id", orgId).maybeSingle().then(
        ({ data, error }) => {
          if (cancelado) return;
          if (error) fallo();
          else setPolitica({ orgId, requerido: Boolean(data?.mfa_required) });
        },
        fallo,
      );
    };
    leer(0);
    return () => { cancelado = true; };
  }, [orgId]);

  if (!orgId) return { cargando: false, requerido: false };
  if (politica?.orgId !== orgId) return { cargando: true, requerido: true };
  return { cargando: false, requerido: politica.requerido };
}
