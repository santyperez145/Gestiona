import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, Building2, CalendarClock, CheckCircle2,
  CircleAlert, Clock3, ExternalLink, Loader2, Package, RefreshCw, Rocket, Store,
  TrendingDown, Users, Wallet, Webhook, Zap,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlatformAccess } from '@/lib/usePermissions';
import { calculateChannelMetrics, type ChannelActivationRow, type PlatformActivationRow } from '@/lib/platformMetrics';
import { activationGoalLabel, evaluateActivationReadiness } from '@/lib/activationReadiness';
import type { ActivationInterventionRow } from '@/lib/activationCohorts';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import ActivationInterventionsPanel from '@/components/platform/ActivationInterventionsPanel';
import SupportDiagnosticAccessPanel from '@/components/platform/SupportDiagnosticAccessPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Organization = Pick<
  Database['public']['Tables']['organizations']['Row'],
  'id' | 'name' | 'slug' | 'created_at' | 'trial_ends_at' | 'plan_id' | 'onboarding_completed' | 'logo_url'
>;
type HealthRow = Database['public']['Views']['platform_org_health']['Row'];
type ActivationRow = ChannelActivationRow;
type ReadinessRow = Database['public']['Views']['organization_activation_readiness']['Row'];
type IntegrationHealthRow = Database['public']['Views']['platform_org_integration_health']['Row'];

interface MerchantSnapshot {
  organization: Organization;
  health: HealthRow | null;
  activation: ActivationRow | null;
  readiness: ReadinessRow;
  integrations: IntegrationHealthRow[];
  interventions: ActivationInterventionRow[];
  loadedAt: string;
}

const SIGNAL_META: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  sin_activar: { label: 'Sin activar', className: 'text-blue-300 bg-blue-500/10 border-blue-500/20', icon: Zap },
  en_riesgo: { label: 'En riesgo', className: 'text-red-300 bg-red-500/10 border-red-500/20', icon: CircleAlert },
  cayendo: { label: 'Cayendo', className: 'text-amber-300 bg-amber-500/10 border-amber-500/20', icon: TrendingDown },
  creciendo: { label: 'Creciendo', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: Zap },
  estable: { label: 'Estable', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  dormido: { label: 'Dormido', className: 'text-orange-300 bg-orange-500/10 border-orange-500/20', icon: Clock3 },
};

