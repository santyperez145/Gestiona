/**
 * Saldo a favor del comprador y política de cambios de la tienda
 * (2026-10-30, migración 20261030000200). `mi_saldo_en_tienda` es pública:
 * sin sesión devuelve saldo 0 y el plazo de cambios, que la pantalla de
 * devoluciones necesita para ofrecer (o no) la opción de cambio.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { retryPublicRead } from "@/lib/publicDataSource";

export interface SaldoTienda {
  saldo: number;
  /** Días para pedir un cambio; 0 = la tienda no hace cambios online. */
  plazoCambioDias: number;
}

/** Lee la respuesta del RPC sin confiar en su forma. */
export function saldoDesdeRespuesta(data: unknown): SaldoTienda {
  const r = (data ?? {}) as { saldo?: unknown; plazo_cambio_dias?: unknown };
  const saldo = Number(r.saldo);
  const plazo = Number(r.plazo_cambio_dias);
  return {
    saldo: Number.isFinite(saldo) && saldo > 0 ? Math.round(saldo * 100) / 100 : 0,
    plazoCambioDias: Number.isFinite(plazo) && plazo > 0 ? Math.round(plazo) : 0,
  };
}

/**
 * `null` mientras carga o si la base todavía no tiene la función: quien lo usa
 * no ofrece el saldo y deja la opción de cambio a criterio de la base.
 * `recargar` se usa con la sesión: el saldo es del comprador logueado.
 */
export function useSaldoTienda(slug: string | undefined, sesion?: string | null) {
  const [info, setInfo] = useState<SaldoTienda | null>(null);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    if (!slug) return;
    let vivo = true;
    void retryPublicRead(() =>
      supabase.rpc("mi_saldo_en_tienda" as never, { p_slug: slug } as never),
    ).then(({ data, error }) => {
      if (!vivo) return;
      if (error) {
        console.error("[saldo] no se pudo leer el saldo a favor:", error.message);
        setInfo(null);
        return;
      }
      setInfo(saldoDesdeRespuesta(data));
    }, () => { if (vivo) setInfo(null); });
    return () => { vivo = false; };
  }, [slug, sesion, version]);

  return { info, recargar };
}
