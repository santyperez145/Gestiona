import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Globe2, MonitorSmartphone, PackageCheck, RefreshCw, Search, ShoppingBag, Sparkles, Store, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { usePersistedState } from "@/hooks/usePersistedState";
import { isMissingRelation } from "@/lib/publicDataSource";
import { calculateAiActionMetrics, calculateChannelMetrics, calculateCronHealthMetrics, calculatePlatformMetrics, calculateRiskSeriesMetrics, calculateStockAccuracyMetrics, type PlatformActivationRow, type PlatformAiActionRow, type PlatformCronHealthRow, type PlatformHealthRow, type PlatformRiskSeriesRow, type PlatformStockAccuracyRow } from "@/lib/platformMetrics";

const SIGNALS: Record<string, { label: string; className: string }> = {
  sin_activar: { label: "Sin activar", className: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  en_riesgo: { label: "En riesgo", className: "bg-red-500/15 text-red-400 border-red-500/25" },
  cayendo: { label: "Cayendo", className: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  creciendo: { label: "Creciendo", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  estable: { label: "Estable", className: "bg-muted text-muted-foreground border-border" },
  dormido: { label: "Dormido", className: "bg-red-500/15 text-red-400 border-red-500/25" },
  sin_dato: { label: "Sin dato", className: "bg-muted text-muted-foreground border-border" },
};

const CRON_STATES: Record<string, { label: string; className: string }> = {
  saludable: { label: "Saludable", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  fallando: { label: "Última falló", className: "bg-red-500/15 text-red-400 border-red-500/25" },
  ejecutando: { label: "Ejecutando", className: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  sin_ejecuciones: { label: "Sin ejecuciones", className: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  pausado: { label: "Pausado", className: "bg-muted text-muted-foreground border-border" },
};

function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "Sin fecha";
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "Sin ejecuciones";
}

function formatSnapshotDate(value: string | null) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) : "Sin fecha";
}

function formatDays(value: number | null, emptyLabel = "Sin cobro") {
  if (value === null) return emptyLabel;
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })} días`;
}

function SignalBadge({ signal }: { signal: string | null }) {
  const config = SIGNALS[signal || "sin_dato"] || SIGNALS.sin_dato;
  return <Badge variant="outline" className={`text-[10px] ${config.className}`}>{config.label}</Badge>;
}

function CronStateBadge({ state }: { state: string | null }) {
  const config = CRON_STATES[state || ""] || CRON_STATES.sin_ejecuciones;
  return <Badge variant="outline" className={`text-[10px] ${config.className}`}>{config.label}</Badge>;
}

function FunnelStep({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const percentage = total > 0 ? Math.round(value / total * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value} <span className="font-normal text-muted-foreground">({percentage}%)</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/50">
        <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export default function PlatformMetricsPage() {
  usePageTitle("Métricas de plataforma");
  const [rows, setRows] = useState<PlatformHealthRow[]>([]);
  const [channelRows, setChannelRows] = useState<PlatformActivationRow[]>([]);
  const [stockRows, setStockRows] = useState<PlatformStockAccuracyRow[]>([]);
  const [aiActionRows, setAiActionRows] = useState<PlatformAiActionRow[]>([]);
  const [riskSeriesRows, setRiskSeriesRows] = useState<PlatformRiskSeriesRow[]>([]);
  const [cronRows, setCronRows] = useState<PlatformCronHealthRow[]>([]);
  const [channelViewUnavailable, setChannelViewUnavailable] = useState(false);
  const [stockViewUnavailable, setStockViewUnavailable] = useState(false);
  const [aiActionViewUnavailable, setAiActionViewUnavailable] = useState(false);
  const [riskSeriesUnavailable, setRiskSeriesUnavailable] = useState(false);
  const [cronViewUnavailable, setCronViewUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = usePersistedState<"funnel" | "health" | "activation" | "channels" | "stock" | "ai" | "risk" | "operations">("gestiona.view.platform.metrics-tab", "funnel");
  const [search, setSearch] = usePersistedState("gestiona.view.platform.metrics-search", "");
  const [signalFilter, setSignalFilter] = usePersistedState("gestiona.view.platform.metrics-signal", "all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [healthResult, channelResult, stockResult, aiActionResult, riskSeriesResult, cronResult] = await Promise.all([
      supabase.from("platform_org_health").select("*").order("gmv_30d", { ascending: false }),
      supabase.from("platform_org_activation").select("*").order("org_creada", { ascending: false }),
      supabase.from("platform_org_stock_accuracy").select("*").order("productos_descuadrados", { ascending: false }),
      supabase.from("platform_org_ai_actions").select("*").order("recommendations_total", { ascending: false }),
      supabase.from("platform_org_risk_series").select("*").order("snapshot_date", { ascending: true }),
      supabase.from("platform_cron_health").select("*").order("jobname", { ascending: true }),
    ]);
    if (healthResult.error) {
      setError(healthResult.error.message);
      setRows([]);
    } else {
      setRows((healthResult.data || []) as PlatformHealthRow[]);
    }
    if (channelResult.error) {
      if (isMissingRelation(channelResult.error)) {
        setChannelViewUnavailable(true);
        setChannelRows([]);
      } else {
        setError(channelResult.error.message);
        setChannelRows([]);
        setChannelViewUnavailable(false);
      }
    } else {
      setChannelRows((channelResult.data || []) as PlatformActivationRow[]);
      setChannelViewUnavailable(false);
    }
    if (stockResult.error) {
      if (isMissingRelation(stockResult.error)) {
        setStockViewUnavailable(true);
        setStockRows([]);
      } else {
        setError(stockResult.error.message);
        setStockRows([]);
        setStockViewUnavailable(false);
      }
    } else {
      setStockRows((stockResult.data || []) as PlatformStockAccuracyRow[]);
      setStockViewUnavailable(false);
    }
    if (aiActionResult.error) {
      if (isMissingRelation(aiActionResult.error)) {
        setAiActionViewUnavailable(true);
        setAiActionRows([]);
      } else {
        setError(aiActionResult.error.message);
        setAiActionRows([]);
        setAiActionViewUnavailable(false);
      }
    } else {
      setAiActionRows((aiActionResult.data || []) as PlatformAiActionRow[]);
      setAiActionViewUnavailable(false);
    }
    if (riskSeriesResult.error) {
      if (isMissingRelation(riskSeriesResult.error)) {
        setRiskSeriesUnavailable(true);
        setRiskSeriesRows([]);
      } else {
        setError(riskSeriesResult.error.message);
        setRiskSeriesRows([]);
        setRiskSeriesUnavailable(false);
      }
    } else {
      setRiskSeriesRows((riskSeriesResult.data || []) as PlatformRiskSeriesRow[]);
      setRiskSeriesUnavailable(false);
    }
    if (cronResult.error) {
      if (isMissingRelation(cronResult.error)) {
        setCronViewUnavailable(true);
        setCronRows([]);
      } else {
        setError(cronResult.error.message);
        setCronRows([]);
        setCronViewUnavailable(false);
      }
    } else {
      setCronRows((cronResult.data || []) as PlatformCronHealthRow[]);
      setCronViewUnavailable(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => calculatePlatformMetrics(rows), [rows]);
  const channelMetrics = useMemo(() => calculateChannelMetrics(channelRows), [channelRows]);
  const stockMetrics = useMemo(() => calculateStockAccuracyMetrics(stockRows), [stockRows]);
  const aiActionMetrics = useMemo(() => calculateAiActionMetrics(aiActionRows), [aiActionRows]);
  const riskSeriesMetrics = useMemo(() => calculateRiskSeriesMetrics(riskSeriesRows), [riskSeriesRows]);
  const cronMetrics = useMemo(() => calculateCronHealthMetrics(cronRows), [cronRows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return metrics.activationTimes.filter(row => {
      const matchesSearch = !query || [row.org_name, row.slug, row.plan_name]
        .some(value => value?.toLowerCase().includes(query));
      const matchesSignal = signalFilter === "all" || row.senal === signalFilter;
      return matchesSearch && matchesSignal;
    });
  }, [metrics.activationTimes, search, signalFilter]);

  const sortedSignals = Object.entries(metrics.signalCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        icon={BarChart3}
        title="Métricas de plataforma"
        description="Activación, adopción y salud de las organizaciones con señales reales del sistema."
        actions={(
          <Button variant="outline" size="sm" onClick={load} disabled={loading} title="Actualizar métricas">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar
          </Button>
        )}
      />

      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-semibold">No se pudieron cargar las métricas</p><p className="mt-1 text-xs text-destructive/80">{error}</p></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard label="Organizaciones" value={metrics.totalOrganizations} icon={Users} color="blue" sub={`${metrics.payingOrganizations} con plan activo`} />
        <KPICard label="Activadas" value={`${metrics.activationRate}%`} icon={CheckCircle2} color="success" sub={`${metrics.activatedOrganizations} con primer cobro`} />
        <KPICard label="GMV 30 días" value={formatARS(metrics.gmv30d)} icon={ShoppingBag} color="primary" sub={`${formatARS(metrics.commission30d)} comisión`} />
        <KPICard label="Riesgo" value={metrics.riskOrganizations} icon={AlertTriangle} color={metrics.riskOrganizations > 0 ? "destructive" : "success"} sub="en riesgo, cayendo o dormidas" />
      </div>

      <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)}>
        <TabsList className="w-full justify-start overflow-x-auto bg-transparent p-0 border-b border-border rounded-none">
          <TabsTrigger value="funnel" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Funnel de activación</TabsTrigger>
          <TabsTrigger value="health" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Salud por organización</TabsTrigger>
          <TabsTrigger value="activation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Tiempo a primer cobro</TabsTrigger>
          <TabsTrigger value="channels" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Canales</TabsTrigger>
          <TabsTrigger value="stock" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Inventario</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Recomendaciones IA</TabsTrigger>
          <TabsTrigger value="risk" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Riesgo</TabsTrigger>
          <TabsTrigger value="operations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-400">Operación</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-5 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <section className="rounded-[10px] border border-border/60 bg-card p-5">
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10"><Activity className="h-4 w-4 text-violet-400" /></div>
                <div><h2 className="font-semibold">Camino de activación</h2><p className="mt-1 text-xs text-muted-foreground">Cada paso se calcula sobre las organizaciones que existen hoy.</p></div>
              </div>
              <div className="space-y-5">
                <FunnelStep label="Alta completada" value={metrics.totalOrganizations} total={metrics.totalOrganizations} tone="bg-violet-500" />
                <FunnelStep label="Onboarding terminado" value={metrics.onboardedOrganizations} total={metrics.totalOrganizations} tone="bg-indigo-500" />
                <FunnelStep label="Catálogo con productos" value={metrics.catalogReadyOrganizations} total={metrics.totalOrganizations} tone="bg-blue-500" />
                <FunnelStep label="Tienda activa" value={metrics.storeReadyOrganizations} total={metrics.totalOrganizations} tone="bg-cyan-500" />
                {!channelViewUnavailable && <FunnelStep label="Primera venta en el Core" value={channelMetrics.activatedOrganizations} total={channelMetrics.totalOrganizations} tone="bg-teal-500" />}
                <FunnelStep label="Primer cobro registrado" value={metrics.activatedOrganizations} total={metrics.totalOrganizations} tone="bg-emerald-500" />
              </div>
            </section>

            <section className="rounded-[10px] border border-border/60 bg-card p-5">
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10"><Store className="h-4 w-4 text-emerald-400" /></div>
                <div><h2 className="font-semibold">Señales de uso</h2><p className="mt-1 text-xs text-muted-foreground">La plataforma prioriza dónde intervenir primero.</p></div>
              </div>
              <div className="space-y-3">
                {sortedSignals.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay organizaciones para analizar.</p> : sortedSignals.map(([signal, count]) => (
                  <div key={signal} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                    <SignalBadge signal={signal} /><span className="font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border/50 pt-4 text-center">
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trial</p><p className="mt-1 text-lg font-semibold">{metrics.trialOrganizations}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pagando</p><p className="mt-1 text-lg font-semibold text-emerald-400">{metrics.payingOrganizations}</p></div>
              </div>
            </section>
          </div>

          <section className="border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm">
            <p className="font-semibold text-violet-200">Instrumentación disponible</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">G1, GMV, onboarding, primera venta, publicación instrumentada, adopción por canal y precisión de inventario se calculan desde datos reales. El AI Action Rate mide el recomendador de ofertas persistido: una acción sólo cuenta cuando la base aplica el cambio.</p>
          </section>
        </TabsContent>

        <TabsContent value="health" className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar organización, slug o plan" className="pl-9" /></div>
            <select value={signalFilter} onChange={event => setSignalFilter(event.target.value)} className="h-10 rounded-md border border-border bg-muted px-3 text-sm text-foreground">
              <option value="all">Todas las señales</option>
              {Object.entries(SIGNALS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
            </select>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
            {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando salud de organizaciones...</div> : filteredRows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No hay organizaciones con esos filtros.</div> : (
              <div className="divide-y divide-border/50">
                {filteredRows.map(row => (
                  <div key={row.org_id || row.slug} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(80px,0.6fr))] md:items-center">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{row.org_name || "Sin nombre"}</p><p className="truncate text-xs text-muted-foreground">/{row.slug || "sin-slug"} · {row.plan_name || "Sin plan"}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">GMV 30d</p><p className="mt-0.5 text-xs font-semibold">{formatARS(row.gmv_30d || 0)}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Productos</p><p className="mt-0.5 text-xs font-semibold">{row.productos || 0}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tienda</p><p className="mt-0.5 text-xs font-semibold">{row.tiendas_activas || 0} activa</p></div>
                    <div className="flex items-center justify-between gap-2 md:block md:text-right"><SignalBadge signal={row.senal} /><p className="mt-1 text-[10px] text-muted-foreground">{row.dias_sin_cobrar == null ? "Nunca cobró" : `${row.dias_sin_cobrar} días sin cobrar`}</p></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activation" className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPICard label="Promedio" value={formatDays(metrics.averageDaysToFirstCharge)} icon={Clock3} color="blue" sub="alta → primer cobro" />
            <KPICard label="Mediana" value={formatDays(metrics.medianDaysToFirstCharge)} icon={Clock3} color="primary" sub="alta → primer cobro" />
            <KPICard label="Con primer cobro" value={metrics.activatedOrganizations} icon={CheckCircle2} color="success" sub="organizaciones activadas" />
            <KPICard label="Sin primer cobro" value={metrics.totalOrganizations - metrics.activatedOrganizations} icon={AlertTriangle} color="warning" sub="requieren acompañamiento" />
          </div>
          <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
            <div className="border-b border-border/50 px-4 py-3"><h2 className="font-semibold text-sm">Cohorte de activación</h2><p className="mt-1 text-xs text-muted-foreground">Las organizaciones sin cobro aparecen al final para que soporte pueda actuar sobre onboarding roto.</p></div>
            {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando cohorte...</div> : (
              <div className="divide-y divide-border/50">
                {metrics.activationTimes.slice(0, 30).map(row => (
                  <div key={row.org_id || row.slug} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{row.org_name || "Sin nombre"}</p><p className="text-xs text-muted-foreground">Alta: {formatDate(row.org_creada)} · Primer cobro: {formatDate(row.primer_cobro)}</p></div>
                    <div className="flex items-center gap-3"><SignalBadge signal={row.senal} /><span className="min-w-[82px] text-right text-xs font-semibold tabular-nums">{formatDays(row.daysToFirstCharge)}</span></div>
                  </div>
                ))}
                {metrics.activationTimes.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Todavía no hay datos de activación.</div>}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="stock" className="mt-5 space-y-5">
          {stockViewUnavailable ? (
            <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Medicion de inventario pendiente</p><p className="mt-1 text-xs text-muted-foreground">La base todavia no expone la vista protegida de precision. No se reemplaza con una lectura aproximada de productos.</p></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KPICard label="Precision medida" value={stockMetrics.accuracyPct === null ? "Sin datos" : `${stockMetrics.accuracyPct}%`} icon={PackageCheck} color={stockMetrics.accuracyPct !== null && stockMetrics.accuracyPct >= 98 ? "success" : "warning"} sub={`${stockMetrics.matchingProducts} de ${stockMetrics.measuredProducts} productos`} />
                <KPICard label="Descuadrados" value={stockMetrics.mismatchingProducts} icon={AlertTriangle} color={stockMetrics.mismatchingProducts > 0 ? "destructive" : "success"} sub="requieren conteo o investigacion" />
                <KPICard label="Sin Kardex" value={stockMetrics.unmeasuredProducts} icon={ShoppingBag} color={stockMetrics.unmeasuredProducts > 0 ? "warning" : "success"} sub="fuera del porcentaje medido" />
                <KPICard label="Stock negativo" value={stockMetrics.negativeStockProducts} icon={AlertTriangle} color={stockMetrics.negativeStockProducts > 0 ? "destructive" : "success"} sub="invariante que debe quedar en cero" />
              </div>

              <section className="border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm">
                <div className="flex items-start gap-3"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><p className="font-semibold text-violet-200">La plataforma mide evidencia, no supuestos</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">El porcentaje compara el ultimo asiento del Kardex con el stock actual. Los productos sin movimiento quedan visibles como no medidos; las variantes se contrastan contra su propio Kardex y contra el total del producto padre.</p></div></div>
              </section>

              <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
                <div className="border-b border-border/50 px-4 py-3"><h2 className="font-semibold text-sm">Precision por organizacion</h2><p className="mt-1 text-xs text-muted-foreground">Ordenado por cantidad de productos descuadrados para orientar soporte y el proximo conteo fisico.</p></div>
                {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando salud de inventario...</div> : stockMetrics.rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Todavia no hay organizaciones para analizar.</div> : (
                  <div className="divide-y divide-border/50">
                    {stockMetrics.rows.slice(0, 30).map(row => (
                      <div key={row.org_id || row.slug} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(90px,0.6fr))] md:items-center">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{row.org_name || "Sin nombre"}</p><p className="truncate text-xs text-muted-foreground">/{row.slug || "sin-slug"} - {row.conteos_cerrados || 0} conteos cerrados</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Precision</p><p className="mt-0.5 text-xs font-semibold">{row.precision_pct === null ? "Sin datos" : `${row.precision_pct}%`}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Medidos</p><p className="mt-0.5 text-xs font-semibold">{row.productos_medidos || 0}/{row.productos_total || 0}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descuadrados</p><p className="mt-0.5 text-xs font-semibold text-red-300">{row.productos_descuadrados || 0}</p></div>
                        <div className="flex items-center justify-between gap-2 md:block md:text-right"><Badge variant="outline" className={row.productos_stock_negativo ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}>{row.productos_stock_negativo ? `${row.productos_stock_negativo} negativos` : "Sin negativos"}</Badge><p className="mt-1 text-[10px] text-muted-foreground">Conteo: {formatDate(row.ultimo_conteo_at)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="channels" className="mt-5 space-y-5">
          {channelViewUnavailable ? (
            <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Instrumentacion de canales pendiente</p><p className="mt-1 text-xs text-muted-foreground">La base todavia no expone `platform_org_activation`. El panel conserva el resto de las metricas y no reemplaza esta medicion con aproximaciones.</p></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <KPICard label="Primera venta" value={`${channelMetrics.firstSaleRate}%`} icon={CheckCircle2} color="success" sub={`${channelMetrics.activatedOrganizations} comercios activados`} />
                <KPICard label="Publicacion instrumentada" value={`${channelMetrics.storePublishedRate}%`} icon={Store} color="primary" sub={`${channelMetrics.organizationsWithStoreActive} activas hoy`} />
                <KPICard label="Usan online" value={`${channelMetrics.onlineRate}%`} icon={Globe2} color="blue" sub={`${channelMetrics.organizationsWithOnline} con orden confirmada`} />
                <KPICard label="Usan POS" value={`${channelMetrics.posRate}%`} icon={MonitorSmartphone} color="success" sub={`${channelMetrics.organizationsWithPos} con venta POS`} />
                <KPICard label="Omnicanal" value={`${channelMetrics.omnichannelRate}%`} icon={Activity} color="primary" sub={`${channelMetrics.omnichannelOrganizations} usan ambos canales`} />
              </div>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[10px] border border-border/60 bg-card p-5">
                  <div className="mb-5 flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10"><Store className="h-4 w-4 text-violet-400" /></div><div><h2 className="font-semibold">Tiempo a vender</h2><p className="mt-1 text-xs text-muted-foreground">La primera venta toma el evento más temprano entre POS y tienda. Sólo las fechas reales entran en el promedio.</p></div></div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="border-r border-border/50 pr-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alta -&gt; publicar</p><p className="mt-1 text-xl font-semibold">{formatDays(channelMetrics.averageDaysToStorePublish, "Sin datos")}</p><p className="mt-1 text-[11px] text-muted-foreground">mediana {formatDays(channelMetrics.medianDaysToStorePublish, "Sin datos")}</p></div>
                    <div className="border-r border-border/50 pr-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alta -&gt; primera venta</p><p className="mt-1 text-xl font-semibold">{formatDays(channelMetrics.averageDaysToFirstSale, "Sin datos")}</p><p className="mt-1 text-[11px] text-muted-foreground">mediana {formatDays(channelMetrics.medianDaysToFirstSale, "Sin datos")}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alta -&gt; primera online</p><p className="mt-1 text-xl font-semibold">{formatDays(channelMetrics.averageDaysToFirstOnlineOrder, "Sin datos")}</p><p className="mt-1 text-[11px] text-muted-foreground">mediana {formatDays(channelMetrics.medianDaysToFirstOnlineOrder, "Sin datos")}</p></div>
                  </div>
                  <p className="mt-5 border-t border-border/50 pt-4 text-xs text-muted-foreground">{channelMetrics.organizationsWithStorePublicationKnown} de {channelMetrics.totalOrganizations} organizaciones tienen fecha de publicacion instrumentada. El resto queda fuera del calculo.</p>
                </div>

                <div className="rounded-[10px] border border-border/60 bg-card p-5">
                  <div className="mb-5 flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10"><Activity className="h-4 w-4 text-emerald-400" /></div><div><h2 className="font-semibold">Adopcion por canal</h2><p className="mt-1 text-xs text-muted-foreground">Una organizacion cuenta como omnicanal cuando tiene al menos una venta POS y una orden online confirmada.</p></div></div>
                  <div className="space-y-4">
                    <FunnelStep label="Publicacion instrumentada" value={channelMetrics.organizationsWithStorePublished} total={channelMetrics.totalOrganizations} tone="bg-violet-500" />
                    <FunnelStep label="Primera venta en cualquier canal" value={channelMetrics.activatedOrganizations} total={channelMetrics.totalOrganizations} tone="bg-teal-500" />
                    <FunnelStep label="Primera orden online" value={channelMetrics.organizationsWithOnline} total={channelMetrics.totalOrganizations} tone="bg-blue-500" />
                    <FunnelStep label="Venta POS" value={channelMetrics.organizationsWithPos} total={channelMetrics.totalOrganizations} tone="bg-emerald-500" />
                    <FunnelStep label="Ambos canales" value={channelMetrics.omnichannelOrganizations} total={channelMetrics.totalOrganizations} tone="bg-amber-500" />
                  </div>
                </div>
              </section>

              <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
                <div className="border-b border-border/50 px-4 py-3"><h2 className="font-semibold text-sm">Detalle por organizacion</h2><p className="mt-1 text-xs text-muted-foreground">Los contadores diferencian actividad online confirmada de ventas POS explicitamente marcadas.</p></div>
                {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando adopcion...</div> : channelMetrics.rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Todavia no hay datos para analizar.</div> : (
                  <div className="divide-y divide-border/50">
                    {channelMetrics.rows.slice(0, 30).map(row => (
                      <div key={row.org_id || row.slug} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(90px,0.6fr))] md:items-center">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{row.org_name || "Sin nombre"}</p><p className="truncate text-xs text-muted-foreground">/{row.slug || "sin-slug"} - {row.store_slug ? `tienda /${row.store_slug}` : "sin tienda"}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Online</p><p className="mt-0.5 text-xs font-semibold">{row.online_orders_total || 0} ordenes</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">POS</p><p className="mt-0.5 text-xs font-semibold">{row.pos_sales_total || 0} ventas</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Publicacion</p><p className="mt-0.5 text-xs font-semibold">{row.store_publication_known ? formatDate(row.store_published_at) : "Sin fecha"}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Primera venta</p><p className="mt-0.5 text-xs font-semibold">{formatDate(row.firstSaleAt)}</p><p className="mt-1 text-[10px] text-muted-foreground">{row.firstSaleChannel === "online" ? "Online" : row.firstSaleChannel === "pos" ? "POS" : "Sin canal"} · {formatDays(row.daysToFirstSale, "Sin tiempo")}</p></div>
                        <div className="flex items-center justify-between gap-2 md:block md:text-right"><Badge variant="outline" className={row.is_omnichannel ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-border text-muted-foreground"}>{row.is_omnichannel ? "Omnicanal" : row.uses_online ? "Online" : row.uses_pos ? "POS" : "Sin canal"}</Badge><p className="mt-1 text-[10px] text-muted-foreground">{row.store_is_active ? "Tienda activa" : "Tienda inactiva"}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-5 space-y-5">
          {aiActionViewUnavailable ? (
            <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Medición de IA pendiente</p><p className="mt-1 text-xs text-muted-foreground">La base todavía no expone `platform_org_ai_actions`. No se reemplaza con clics ni mensajes aproximados.</p></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KPICard label="AI Action Rate" value={aiActionMetrics.actionRatePct === null ? "Sin datos" : `${aiActionMetrics.actionRatePct}%`} icon={Sparkles} color="primary" sub={`${aiActionMetrics.recommendationsApplied} acciones aplicadas`} />
                <KPICard label="Recomendaciones" value={aiActionMetrics.recommendationsTotal} icon={Sparkles} color="blue" sub={`${aiActionMetrics.organizationsWithRecommendations} organizaciones`} />
                <KPICard label="Pendientes" value={aiActionMetrics.recommendationsPending} icon={Clock3} color={aiActionMetrics.recommendationsPending > 0 ? "warning" : "success"} sub="esperan decisión" />
                <KPICard label="Descartadas" value={aiActionMetrics.recommendationsDismissed} icon={AlertTriangle} color="destructive" sub="no cuentan como acción" />
              </div>

              <section className="border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm">
                <div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><p className="font-semibold text-violet-200">Acciones verificables, no engagement decorativo</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Este primer corte de G8 mide sólo recomendaciones de oferta guardadas. “Aplicada” significa que el RPC de la base validó margen y precio, actualizó el producto y registró el evento. Chats, sugerencias no persistidas y descartes quedan fuera del numerador.</p></div></div>
              </section>

              <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
                <div className="border-b border-border/50 px-4 py-3"><h2 className="font-semibold text-sm">Adopción por organización</h2><p className="mt-1 text-xs text-muted-foreground">Ordenado por recomendaciones generadas para detectar dónde la IA propone valor pero no llega a ejecutarse.</p></div>
                {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando adopción de recomendaciones...</div> : aiActionMetrics.rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Todavía no hay organizaciones para analizar.</div> : (
                  <div className="divide-y divide-border/50">
                    {aiActionMetrics.rows.slice(0, 30).map(row => (
                      <div key={row.org_id || row.slug} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(85px,0.6fr))] md:items-center">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{row.org_name || "Sin nombre"}</p><p className="truncate text-xs text-muted-foreground">/{row.slug || "sin-slug"} · última recomendación {formatDate(row.last_recommendation_at)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Action Rate</p><p className="mt-0.5 text-xs font-semibold">{row.action_rate_pct === null ? "Sin datos" : `${row.action_rate_pct}%`}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aplicadas</p><p className="mt-0.5 text-xs font-semibold text-emerald-400">{row.recommendations_applied || 0}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pendientes</p><p className="mt-0.5 text-xs font-semibold">{row.recommendations_pending || 0}</p></div>
                        <div className="md:text-right"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Descartadas</p><p className="mt-0.5 text-xs font-semibold text-muted-foreground">{row.recommendations_dismissed || 0}/{row.recommendations_total || 0}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="risk" className="mt-5 space-y-5">
          {riskSeriesUnavailable ? (
            <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Serie de riesgo pendiente</p><p className="mt-1 text-xs text-muted-foreground">La base todavía no expone `platform_org_risk_series`. No se reconstruye una tendencia con ventanas de hoy.</p></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KPICard label="En riesgo hoy" value={riskSeriesMetrics.riskOrganizations} icon={AlertTriangle} color={riskSeriesMetrics.riskOrganizations > 0 ? "destructive" : "success"} sub="riesgo, caída o dormido" />
                <KPICard label="Cambio diario" value={riskSeriesMetrics.riskOrganizationChange === null ? "Sin base" : `${riskSeriesMetrics.riskOrganizationChange > 0 ? "+" : ""}${riskSeriesMetrics.riskOrganizationChange}`} icon={Activity} color={riskSeriesMetrics.riskOrganizationChange !== null && riskSeriesMetrics.riskOrganizationChange > 0 ? "destructive" : "success"} sub="contra la observación anterior" />
                <KPICard label="GMV en riesgo" value={formatARS(riskSeriesMetrics.atRiskGmv)} icon={ShoppingBag} color="warning" sub="base previa de riesgo y caída" />
                <KPICard label="Observaciones" value={riskSeriesMetrics.observations} icon={Clock3} color="blue" sub={riskSeriesMetrics.latest ? `desde ${formatSnapshotDate(riskSeriesMetrics.rows[0]?.snapshot_date || null)}` : "la serie empieza al medir"} />
              </div>

              <section className="border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm">
                <div className="flex items-start gap-3"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><p className="font-semibold text-violet-200">Historia capturada, no retrospectiva inventada</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">La foto se toma todos los días a las 03:15 de Argentina. Riesgo suma organizaciones sin ventas tras haber cobrado, en caída fuerte o dormidas; `sin activar` se conserva fuera del total porque pide onboarding, no una acción de churn.</p></div></div>
              </section>

              <div className="rounded-[10px] border border-border/60 bg-card p-5">
                <div className="mb-5"><h2 className="font-semibold text-sm">Evolución de comercios en riesgo</h2><p className="mt-1 text-xs text-muted-foreground">La comparación aparece desde la segunda observación diaria. La ficha Salud conserva el detalle para actuar por organización.</p></div>
                {loading ? <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">Cargando serie de riesgo...</div> : riskSeriesMetrics.observations < 2 ? <div className="flex h-[240px] items-center justify-center text-center text-sm text-muted-foreground">La primera observación real se registró hoy. La tendencia estará disponible después de la próxima captura diaria.</div> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={riskSeriesMetrics.rows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                      <defs><linearGradient id="platformRiskGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.3} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="snapshot_date" tickFormatter={formatSnapshotDate} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip labelFormatter={formatSnapshotDate} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="comercios_en_riesgo" name="Comercios en riesgo" stroke="#f97316" fill="url(#platformRiskGradient)" strokeWidth={2} dot={{ r: 3, fill: "#f97316" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="operations" className="mt-5 space-y-5">
          {cronViewUnavailable ? (
            <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Observabilidad de cron pendiente</p><p className="mt-1 text-xs text-muted-foreground">La base todavía no expone `platform_cron_health`. El panel no intenta leer `cron.job` directo ni muestra comandos o respuestas internas.</p></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KPICard label="Jobs activos" value={cronMetrics.activeJobs} icon={Activity} color="blue" sub={`${cronMetrics.totalJobs} configurados`} />
                <KPICard label="Última corrida falló" value={cronMetrics.failingJobs} icon={AlertTriangle} color={cronMetrics.failingJobs > 0 ? "destructive" : "success"} sub="requieren revisar ahora" />
                <KPICard label="Fallos últimos 7 días" value={cronMetrics.failedRuns7d} icon={AlertTriangle} color={cronMetrics.failedRuns7d > 0 ? "warning" : "success"} sub={`${cronMetrics.runs7d} ejecuciones registradas`} />
                <KPICard label="Sin historial" value={cronMetrics.jobsWithoutRuns} icon={Clock3} color={cronMetrics.jobsWithoutRuns > 0 ? "warning" : "success"} sub="pueden ser jobs recién creados" />
              </div>

              <section className="border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm">
                <div className="flex items-start gap-3"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><p className="font-semibold text-violet-200">Estado operativo sin exponer secretos</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">La vista sólo entrega nombre, horario, actividad, estado y conteos. No expone el comando del cron, mensajes de retorno ni cuerpos de respuestas HTTP. “Sin ejecuciones” informa un job nuevo; no se trata como falla porque un horario semanal puede ser correcto.</p></div></div>
              </section>

              <div className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
                <div className="border-b border-border/50 px-4 py-3"><h2 className="font-semibold text-sm">Salud de trabajos programados</h2><p className="mt-1 text-xs text-muted-foreground">Ordenado para que el último fallo se revise antes que los jobs sanos. Las corridas previas fallidas siguen visibles en el contador de siete días.</p></div>
                {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando salud de cron...</div> : cronMetrics.rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No hay trabajos programados visibles para este staff.</div> : (
                  <div className="divide-y divide-border/50">
                    {cronMetrics.rows.map(row => (
                      <div key={row.jobid || row.jobname} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.35fr)_minmax(120px,.75fr)_minmax(135px,.85fr)_minmax(135px,.85fr)_minmax(110px,.65fr)] md:items-center">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{row.jobname || "Job sin nombre"}</p><p className="truncate text-xs text-muted-foreground">cron: {row.schedule || "Sin horario"}</p></div>
                        <div><CronStateBadge state={row.estado} /><p className="mt-1 text-[10px] text-muted-foreground">{row.active ? "Activo" : "Pausado"}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última corrida</p><p className="mt-0.5 text-xs font-semibold">{formatDateTime(row.last_run_at)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Último éxito</p><p className="mt-0.5 text-xs font-semibold">{formatDateTime(row.last_success_at)}</p></div>
                        <div className="md:text-right"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">7 días</p><p className={`mt-0.5 text-xs font-semibold ${row.failed_runs_7d ? "text-red-300" : ""}`}>{row.runs_7d || 0} corridas · {row.failed_runs_7d || 0} fallos</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
