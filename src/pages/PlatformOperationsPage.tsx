import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock3, CreditCard, Loader2, RefreshCw,
  RotateCcw, Server, ShieldCheck, Webhook,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { usePlatformAccess } from '@/lib/usePermissions';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import FeatureFlagControls from '@/components/platform/FeatureFlagControls';

type OperationRow = Database['public']['Views']['platform_operations_queue']['Row'];

const SOURCE_META: Record<string, { label: string; icon: typeof Webhook }> = {
  outbox: { label: 'Entrega de eventos', icon: Webhook },
  meli_webhook: { label: 'MercadoLibre', icon: Webhook },
  payment_attempt: { label: 'Pagos', icon: CreditCard },
  cron: { label: 'Cron', icon: Server },
};

const STATUS_META: Record<string, { label: string; variant: 'destructive' | 'warning' | 'outline' }> = {
  descartado: { label: 'Descartado', variant: 'destructive' },
  fallado: { label: 'Falló', variant: 'warning' },
  stalled: { label: 'Sin avance', variant: 'warning' },
  error: { label: 'Error técnico', variant: 'destructive' },
  fallando: { label: 'Última corrida falló', variant: 'destructive' },
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Sin fecha'
    : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function asFunctionError(error: unknown, data: unknown) {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  if (error instanceof Error) return error.message;
  return 'No se pudo reintentar la entrega.';
}

export default function PlatformOperationsPage() {
  usePageTitle('Operaciones de plataforma');
  const { isPlatformStaff, isSuperadmin, loading: accessLoading } = usePlatformAccess();
  const { ask, dialog } = useConfirmDialog();
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [retryingTicket, setRetryingTicket] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('platform_operations_queue')
      .select('*')
      .order('priority', { ascending: true })
      .order('last_activity_at', { ascending: true, nullsFirst: false });
    if (queryError) {
      setRows([]);
      setError(queryError.message || 'No se pudo cargar la cola operativa.');
    } else {
      setRows((data || []) as OperationRow[]);
      setLoadedAt(new Date().toISOString());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isPlatformStaff && !accessLoading) void load();
  }, [accessLoading, isPlatformStaff, load]);

  const metrics = useMemo(() => ({
    critical: rows.filter(row => row.severity === 'critical').length,
    retryable: rows.filter(row => row.can_retry).length,
    stalled: rows.filter(row => row.status === 'stalled').length,
  }), [rows]);

  const retryOutbox = async (row: OperationRow) => {
    if (!row.ticket_id || !row.can_retry || !isSuperadmin) return;
    if (!(await ask({
      title: "¿Reintentar esta entrega descartada?",
      description: "La cola la volverá a procesar; el reintento queda auditado.",
      confirmText: "Reintentar",
      variant: "default",
    }))) return;

    setRetryingTicket(row.ticket_id);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke('platform-admin-action', {
      body: { action: 'retryOutboxDelivery', ticketId: row.ticket_id },
    });
    if (invokeError || !data?.ok) {
      setError(asFunctionError(invokeError, data));
    } else {
      await load();
    }
    setRetryingTicket(null);
  };

  if (accessLoading) {
    return <div className="flex items-center justify-center py-24 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Verificando permisos...</div>;
  }
  if (!isPlatformStaff) return <Navigate to="/" replace />;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Operaciones"
        description={`Incidentes activos de entrega, confirmaciones, pagos y tareas automáticas${loadedAt ? ` · actualizado ${formatDateTime(loadedAt)}` : ''}`}
        badge={{ label: 'Control Plane', variant: 'default' }}
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
        )}
      />

      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 rounded-[8px] p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div><p className="font-medium">No se pudo completar la operación</p><p className="text-xs text-muted-foreground mt-1">{error}</p></div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard label="Incidentes activos" value={loading ? '—' : rows.length} icon={AlertTriangle} color={rows.length > 0 ? 'warning' : 'success'} sub="fuentes cubiertas por la cola" />
        <KPICard label="Críticos" value={loading ? '—' : metrics.critical} icon={AlertTriangle} color={metrics.critical > 0 ? 'destructive' : 'success'} sub="prioridad de atención" />
        <KPICard label="Reintentables" value={loading ? '—' : metrics.retryable} icon={RotateCcw} color={metrics.retryable > 0 ? 'purple' : 'success'} sub="sólo entrega descartada" />
        <KPICard label="Sin avance" value={loading ? '—' : metrics.stalled} icon={Clock3} color={metrics.stalled > 0 ? 'warning' : 'success'} sub="procesos de entrega en pausa" />
      </div>

      <section className="border border-violet-500/20 bg-violet-500/[0.04] rounded-[10px] p-4 text-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 w-4 h-4 shrink-0 text-violet-300" />
          <div>
            <p className="font-semibold text-violet-100">Priorizar sin exponer datos sensibles</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">La cola no muestra payloads, destinos, IDs externos, montos ni errores crudos. Un reintento manual sólo existe para entregas descartadas y sólo para superadmin; nunca reintenta un cobro. Cada acción queda en <Link to="/platform/soporte" className="text-violet-300 hover:text-violet-200">la auditoría de soporte</Link>.</p>
          </div>
        </div>
      </section>

      <FeatureFlagControls isSuperadmin={isSuperadmin} />

      <section className="overflow-hidden border border-border/60 rounded-[10px] bg-card">
        <div className="border-b border-border/50 px-4 sm:px-5 py-4">
          <h2 className="text-sm font-semibold">Bandeja de incidentes</h2>
          <p className="text-[11px] text-muted-foreground mt-1">Ordenada por criticidad y antigüedad. “Sin avance” no se reintenta a ciegas: primero se inspecciona su fuente.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando incidentes...</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center text-center py-16 px-6">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 mb-3" />
            <p className="text-sm font-medium">No hay incidentes activos en las fuentes cubiertas</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">No se infiere que todos los proveedores estén sanos: significa que no hay entregas fallidas, confirmaciones detenidas, errores técnicos de pago ni tareas automáticas fallando en esta lectura.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {rows.map(row => {
              const source = SOURCE_META[row.source || ''] || SOURCE_META.outbox;
              const SourceIcon = source.icon;
              const status = STATUS_META[row.status || ''] || { label: row.status || 'Sin estado', variant: 'outline' as const };
              const canAct = Boolean(row.can_retry && isSuperadmin && row.source === 'outbox');
              return (
                <article key={`${row.source}:${row.ticket_id}`} className="grid gap-3 px-4 sm:px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(145px,.75fr)_minmax(150px,.8fr)_auto] lg:items-center">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className={`mt-0.5 w-8 h-8 rounded-[7px] border flex items-center justify-center shrink-0 ${row.severity === 'critical' ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}><SourceIcon className="w-3.5 h-3.5" /></span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{row.operation_label || source.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{row.org_name || (row.source === 'cron' ? 'Infraestructura de plataforma' : 'Comercio sin nombre disponible')} · {source.label}</p>
                    </div>
                  </div>
                  <div><Badge variant={status.variant}>{status.label}</Badge><p className="mt-1 text-[10px] text-muted-foreground">{row.attempts == null ? 'Sin contador' : `${row.attempts} intento${row.attempts === 1 ? '' : 's'}`}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última actividad</p><p className="mt-0.5 text-xs font-medium">{formatDateTime(row.last_activity_at)}</p></div>
                  <div className="flex items-center gap-2 lg:justify-end">
                    {canAct ? (
                      <Button size="sm" variant="outline" disabled={retryingTicket === row.ticket_id} onClick={() => void retryOutbox(row)}>
                        {retryingTicket === row.ticket_id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />} Reintentar
                      </Button>
                    ) : row.org_id && row.recommended_action === 'review_merchant' ? (
                      <Link to={`/platform/orgs/${row.org_id}`} className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">Ver comercio</Link>
                    ) : row.recommended_action === 'open_system' ? (
                      <Link to="/platform/sistema" className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">Ver sistema</Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{row.recommended_action === 'await_worker' ? 'Reintento automático' : 'Revisión requerida'}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {dialog}
    </div>
  );
}
