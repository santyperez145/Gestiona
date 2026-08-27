import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';

/**
 * El cambio de precio que le van a aplicar a esta organización, si hay uno.
 *
 * ── Por qué el comercio tiene que verlo en pantalla ───────────────────────
 *
 * El aviso formal va por mail, y el mail se pierde: cae en promociones, lo
 * recibe una casilla que nadie mira, o el destinatario ya no trabaja ahí.
 * `subscriptions.mp_payer_email` es la casilla de quien contrató, que no
 * siempre es quien entra todos los días.
 *
 * 📌 Que además esté en el panel no es redundancia: es la diferencia entre
 * «se le notificó» y «se enteró». Y si el comercio prefiere irse antes de que
 * rija, tiene que poder verlo a tiempo para hacerlo.
 */
export interface CambioDePrecio {
  target_id: string;
  precio_anterior: number | null;
  precio_nuevo: number;
  vigente_desde: string;
  motivo: string | null;
  ciclo: string;
  estado: string;
  sube: boolean;
  dias_para_que_rija: number;
}

/** La relación todavía no existe en esta base. */
function noExiste(code: string | undefined): boolean {
  return code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202';
}

export function useCambioDePrecio() {
  const { activeOrg } = useOrg();
  const [cambio, setCambio] = useState<CambioDePrecio | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrg?.id) { setCambio(null); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('mi_cambio_de_precio')
      .select('*')
      .eq('org_id', activeOrg.id)
      // El más cercano manda: es el que el comercio necesita ver primero.
      .order('vigente_desde', { ascending: true })
      .limit(1)
      .maybeSingle();

    // No se traga: un error real tiene que verse. La relación inexistente sí
    // justifica el silencio — la migración puede no estar aplicada todavía.
    if (error && !noExiste(error.code)) {
      console.error('mi_cambio_de_precio falló', error);
    }
    setCambio((data as unknown as CambioDePrecio) ?? null);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => { void load(); }, [load]);

  return { cambio, loading, refresh: load };
}