const INTEGRATION_STATUS_META: Record<string, { label: string; className: string }> = {
  connected: { label: 'Conectada', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  attention: { label: 'Requiere atención', className: 'text-red-300 bg-red-500/10 border-red-500/20' },
  setup_required: { label: 'Requiere configuración', className: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  contract_required: { label: 'Requiere contrato', className: 'text-orange-300 bg-orange-500/10 border-orange-500/20' },
  not_connected: { label: 'Sin conectar', className: 'text-muted-foreground bg-muted/40 border-border' },
};

const INTEGRATION_EVIDENCE_META: Record<string, string> = {
  recent_runtime: 'Ejecución reciente',
  runtime_warning: 'Última ejecución con alerta',
  runtime_error: 'Última ejecución fallida',
  stale_runtime: 'Evidencia vencida',
  configured_only: 'Sólo configuración',
  not_connected: 'Sin conexión',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin dato';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin dato' : date.toLocaleDateString('es-AR');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Sin dato';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Sin dato'
    : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMoney(value: number | null | undefined) {
  return `$${Math.round(value || 0).toLocaleString('es-AR')}`;
}

function queryError(label: string, error: { message?: string } | null) {
  return error ? `${label}: ${error.message || 'no disponible'}` : null;
}

export default function PlatformMerchantPage() {
  usePageTitle('Merchant 360');
  const { orgId } = useParams<{ orgId: string }>();
  const { isPlatformStaff, canPlatform, loading: accessLoading } = usePlatformAccess();
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = usePersistedState(`gestiona.view.platform.merchant-360-tab.${orgId || 'unknown'}`, 'overview');

  const load = useCallback(async () => {
    if (!orgId) {
      setError('Falta la organización que se quiere consultar.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const [organizationResponse, healthResponse, activationResponse, readinessResponse, integrationsResponse, interventionsResponse] = await Promise.all([
      supabase
        .from('organizations')
        .select('id,name,slug,created_at,trial_ends_at,plan_id,onboarding_completed,logo_url')
        .eq('id', orgId)
        .maybeSingle(),
      supabase
        .from('platform_org_health')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('platform_org_activation')
        .select('*')
        .eq('org_id', orgId),
      supabase
        .from('organization_activation_readiness')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('platform_org_integration_health')
        .select('*')
        .eq('org_id', orgId)
        .order('display_name'),
      supabase
        .from('platform_activation_interventions')
        .select('*')
        .eq('org_id', orgId)
        .order('occurred_at', { ascending: false }),
    ]);

    const errors = [
      queryError('organización', organizationResponse.error),
      queryError('salud del comercio', healthResponse.error),
      queryError('adopción por canal', activationResponse.error),
      queryError('ruta a la primera venta', readinessResponse.error),
      queryError('evidencia de integraciones', integrationsResponse.error),
      queryError('acompañamiento de activación', interventionsResponse.error),
    ].filter(Boolean) as string[];

    if (errors.length > 0) {
      setSnapshot(null);
      setError(errors.join(' · '));
      setLoading(false);
      return;
    }

    if (!organizationResponse.data || !readinessResponse.data) {
      setSnapshot(null);
      setError(organizationResponse.data
        ? 'La organización existe, pero no tiene una lectura de activación disponible.'
        : 'La organización no existe o no está disponible para este staff.');
      setLoading(false);
      return;
    }

    setSnapshot({
      organization: organizationResponse.data as Organization,
      health: (healthResponse.data || null) as HealthRow | null,
      activation: calculateChannelMetrics((activationResponse.data || []) as PlatformActivationRow[]).rows[0] || null,
      readiness: readinessResponse.data as ReadinessRow,
      integrations: (integrationsResponse.data || []) as IntegrationHealthRow[],
      interventions: (interventionsResponse.data || []) as ActivationInterventionRow[],
      loadedAt: new Date().toISOString(),
    });
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (isPlatformStaff && !accessLoading) void load();
  }, [accessLoading, isPlatformStaff, load]);

  const selectedTab = ['overview', 'channels', 'integrations', 'support', 'context'].includes(tab) ? tab : 'overview';
  const health = snapshot?.health;
  const activation = snapshot?.activation;
  const readiness = useMemo(
    () => snapshot ? evaluateActivationReadiness(snapshot.readiness) : null,
    [snapshot],
  );
  const signal = health?.senal || 'sin_datos';
  const signalMeta = SIGNAL_META[signal];

  const nextSteps = useMemo(() => {
    if (!snapshot) return [];
    const steps: { title: string; detail: string; tone: 'warning' | 'info' | 'success' }[] = [];
    if (readiness?.needsGoalChoice) {
      steps.push({ title: 'Definir canal de salida', detail: 'El comercio exploró el producto, pero todavía no eligió POS o tienda online como objetivo medible.', tone: 'warning' });
    }
    readiness?.milestones
      .filter(milestone => !milestone.done)
      .slice(0, readiness.needsGoalChoice ? 1 : 2)
      .forEach(milestone => steps.push({
        title: milestone.label,
        detail: `${milestone.detail} Responsable: ${milestone.owner === 'platform' ? 'Gestiona' : milestone.owner === 'shared' ? 'comercio + Gestiona' : 'comercio'}.`,
        tone: milestone.owner === 'platform' || milestone.id === 'fiscal' ? 'warning' : 'info',
      }));
    if (health && ['en_riesgo', 'cayendo', 'dormido'].includes(health.senal || '')) {
      steps.push({ title: 'Contactar al comercio', detail: `La señal de negocio es ${SIGNAL_META[health.senal || '']?.label.toLowerCase() || health.senal}. Revisar cobros y canal activo.`, tone: 'warning' });
    }
    const integrationsAtRisk = snapshot.integrations.filter(integration => integration.operational_status === 'attention');
    if (integrationsAtRisk.length > 0) {
      steps.push({
        title: 'Revisar una integración',
        detail: `${integrationsAtRisk.map(integration => integration.display_name || integration.integration_key).join(', ')} requiere atención según la última evidencia disponible.`,
        tone: 'warning',
      });
    }
    const withoutRecentRuntimeEvidence = snapshot.integrations.filter(integration =>
      integration.has_connection && ['configured_only', 'stale_runtime'].includes(integration.evidence_status || ''),
    );
    if (withoutRecentRuntimeEvidence.length > 0) {
      steps.push({
        title: 'Verificar evidencia operativa',
        detail: `${withoutRecentRuntimeEvidence.map(integration => integration.display_name || integration.integration_key).join(', ')} tiene configuración registrada, pero no una ejecución reciente verificada.`,
        tone: 'info',
      });
    }
    if (steps.length === 0) {
      steps.push({ title: 'Sin bloqueo crítico detectado', detail: 'Las señales disponibles no muestran una acción urgente.', tone: 'success' });
    }
    return steps.slice(0, 4);
  }, [health, readiness, snapshot]);

  if (accessLoading) return <div className="p-8 text-sm text-muted-foreground">Verificando permisos...</div>;
  if (!isPlatformStaff) return <Navigate to="/" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando Merchant 360...
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="space-y-4">
        <Link to="/platform/orgs" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Volver a organizaciones
        </Link>
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 rounded-[8px] p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">No se pudo cargar el comercio</p>
            <p className="text-xs text-muted-foreground mt-1">{error || 'No hay datos disponibles.'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const status = signalMeta || { label: 'Sin evidencia', className: 'text-muted-foreground bg-muted/40 border-border', icon: CircleAlert };
  const StatusIcon = status.icon;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link to="/platform/orgs" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Volver a organizaciones
      </Link>

      <PageHeader
        icon={Building2}
        title={snapshot.organization.name}
        description={`/${snapshot.organization.slug} · Merchant 360 · actualizado ${formatDateTime(snapshot.loadedAt)}`}
        badge={{ label: 'Control Plane', variant: 'default' }}
        actions={(
          <div className="flex items-center gap-2">
            <Link to="/platform/integraciones" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <Webhook className="w-3.5 h-3.5" /> Integraciones
            </Link>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} title="Actualizar Merchant 360">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline ml-1.5">Actualizar</span>
            </Button>
          </div>
        )}
      />

      <section className="border border-border/60 rounded-[10px] bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {snapshot.organization.logo_url ? (
              <img src={snapshot.organization.logo_url} alt="" className="w-12 h-12 rounded-[10px] object-cover border border-border/60" />
            ) : (
              <div className="w-12 h-12 rounded-[10px] bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-violet-300" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold truncate">{snapshot.organization.name}</p>
              <p className="text-xs text-muted-foreground truncate">Creada el {formatDate(snapshot.organization.created_at)} · Plan {health?.plan_name || 'sin plan'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] border text-[11px] font-medium ${status.className}`}>
              <StatusIcon className="w-3.5 h-3.5" /> {status.label}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] border border-border/60 bg-muted/20 text-[11px] text-muted-foreground">
              <Activity className="w-3.5 h-3.5" /> {health?.subscription_status || 'sin suscripción'}
            </span>
          </div>
        </div>
      </section>

      <Tabs value={selectedTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="channels">Canales</TabsTrigger>
          <TabsTrigger value="integrations">Integraciones</TabsTrigger>
          <TabsTrigger value="support">Acompañamiento</TabsTrigger>
          <TabsTrigger value="context">Contexto</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KPICard label="GMV 30d" value={health ? formatMoney(health.gmv_30d) : '—'} icon={Wallet} color="purple" sub={health ? `${health.cobros_30d || 0} cobros aprobados` : 'sin evidencia'} />
            <KPICard label="Comisión 30d" value={health ? formatMoney(health.comision_30d) : '—'} icon={Activity} color="success" sub="generada por este comercio" />
            <KPICard label="Órdenes online" value={activation ? activation.online_orders_30d || 0 : '—'} icon={Store} color="blue" sub="últimos 30 días" />
            <KPICard label="Ventas POS" value={activation ? activation.pos_sales_30d || 0 : '—'} icon={Package} color="warning" sub="últimos 30 días" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
            <section className="border border-border/60 rounded-[10px] bg-card p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-violet-300" />
                <div>
                  <h2 className="text-sm font-semibold">Lectura operativa</h2>
                  <p className="text-[11px] text-muted-foreground">Señales del Business Core, no una opinión manual.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Metric label="Último cobro" value={formatDateTime(health?.ultimo_cobro)} />
                <Metric label="Días sin cobrar" value={health?.dias_sin_cobrar == null ? 'Sin dato' : `${health.dias_sin_cobrar} días`} />
                <Metric label="Variación 30d" value={health?.variacion_pct == null ? 'Sin dato' : `${health.variacion_pct > 0 ? '+' : ''}${health.variacion_pct}%`} />
                <Metric label="Formulario inicial" value={snapshot.organization.onboarding_completed ? 'Completado' : 'Pendiente'} />
                <Metric label="Canal objetivo" value={readiness ? activationGoalLabel(readiness.selectedGoal) : 'Sin dato'} />
                <Metric label="Activación" value={readiness ? `${readiness.doneCount}/${readiness.total} hitos` : 'Sin dato'} />
                <Metric label="Primera venta" value={formatDateTime(activation?.firstSaleAt)} />
                <Metric label="Tiempo a primera venta" value={activation?.daysToFirstSale == null ? 'Sin dato' : `${activation.daysToFirstSale} días`} />
              </div>
              {!health && (
                <div className="flex items-start gap-2 border border-dashed border-border rounded-[8px] p-3 text-xs text-muted-foreground">
                  <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> No hay una fila de salud para esta organización; no se interpreta como riesgo ni como éxito.
                </div>
              )}
            </section>

            <section className="border border-border/60 rounded-[10px] bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-violet-300" />
                <div>
                  <h2 className="text-sm font-semibold">Próximos pasos</h2>
                  <p className="text-[11px] text-muted-foreground">Acciones sugeridas a partir de señales visibles.</p>
                </div>
              </div>
              <div className="space-y-2">
                {nextSteps.map(step => (
                  <div key={step.title} className="flex items-start gap-2.5 rounded-[7px] border border-border/50 bg-muted/15 p-3">
                    {step.tone === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> : step.tone === 'warning' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" /> : <Zap className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{step.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="space-y-4 rounded-[10px] border border-violet-500/20 bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-violet-300" />
                <div>
                  <h2 className="text-sm font-semibold">Ruta a la primera venta</h2>
                  <p className="text-[11px] text-muted-foreground">La misma definición que ve el comercio; soporte no inventa una segunda lectura.</p>
                </div>
              </div>
              <div className="min-w-[180px]">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{readiness ? activationGoalLabel(readiness.selectedGoal) : 'Sin canal'}</span>
                  <span>{readiness?.progress || 0}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-violet-400" style={{ width: `${readiness?.progress || 0}%` }} />
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(readiness?.milestones || []).map(milestone => (
                <article key={milestone.id} className={`rounded-[8px] border p-3 ${milestone.done ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : milestone.owner === 'platform' ? 'border-amber-500/25 bg-amber-500/[0.05]' : 'border-border/60 bg-muted/15'}`}>
                  <div className="flex items-start gap-2">
                    {milestone.done
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      : milestone.owner === 'platform'
                        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{milestone.label}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{milestone.detail}</p>
                      {!milestone.done && (
                        <p className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-violet-300">
                          {milestone.owner === 'platform' ? 'Gestiona' : milestone.owner === 'shared' ? 'Responsabilidad compartida' : 'Comercio'}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="channels" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChannelPanel
              icon={Store}
              title="Tienda online"
              active={!!activation?.uses_online}
              status={activation?.uses_online ? 'Con actividad' : 'Sin órdenes atribuidas'}
              detail={activation ? `${activation.online_orders_total || 0} órdenes históricas · ${activation.online_orders_30d || 0} en 30d` : 'Sin evidencia de canal'}
              accent="blue"
            />
            <ChannelPanel
              icon={Package}
              title="POS"
              active={!!activation?.uses_pos}
              status={activation?.uses_pos ? 'Con actividad' : 'Sin ventas atribuidas'}
              detail={activation ? `${activation.pos_sales_total || 0} ventas históricas · ${activation.pos_sales_30d || 0} en 30d` : 'Sin evidencia de canal'}
              accent="amber"
            />
          </div>

          <section className="border border-border/60 rounded-[10px] bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-violet-300" />
              <div>
                <h2 className="text-sm font-semibold">Activación y publicación</h2>
                <p className="text-[11px] text-muted-foreground">La primera venta se toma del evento más temprano entre POS y online; la publicación conserva evidencia propia.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <Metric label="Estado" value={activation?.store_is_active ? 'Activa' : 'Inactiva'} />
              <Metric label="Publicada" value={activation?.store_published_at ? formatDate(activation.store_published_at) : 'Sin fecha'} />
              <Metric label="Tiempo a publicar" value={activation?.daysToStorePublish == null ? 'Sin dato' : `${activation.daysToStorePublish} días`} />
              <Metric label="Primera venta" value={activation?.firstSaleAt ? `${formatDate(activation.firstSaleAt)} · ${activation.firstSaleChannel === 'online' ? 'Online' : 'POS'}` : 'Sin venta'} />
              <Metric label="Tiempo a vender" value={activation?.daysToFirstSale == null ? 'Sin dato' : `${activation.daysToFirstSale} días`} />
              <Metric label="Omnicanal" value={activation?.is_omnichannel ? 'Sí' : 'Todavía no'} />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <section className="border border-border/60 rounded-[10px] bg-card p-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-violet-300" />
                <div>
                  <h2 className="text-sm font-semibold">Evidencia de integraciones</h2>
                  <p className="text-[11px] text-muted-foreground">Conexión, vigencia y última ejecución conocidas por la plataforma. No muestra secretos ni datos de cuenta.</p>
                </div>
              </div>
              <Link to="/platform/integraciones" className="text-xs text-violet-300 hover:text-violet-200 transition-colors shrink-0">Ver catálogo global</Link>
            </div>

            {snapshot.integrations.length === 0 ? (
              <div className="flex items-start gap-2 border border-dashed border-border rounded-[8px] p-3 text-xs text-muted-foreground">
                <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> No hay evidencia de conexiones para este comercio. No se interpreta como una integración saludable.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {snapshot.integrations.map(integration => {
                  const state = INTEGRATION_STATUS_META[integration.operational_status || 'not_connected'] || INTEGRATION_STATUS_META.not_connected;
                  const evidence = INTEGRATION_EVIDENCE_META[integration.evidence_status || 'not_connected'] || 'Sin evidencia';
                  return (
                    <article key={integration.integration_key} className="rounded-[8px] border border-border/60 bg-muted/15 p-3.5 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="w-8 h-8 rounded-[7px] border border-violet-500/20 bg-violet-500/10 text-violet-300 flex items-center justify-center shrink-0"><Webhook className="w-3.5 h-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xs font-semibold">{integration.display_name || integration.integration_key || 'Integración'}</h3>
                            <span className={`inline-flex px-2 py-0.5 rounded-[4px] border text-[10px] font-medium ${state.className}`}>{state.label}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">{integration.connection_mode || 'Modalidad sin declarar'} · {integration.scope || 'Alcance sin declarar'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Metric label="Conexión" value={integration.has_connection ? 'Configurada' : 'Pendiente'} />
                        <Metric label="Credencial" value={integration.has_connection ? (integration.credential_current ? 'Vigente' : 'A revisar') : 'Sin evidencia'} />
                        <Metric label="Evidencia" value={evidence} />
                        <Metric label="Último evento" value={integration.last_event || 'Sin evidencia'} />
                        <Metric label="Última ejecución" value={formatDateTime(integration.last_runtime_at)} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <p className="text-[11px] text-muted-foreground/70 px-1">“Conectada” significa que hay configuración registrada, no que el proveedor esté disponible en este instante. “Ejecución reciente” es la última evidencia registrada por un flujo real, no un ping activo. Los health checks activos y los detalles de webhooks siguen en el roadmap.</p>
        </TabsContent>

        <TabsContent value="support" className="space-y-4">
          <SupportDiagnosticAccessPanel
            orgId={snapshot.organization.id}
            canRequest={canPlatform('support')}
          />
          <ActivationInterventionsPanel
            orgId={snapshot.organization.id}
            interventions={snapshot.interventions}
            canRecord={canPlatform('support')}
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="context" className="space-y-4">
          <section className="border border-border/60 rounded-[10px] bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-300" />
              <div>
                <h2 className="text-sm font-semibold">Contexto del tenant</h2>
                <p className="text-[11px] text-muted-foreground">Datos mínimos para entender la cuenta sin entrar a tablas crudas.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Metric label="Slug" value={`/${snapshot.organization.slug}`} />
              <Metric label="Plan" value={health?.plan_name || 'Sin plan'} />
              <Metric label="Precio mensual" value={health?.price_usd_monthly == null ? 'Sin dato' : formatMoney(health.price_usd_monthly)} />
              <Metric label="Trial" value={formatDate(snapshot.organization.trial_ends_at)} />
              <Metric label="Miembros" value={`${health?.miembros ?? 'Sin dato'}`} icon={Users} />
              <Metric label="Productos" value={`${health?.productos ?? 'Sin dato'}`} icon={Package} />
              <Metric label="Tiendas activas" value={`${health?.tiendas_activas ?? 'Sin dato'}`} icon={Store} />
              <Metric label="Primer cobro" value={formatDate(health?.primer_cobro)} />
            </div>
          </section>

          <div className="flex items-start gap-2 border-t border-border/40 pt-4 text-[11px] text-muted-foreground/70">
            <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>Merchant 360 muestra señales agregadas y sanitizadas. No muestra tokens, credenciales, datos de clientes ni permite cambiar el negocio fuera de los flujos autorizados.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Users }) {
  return (
    <div className="rounded-[7px] border border-border/50 bg-muted/15 px-3 py-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 truncate">{label}</p>
      <p className="text-xs font-medium mt-1 truncate flex items-center gap-1.5">{Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}{value}</p>
    </div>
  );
}

function ChannelPanel({
  icon: Icon,
  title,
  active,
  status,
  detail,
  accent,
}: {
  icon: typeof Store;
  title: string;
  active: boolean;
  status: string;
  detail: string;
  accent: 'blue' | 'amber';
}) {
  const color = accent === 'blue' ? 'text-blue-300 bg-blue-500/10 border-blue-500/20' : 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  return (
    <section className="border border-border/60 rounded-[10px] bg-card p-4">
      <div className="flex items-center gap-3">
        <span className={`w-9 h-9 rounded-[8px] border flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>
        </div>
        <span className={`text-[10px] font-medium ${active ? 'text-emerald-400' : 'text-muted-foreground'}`}>{status}</span>
      </div>
    </section>
  );
}
