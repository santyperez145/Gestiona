/**
 * ¿La organización puede cobrar online?
 *
 * Antes cada pantalla lo resolvía por su cuenta mirando
 * `settings.mp_access_token`, el token pegado a mano. Con la conexión por OAuth
 * esa columna quedó vacía, así que las tres respondían que no había forma de
 * cobrar mientras la cuenta estaba perfectamente conectada — y una de esas
 * respuestas alimenta el panel de "listo para vender" de la tienda.
 *
 * La verdad vive en `payment_connection_status`, una vista que dice si hay
 * conexión y con qué cuenta **sin exponer el token**. La tabla de abajo tiene
 * RLS con cero policies a propósito: sólo la tocan las Edge Functions.
 */
import { supabase } from '@/integrations/supabase/client';

export interface EstadoDeCobro {
  /** Hay una cuenta conectada y utilizable. */
  connected: boolean;
  /** Nombre de la cuenta, para mostrar cuál está enganchada. */
  nickname: string | null;
  /** `true` si viene del token pegado a mano y no de OAuth. */
  legacy: boolean;
}

const SIN_CONEXION: EstadoDeCobro = { connected: false, nickname: null, legacy: false };

/**
 * No se traga los errores: si la vista todavía no existe (migración sin
 * aplicar) se responde "sin conexión", pero cualquier otro error se reporta.
 * Un "no tengo permiso" y un "no hay nada" son problemas opuestos.
 */
export async function fetchPaymentStatus(orgId: string): Promise<EstadoDeCobro> {
  if (!orgId) return SIN_CONEXION;

  const { data, error } = await supabase
    .from('payment_connection_status')
    .select('provider, connected, nickname')
    .eq('org_id', orgId)
    .eq('provider', 'mercadopago')
    .maybeSingle();

  if (error) {
    const relacionInexistente = ['42P01', 'PGRST205'].includes(error.code ?? '');
    if (!relacionInexistente) {
      console.error('[cobros] error leyendo payment_connection_status:', error.message);
    }
    return SIN_CONEXION;
  }

  const fila = data as { connected?: boolean; nickname?: string | null } | null;
  return {
    connected: !!fila?.connected,
    nickname: fila?.nickname ?? null,
    legacy: false,
  };
}
