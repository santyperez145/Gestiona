import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Eye, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  diagnosticBoolean,
  diagnosticNumber,
  diagnosticText,
  getSupportDiagnosticSnapshot,
  listPlatformSupportDiagnosticRequests,
  requestSupportDiagnosticAccess,
  revokeSupportDiagnosticAccess,
  SUPPORT_DIAGNOSTIC_REASONS,
  type PlatformSupportDiagnosticRequest,
  type SupportDiagnosticReason,
  type SupportDiagnosticSnapshot,
} from '@/lib/supportDiagnosticAccess';

interface SupportDiagnosticAccessPanelProps {
  orgId: string;
  canRequest: boolean;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: 'Esperando aprobación del owner', className: 'border-amber-500/25 bg-amber-500/[0.05] text-amber-300' },
  active: { label: 'Diagnóstico autorizado', className: 'border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-300' },
  expired: { label: 'Acceso vencido', className: 'border-border bg-muted/20 text-muted-foreground' },
  revoked: { label: 'Acceso revocado', className: 'border-border bg-muted/20 text-muted-foreground' },
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fmt(value: number | null, suffix = '') {
  return value == null ? 'Sin dato' : `${value.toLocaleString('es-AR')}${suffix}`;
}

export default function SupportDiagnosticAccessPanel({ orgId, canRequest }: SupportDiagnosticAccessPanelProps) {
  const [requests, setRequests] = useState<PlatformSupportDiagnosticRequest[]>([]);
  const [reason, setReason] = useState<SupportDiagnosticReason>('activation');
  const [snapshot, setSnapshot] = useState<SupportDiagnosticSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await listPlatformSupportDiagnosticRequests(orgId));
    } catch (loadError) {
      setRequests([]);
      setError(messageOf(loadError, 'No se pudieron leer las solicitudes de diagnóstico.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    setSnapshot(null);
    void load();
  }, [load]);

  const currentRequest = useMemo(() => (
    requests.find(request => request.status === 'active')
    || requests.find(request => request.status === 'pending')
    || requests[0]
    || null
  ), [requests]);

  const requestAccess = async () => {
    setActing(true);
    try {
      await requestSupportDiagnosticAccess(orgId, reason);
      toast.success('Solicitud enviada al owner del comercio');
      setSnapshot(null);
      await load();
    } catch (requestError) {
      toast.error(messageOf(requestError, 'No se pudo solicitar el diagnóstico'));
    } finally {
      setActing(false);
    }
  };

  const openSnapshot = async () => {
    if (!currentRequest?.id) return;
    setActing(true);
    try {
      setSnapshot(await getSupportDiagnosticSnapshot(currentRequest.id));
      await load();
    } catch (snapshotError) {
      setSnapshot(null);
      toast.error(messageOf(snapshotError, 'No se pudo abrir el diagnóstico'));
    } finally {
      setActing(false);
    }
  };

  const revoke = async () => {
    if (!currentRequest?.id) return;
    setActing(true);
    try {
      await revokeSupportDiagnosticAccess(currentRequest.id);
      setSnapshot(null);
      toast.success('Acceso de diagnóstico cerrado');
      await load();
    } catch (revokeError) {
      toast.error(messageOf(revokeError, 'No se pudo cerrar el acceso'));
    } finally {
      setActing(false);
    }
  };

  const status = currentRequest?.status || null;
  const statusMeta = status ? STATUS_META[status] || STATUS_META.expired : null;

  return (
    <section className="rounded-[10px] border border-violet-500/20 bg-card p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-semibold">Diagnóstico con consentimiento</h2>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            El owner autoriza 15, 30 o 60 minutos. Cada lectura queda contada y vuelve a validar vencimiento/revocación. No abre una sesión del usuario ni expone clientes, órdenes, montos, secretos o errores crudos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading || acting} className="h-8 shrink-0 text-xs">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Actualizar
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {currentRequest && statusMeta ? (
        <div className={`rounded-[8px] border p-3 ${statusMeta.className}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {status === 'active' ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === 'pending' ? <Clock3 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {statusMeta.label}
              </p>
              <p className="mt-1 text-[10px] opacity-80">
                {SUPPORT_DIAGNOSTIC_REASONS.find(item => item.value === currentRequest.reason_code)?.label || currentRequest.reason_code}
                {currentRequest.expires_at ? ` · vence ${new Date(currentRequest.expires_at).toLocaleString('es-AR')}` : ''}
                {` · ${currentRequest.view_count || 0} lecturas`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {status === 'active' && <Button size="sm" className="h-8 text-xs" onClick={openSnapshot} disabled={acting}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver diagnóstico</Button>}
              {(status === 'pending' || status === 'active') && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={revoke} disabled={acting}>Cerrar solicitud</Button>}
            </div>
          </div>
        </div>
      ) : null}

      {(!currentRequest || status === 'expired' || status === 'revoked') && canRequest ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-border/60 bg-muted/15 p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Motivo cerrado</p>
            <Select value={reason} onValueChange={value => setReason(value as SupportDiagnosticReason)}>
              <SelectTrigger className="h-9 bg-background text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SUPPORT_DIAGNOSTIC_REASONS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-9 text-xs" onClick={requestAccess} disabled={acting}>Solicitar al owner</Button>
        </div>
      ) : null}

      {!canRequest && !currentRequest && <p className="text-xs text-muted-foreground">Tu nivel de plataforma no puede solicitar diagnóstico.</p>}

      {snapshot && (
        <div className="space-y-3 border-t border-border/50 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs font-semibold">Snapshot sanitizado</p><p className="text-[10px] text-muted-foreground">Generado {new Date(snapshot.generatedAt).toLocaleString('es-AR')}</p></div>
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-1 text-[9px] uppercase tracking-wide text-emerald-300">Sin datos crudos</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DiagnosticGroup title="Activación" metrics={[
              ['Identidad', diagnosticBoolean(snapshot.activation, 'identity_ready') ? 'Lista' : 'Pendiente'],
              ['Catálogo listo', diagnosticBoolean(snapshot.activation, 'catalog_ready') ? 'Sí' : 'No'],
              ['Stock vendible', fmt(diagnosticNumber(snapshot.activation, 'sellable_stock_products_count'))],
              ['Fiscal', diagnosticText(snapshot.activation, 'fiscal_status') || 'Sin dato'],
            ]} />
            <DiagnosticGroup title="Calidad del catálogo" metrics={[
              ['Activos', fmt(diagnosticNumber(snapshot.catalogQuality, 'active_products'))],
              ['Sin imagen', fmt(diagnosticNumber(snapshot.catalogQuality, 'missing_image'))],
              ['Descripción corta', fmt(diagnosticNumber(snapshot.catalogQuality, 'short_description'))],
              ['Sin peso / tipo', `${fmt(diagnosticNumber(snapshot.catalogQuality, 'weight_missing'))} / ${fmt(diagnosticNumber(snapshot.catalogQuality, 'type_unassigned'))}`],
            ]} />
            <DiagnosticGroup title="Inventario" metrics={[
              ['Precisión medida', fmt(diagnosticNumber(snapshot.stockAccuracy, 'accuracy_pct'), '%')],
              ['Descuadrados', fmt(diagnosticNumber(snapshot.stockAccuracy, 'products_mismatched'))],
              ['Sin Kardex', fmt(diagnosticNumber(snapshot.stockAccuracy, 'products_without_ledger'))],
              ['Stock negativo', fmt(diagnosticNumber(snapshot.stockAccuracy, 'products_negative'))],
            ]} />
            <DiagnosticGroup title="Entrega de eventos" metrics={[
              ['Pendientes', fmt(diagnosticNumber(snapshot.deliveryQueue, 'pending'))],
              ['En curso', fmt(diagnosticNumber(snapshot.deliveryQueue, 'in_progress'))],
              ['Fallados', fmt(diagnosticNumber(snapshot.deliveryQueue, 'failed'))],
              ['Más antiguo', fmt(diagnosticNumber(snapshot.deliveryQueue, 'oldest_open_minutes'), ' min')],
            ]} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {snapshot.integrations.map((integration, index) => (
              <div key={`${diagnosticText(integration, 'key') || index}`} className="rounded-[7px] border border-border/50 bg-muted/15 px-3 py-2">
                <p className="text-xs font-medium">{diagnosticText(integration, 'name') || diagnosticText(integration, 'key') || 'Integración'}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{diagnosticText(integration, 'operational_status') || 'sin estado'} · {diagnosticText(integration, 'evidence_status') || 'sin evidencia'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DiagnosticGroup({ title, metrics }: { title: string; metrics: Array<[string, string]> }) {
  return (
    <div className="rounded-[8px] border border-border/60 bg-muted/15 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">{title}</p>
      <dl className="mt-2 space-y-1.5">
        {metrics.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2 text-[11px]"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium text-right">{value}</dd></div>)}
      </dl>
    </div>
  );
}
