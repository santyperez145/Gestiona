import { useEffect, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import { fetchCustomerTimeline, groupTimelineByDay, timelineErrorMessage, timelineFmtHora, timelineFmtMonto, timelineKindMeta, TIMELINE_PAGE_SIZE, type TimelineEvent } from '@/lib/crmTimelineDB';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';

const LINKED_LABEL: Record<TimelineEvent['linked_by'], string> = {
  id: '',
  nombre: 'cruzado por nombre',
  email: 'cruzado por email',
};

/**
 * Fila de tiempo unificada del cliente: ventas, pedidos online, notas,
 * WhatsApp y deudas en una sola lectura server-side.
 *
 * La RPC autoriza y cruza; este componente sólo muestra. Si la ficha todavía
 * no tiene id en `customers` (persona comprada antes de cargarse), no puede
 * pedir el timeline: las demás tabs cubren ese caso por nombre.
 */
export default function CustomerTimeline360({ orgId, customerId }: { orgId: string; customerId: string | null | undefined }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    if (!customerId) return;
    setError('');
    try {
      setEvents(await fetchCustomerTimeline(orgId, customerId, TIMELINE_PAGE_SIZE));
    } catch (cause) {
      console.error('CustomerTimeline360:', cause);
      setError(timelineErrorMessage(cause));
    }
  };

  // Recarga al cambiar de ficha: la timeline es de UN cliente.
  useEffect(() => {
    setEvents(null);
    setShowAll(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, customerId]);

  if (!customerId) return null;
  if (error) {
    return (
      <WorkspaceState
        kind="error-recoverable"
        layout="embedded"
        title={error}
        actionLabel="Reintentar"
        onAction={() => void load()}
      />
    );
  }
  if (events === null) {
    return <WorkspaceState kind="initial-loading" layout="embedded" title="Cargando historia del cliente" loadingRows={3} />;
  }
  if (events.length === 0) {
    return (
      <div className="border-t border-border/30 pt-3">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <History className="w-3 h-3" />Historia unificada
        </h3>
        <WorkspaceState
          kind="empty-first-use"
          layout="embedded"
          title="Todavía no pasó nada"
          description="Cuando este cliente compre, reciba un WhatsApp o registres una interacción, todo queda acá en una sola fila de tiempo."
        />
      </div>
    );
  }

  const visibles = showAll ? events : events.slice(0, 12);
  const days = groupTimelineByDay(visibles);

  return (
    <div className="border-t border-border/30 pt-3 pb-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <History className="w-3 h-3" />Historia unificada ({events.length})
        </h3>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>
      <div className="space-y-2">
        {days.map(({ day, events: delDia }) => (
          <div key={day}>
            <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide sticky top-0 bg-background/95 py-0.5">{day}</p>
            <div className="space-y-1">
              {delDia.map(e => {
                const meta = timelineKindMeta(e.kind);
                const cruce = LINKED_LABEL[e.linked_by];
                return (
                  <div key={e.source_id} className="flex gap-2 rounded-lg bg-muted/30 px-2.5 py-2 hover:bg-muted/50 transition-colors">
                    <span className="shrink-0 text-sm leading-5" aria-hidden="true">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-tight truncate">{e.title || meta.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                        <span className={meta.tone}>{meta.label}</span>
                        <span>· {timelineFmtHora(e.occurred_at)}</span>
                        {e.detail && <span>· {e.detail}</span>}
                        {cruce && <span className="italic opacity-70">· {cruce}</span>}
                      </p>
                    </div>
                    {e.amount_ars !== null && (
                      <span className={`text-xs font-mono font-semibold shrink-0 ${e.kind === 'deuda' ? 'text-destructive' : 'text-foreground'}`}>
                        {timelineFmtMonto(Number(e.amount_ars))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {events.length > 12 && (
        <button
          className="mt-2 text-[10px] text-primary hover:underline"
          onClick={() => setShowAll(s => !s)}
        >
          {showAll ? 'Mostrar menos' : `Ver los ${events.length - 12} eventos anteriores`}
          <ChevronDown className={`inline w-3 h-3 ml-0.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}