/**
 * ¿La organización puede cobrar online?
 *
 * Antes cada pantalla lo resolvía por su cuenta mirando una credencial heredada
 * de `settings`. La conexión OAuth es ahora la única autoridad.
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
}

const SIN_CONEXION: EstadoDeCobro = { connected: false, nickname: null };

/**
 * No se traga los errores: si la vista todavía no existe (migración sin
 * aplicar) se responde "sin conexión", pero cualquier otro error se reporta.
 * Un "no tengo permiso" y un "no hay nada" son problemas opuestos.
 */
export async function fetchPaymentStatus(orgId: string): Promise<EstadoDeCobro> {
  if (!orgId) return SIN_CONEXION;

  const { data, error } = await supabase
    .from('payment_connection_status')
    // ⚠️ La columna de la vista se llama `conectado`, no `connected`. Pedirla
    // mal devolvia 400 y el estado de cobro salia SIEMPRE "sin conectar",
    // con la cuenta vinculada. El alias conserva el nombre en JS.
    .select('provider, connected:conectado, nickname')
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
  };
}
