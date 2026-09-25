import { supabase as _supabase } from '@/integrations/supabase/client';

// customer_timeline_360 es un RPC nuevo: los tipos generados aún no lo traen.
export const sb: any = _supabase;

/** Un evento de la fila de tiempo unificada del cliente. */
export type TimelineEvent = {
  kind: 'venta' | 'pedido_online' | 'nota' | 'whatsapp' | 'deuda';
  occurred_at: string;
  title: string;
  detail: string | null;
  amount_ars: number | null;
  source_id: string;
  linked_by: 'id' | 'nombre' | 'email';
};

export const TIMELINE_PAGE_SIZE = 40;

/** Mensaje legible del error para la UI (sin exponer códigos de Postgres). */
export function timelineErrorMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('customers_permission_denied') || message.includes('not_authenticated')) {
    return 'No tenés permiso para ver la historia de este cliente.';
  }
  if (message.includes('customer_not_found')) return 'El cliente ya no existe. Actualizá el listado.';
  if (message.includes('invalid_limit') || message.includes('invalid_offset')) {
    return 'La página pedida no es válida. Volvé a abrir la ficha.';
  }
  return 'No pudimos cargar la historia del cliente. Revisá tu conexión e intentá de nuevo.';
}

/**
 * Lee la fila de tiempo 360 del cliente desde el servidor.
 * La RPC valida membresía + permiso `customers:view` y que la ficha pertenezca
 * a la org pedida; el cliente nunca declara al cliente ni filtra por su cuenta.
 */
export async function fetchCustomerTimeline(
  orgId: string,
  customerId: string,
  limit = TIMELINE_PAGE_SIZE,
  offset = 0,
): Promise<TimelineEvent[]> {
  const { data, error } = await sb.rpc('customer_timeline_360', {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as TimelineEvent[];
}

const KIND_META: Record<TimelineEvent['kind'], { label: string; icon: string; tone: string }> = {
  venta: { label: 'Venta', icon: '🛒', tone: 'text-emerald-400' },
  pedido_online: { label: 'Pedido online', icon: '📦', tone: 'text-blue-400' },
  nota: { label: 'Interacción', icon: '📌', tone: 'text-amber-400' },
  whatsapp: { label: 'WhatsApp', icon: '💬', tone: 'text-green-400' },
  deuda: { label: 'Deuda', icon: '💳', tone: 'text-destructive' },
};

export function timelineKindMeta(kind: TimelineEvent['kind']) {
  return KIND_META[kind] ?? { label: kind, icon: '•', tone: 'text-muted-foreground' };
}

const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

const fmtMonto = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

/** Un día agrupado de la timeline, para el render con separador por fecha. */
export function groupTimelineByDay(events: TimelineEvent[]): { day: string; events: TimelineEvent[] }[] {
  const days: { day: string; events: TimelineEvent[] }[] = [];
  for (const e of events) {
    const day = fmtFecha(e.occurred_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.events.push(e);
    else days.push({ day, events: [e] });
  }
  return days;
}

export { fmtFecha as timelineFmtFecha, fmtHora as timelineFmtHora, fmtMonto as timelineFmtMonto };