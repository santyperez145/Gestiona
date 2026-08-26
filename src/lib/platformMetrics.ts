export interface PlatformHealthRow {
  org_id: string | null;
  org_name: string | null;
  slug: string | null;
  org_creada: string | null;
  onboarding_completed: boolean | null;
  plan_name: string | null;
  subscription_status: string | null;
  gmv_30d: number | null;
  gmv_prev_30d: number | null;
  gmv_total: number | null;
  comision_30d: number | null;
  comision_total: number | null;
  cobros_30d: number | null;
  cobros_total: number | null;
  ultimo_cobro: string | null;
  primer_cobro: string | null;
  dias_sin_cobrar: number | null;
  miembros: number | null;
  productos: number | null;
  tiendas_activas: number | null;
  variacion_pct: number | null;
  senal: string | null;
}

export interface ActivationRow extends PlatformHealthRow {
  daysToFirstCharge: number | null;
}

export interface PlatformActivationRow {
  org_id: string | null;
  org_name: string | null;
  slug: string | null;
  org_creada: string | null;
  store_id: string | null;
  store_slug: string | null;
  store_is_active: boolean | null;
  store_published_at: string | null;
  store_publication_known: boolean | null;
  first_online_order_at: string | null;
  online_orders_total: number | null;
  online_orders_30d: number | null;
  first_pos_sale_at: string | null;
  pos_sales_total: number | null;
  pos_sales_30d: number | null;
  uses_online: boolean | null;
  uses_pos: boolean | null;
  is_omnichannel: boolean | null;
  days_to_store_publish: number | null;
  days_to_first_online_order: number | null;
}

export interface ChannelActivationRow extends PlatformActivationRow {
  daysToStorePublish: number | null;
  daysToFirstOnlineOrder: number | null;
  firstSaleAt: string | null;
  firstSaleChannel: "online" | "pos" | null;
  daysToFirstSale: number | null;
}

export interface PlatformChannelMetrics {
  totalOrganizations: number;
  activatedOrganizations: number;
  organizationsWithStorePublished: number;
  organizationsWithStoreActive: number;
  organizationsWithStorePublicationKnown: number;
  organizationsWithOnline: number;
  organizationsWithPos: number;
  omnichannelOrganizations: number;
  storePublishedRate: number;
  firstSaleRate: number;
  onlineRate: number;
  posRate: number;
  omnichannelRate: number;
  averageDaysToFirstSale: number | null;
  medianDaysToFirstSale: number | null;
  averageDaysToStorePublish: number | null;
  medianDaysToStorePublish: number | null;
  averageDaysToFirstOnlineOrder: number | null;
  medianDaysToFirstOnlineOrder: number | null;
  rows: ChannelActivationRow[];
}

export interface PlatformStockAccuracyRow {
  org_id: string | null;
  org_name: string | null;
  slug: string | null;
  productos_total: number | null;
  productos_medidos: number | null;
  productos_coinciden: number | null;
  productos_descuadrados: number | null;
  productos_sin_kardex: number | null;
  productos_stock_negativo: number | null;
  precision_pct: number | null;
  ultimo_movimiento_at: string | null;
  conteos_cerrados: number | null;
  ultimo_conteo_at: string | null;
}

export interface PlatformStockAccuracyMetrics {
  totalOrganizations: number;
  organizationsWithMeasuredStock: number;
  totalProducts: number;
  measuredProducts: number;
  matchingProducts: number;
  mismatchingProducts: number;
  unmeasuredProducts: number;
  negativeStockProducts: number;
  accuracyPct: number | null;
  rows: PlatformStockAccuracyRow[];
}

export interface PlatformAiActionRow {
  org_id: string | null;
  org_name: string | null;
  slug: string | null;
  recommendations_total: number | null;
  recommendations_applied: number | null;
  recommendations_dismissed: number | null;
  recommendations_pending: number | null;
  action_rate_pct: number | null;
  first_recommendation_at: string | null;
  last_recommendation_at: string | null;
  last_applied_at: string | null;
}

export interface PlatformAiActionMetrics {
  totalOrganizations: number;
  organizationsWithRecommendations: number;
  organizationsWithAppliedRecommendation: number;
  recommendationsTotal: number;
  recommendationsApplied: number;
  recommendationsDismissed: number;
  recommendationsPending: number;
  actionRatePct: number | null;
  rows: PlatformAiActionRow[];
}

export interface PlatformRiskSeriesRow {
  snapshot_date: string | null;
  en_riesgo: number | null;
  cayendo: number | null;
  dormido: number | null;
  sin_activar: number | null;
  comercios_en_riesgo: number | null;
  gmv_en_riesgo: number | null;
}

export interface PlatformRiskSeriesMetrics {
  observations: number;
  latest: PlatformRiskSeriesRow | null;
  previous: PlatformRiskSeriesRow | null;
  riskOrganizations: number;
  riskOrganizationChange: number | null;
  atRiskGmv: number;
  rows: PlatformRiskSeriesRow[];
}

export interface PlatformCronHealthRow {
  jobid: number | null;
  jobname: string | null;
  schedule: string | null;
  active: boolean | null;
  last_status: string | null;
  last_run_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  runs_7d: number | null;
  failed_runs_7d: number | null;
  estado: string | null;
  /**
   * Columnas agregadas el 2026-08-26. El exito de un cron que llama una Edge
   * Function solo prueba que pg_net encolo el request: `net.http_post` es
   * asincrono y el job termina sin esperar respuesta. Estas columnas traen el
   * resultado real de esa invocacion.
   */
  edge_function?: string | null;
  invocaciones_fallidas_7d?: number | null;
  ultimo_status_invocacion?: number | null;
  ultimo_error_invocacion?: string | null;
}

/** Una fila de `platform_edge_invocation_health`. */
export interface PlatformEdgeInvocationRow {
  function_name: string | null;
  invocaciones_24h: number | null;
  errores_24h: number | null;
  timeouts_24h: number | null;
  sin_despachar_24h: number | null;
  invocaciones_7d: number | null;
  errores_7d: number | null;
  /**
   * Encolado -> respuesta registrada por pg_net. Incluye la cola y NO es el
   * tiempo de ejecucion de la funcion; presentarlo como tal seria inventar.
   */
  p95_seg_24h: number | null;
  ultima_invocacion: string | null;
  ultimo_status: number | null;
  ultimo_error: string | null;
}

export interface PlatformEdgeInvocationMetrics {
  /** Invocaciones reconciliadas en 24 h. Sin ellas no hay tasa que mostrar. */
  invocaciones24h: number;
  errores24h: number;
  timeouts24h: number;
  sinDespachar24h: number;
  /** null cuando no hubo invocaciones: 0% seria mentira, no ausencia de error. */
  errorRate24h: number | null;
  /** El peor P95 entre las funciones, con su nombre. null si nadie respondio. */
  peorP95: { funcion: string; segundos: number } | null;
  funcionesConError: PlatformEdgeInvocationRow[];
  rows: PlatformEdgeInvocationRow[];
}

export interface PlatformCronHealthMetrics {
  totalJobs: number;
  activeJobs: number;
  pausedJobs: number;
  failingJobs: number;
  runningJobs: number;
  jobsWithoutRuns: number;
  noResponseJobs: number;
  runs7d: number;
  failedRuns7d: number;
  rows: PlatformCronHealthRow[];
}

export interface PlatformMetrics {
  totalOrganizations: number;
  onboardedOrganizations: number;
  catalogReadyOrganizations: number;
  storeReadyOrganizations: number;
  activatedOrganizations: number;
  onboardingRate: number;
  catalogRate: number;
  storeRate: number;
  activationRate: number;
  gmv30d: number;
  gmvTotal: number;
  commission30d: number;
  payingOrganizations: number;
  trialOrganizations: number;
  riskOrganizations: number;
  averageDaysToFirstCharge: number | null;
  medianDaysToFirstCharge: number | null;
  activationTimes: ActivationRow[];
  signalCounts: Record<string, number>;
}

const DAY_MS = 86400000;

function numberOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function daysBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null;
  return Math.round((endTime - startTime) / DAY_MS * 10) / 10;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function earliestTimestamp(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value) && Number.isFinite(new Date(value).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return valid[0] || null;
}

function minimumFinite(values: Array<number | null | undefined>): number | null {
  const valid = values
    .map(finiteOrNull)
    .filter((value): value is number => value !== null);
  return valid.length ? Math.min(...valid) : null;
}

function maximumFinite(values: Array<number | null | undefined>): number {
  const valid = values
    .map(finiteOrNull)
    .filter((value): value is number => value !== null);
  return valid.length ? Math.max(...valid) : 0;
}

/**
 * platform_org_activation devuelve una fila por tienda. La adopción pertenece
 * a la organización: al sumar filas crudas, una organización multi-tienda
 * infla tasas, ventas y tiempos. Consolidamos antes de calcular métricas.
 */
export function mergeActivationRowsByOrganization(rows: PlatformActivationRow[]): PlatformActivationRow[] {
  const grouped = new Map<string, PlatformActivationRow[]>();
  rows.forEach((row, index) => {
    const key = row.org_id || (row.slug ? `slug:${row.slug}` : `unknown:${index}`);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });

  return Array.from(grouped.values()).map(group => {
    const first = group[0];
    const firstOnlineOrderAt = earliestTimestamp(group.map(row => row.first_online_order_at));
    const firstPosSaleAt = earliestTimestamp(group.map(row => row.first_pos_sale_at));
    const storePublishedAt = earliestTimestamp(group.map(row => row.store_published_at));
    const usesOnline = firstOnlineOrderAt !== null || group.some(row => row.uses_online === true);
    const usesPos = firstPosSaleAt !== null || group.some(row => row.uses_pos === true);

    return {
      ...first,
      store_id: group.length === 1 ? first.store_id : null,
      store_slug: group.length === 1 ? first.store_slug : `${group.length} tiendas`,
      store_is_active: group.some(row => row.store_is_active === true),
      store_published_at: storePublishedAt,
      store_publication_known: storePublishedAt !== null || group.some(row => row.store_publication_known === true),
      first_online_order_at: firstOnlineOrderAt,
      online_orders_total: maximumFinite(group.map(row => row.online_orders_total)),
      online_orders_30d: maximumFinite(group.map(row => row.online_orders_30d)),
      first_pos_sale_at: firstPosSaleAt,
      pos_sales_total: maximumFinite(group.map(row => row.pos_sales_total)),
      pos_sales_30d: maximumFinite(group.map(row => row.pos_sales_30d)),
      uses_online: usesOnline,
      uses_pos: usesPos,
      is_omnichannel: usesOnline && usesPos,
      days_to_store_publish: minimumFinite(group.map(row => row.days_to_store_publish)),
      days_to_first_online_order: minimumFinite(group.map(row => row.days_to_first_online_order)),
    };
  });
}

function firstSale(row: PlatformActivationRow): { at: string | null; channel: "online" | "pos" | null } {
  const onlineAt = earliestTimestamp([row.first_online_order_at]);
  const posAt = earliestTimestamp([row.first_pos_sale_at]);
  if (!onlineAt) return { at: posAt, channel: posAt ? "pos" : null };
  if (!posAt) return { at: onlineAt, channel: "online" };
  return new Date(onlineAt).getTime() <= new Date(posAt).getTime()
    ? { at: onlineAt, channel: "online" }
    : { at: posAt, channel: "pos" };
}

export function withActivationTimes(rows: PlatformHealthRow[]): ActivationRow[] {
  return rows.map(row => ({
    ...row,
    daysToFirstCharge: daysBetween(row.org_creada, row.primer_cobro),
  }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round(((ordered[middle - 1] + ordered[middle]) / 2) * 10) / 10
    : ordered[middle];
}

function percentage(value: number, total: number): number {
  return total ? Math.round(value / total * 100) : 0;
}

function average(values: number[]): number | null {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10
    : null;
}

export function withChannelActivationTimes(rows: PlatformActivationRow[]): ChannelActivationRow[] {
  return rows.map(row => {
    const first = firstSale(row);
    return {
      ...row,
      daysToStorePublish: finiteOrNull(row.days_to_store_publish) ?? daysBetween(row.org_creada, row.store_published_at),
      daysToFirstOnlineOrder: finiteOrNull(row.days_to_first_online_order) ?? daysBetween(row.org_creada, row.first_online_order_at),
      firstSaleAt: first.at,
      firstSaleChannel: first.channel,
      daysToFirstSale: daysBetween(row.org_creada, first.at),
    };
  });
}

export function calculateChannelMetrics(rows: PlatformActivationRow[]): PlatformChannelMetrics {
  const activationRows = withChannelActivationTimes(mergeActivationRowsByOrganization(rows));
  const totalOrganizations = activationRows.length;
  const activatedOrganizations = activationRows.filter(row => row.firstSaleAt !== null).length;
  const organizationsWithStorePublished = activationRows.filter(row => row.store_publication_known === true).length;
  const organizationsWithStoreActive = activationRows.filter(row => row.store_is_active === true).length;
  const organizationsWithStorePublicationKnown = activationRows.filter(row => row.store_publication_known === true).length;
  const organizationsWithOnline = activationRows.filter(row => row.uses_online === true).length;
  const organizationsWithPos = activationRows.filter(row => row.uses_pos === true).length;
  const omnichannelOrganizations = activationRows.filter(row => row.is_omnichannel === true).length;
  const firstSaleTimes = activationRows
    .map(row => row.daysToFirstSale)
    .filter((value): value is number => value !== null);
  const storePublishTimes = activationRows
    .map(row => row.daysToStorePublish)
    .filter((value): value is number => value !== null);
  const onlineOrderTimes = activationRows
    .map(row => row.daysToFirstOnlineOrder)
    .filter((value): value is number => value !== null);

  return {
    totalOrganizations,
    activatedOrganizations,
    organizationsWithStorePublished,
    organizationsWithStoreActive,
    organizationsWithStorePublicationKnown,
    organizationsWithOnline,
    organizationsWithPos,
    omnichannelOrganizations,
    storePublishedRate: percentage(organizationsWithStorePublished, totalOrganizations),
    firstSaleRate: percentage(activatedOrganizations, totalOrganizations),
    onlineRate: percentage(organizationsWithOnline, totalOrganizations),
    posRate: percentage(organizationsWithPos, totalOrganizations),
    omnichannelRate: percentage(omnichannelOrganizations, totalOrganizations),
    averageDaysToFirstSale: average(firstSaleTimes),
    medianDaysToFirstSale: median(firstSaleTimes),
    averageDaysToStorePublish: average(storePublishTimes),
    medianDaysToStorePublish: median(storePublishTimes),
    averageDaysToFirstOnlineOrder: average(onlineOrderTimes),
    medianDaysToFirstOnlineOrder: median(onlineOrderTimes),
    rows: activationRows,
  };
}

export function calculateStockAccuracyMetrics(rows: PlatformStockAccuracyRow[]): PlatformStockAccuracyMetrics {
  const totalProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_total), 0);
  const measuredProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_medidos), 0);
  const matchingProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_coinciden), 0);
  const mismatchingProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_descuadrados), 0);
  const unmeasuredProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_sin_kardex), 0);
  const negativeStockProducts = rows.reduce((sum, row) => sum + numberOrZero(row.productos_stock_negativo), 0);

  return {
    totalOrganizations: rows.length,
    organizationsWithMeasuredStock: rows.filter(row => numberOrZero(row.productos_medidos) > 0).length,
    totalProducts,
    measuredProducts,
    matchingProducts,
    mismatchingProducts,
    unmeasuredProducts,
    negativeStockProducts,
    accuracyPct: measuredProducts > 0 ? Math.round(matchingProducts / measuredProducts * 1000) / 10 : null,
    rows: [...rows].sort((a, b) => {
      const mismatchDiff = numberOrZero(b.productos_descuadrados) - numberOrZero(a.productos_descuadrados);
      if (mismatchDiff !== 0) return mismatchDiff;
      return numberOrZero(a.precision_pct) - numberOrZero(b.precision_pct);
    }),
  };
}

export function calculateAiActionMetrics(rows: PlatformAiActionRow[]): PlatformAiActionMetrics {
  const recommendationsTotal = rows.reduce((sum, row) => sum + numberOrZero(row.recommendations_total), 0);
  const recommendationsApplied = rows.reduce((sum, row) => sum + numberOrZero(row.recommendations_applied), 0);
  const recommendationsDismissed = rows.reduce((sum, row) => sum + numberOrZero(row.recommendations_dismissed), 0);
  const recommendationsPending = rows.reduce((sum, row) => sum + numberOrZero(row.recommendations_pending), 0);

  return {
    totalOrganizations: rows.length,
    organizationsWithRecommendations: rows.filter(row => numberOrZero(row.recommendations_total) > 0).length,
    organizationsWithAppliedRecommendation: rows.filter(row => numberOrZero(row.recommendations_applied) > 0).length,
    recommendationsTotal,
    recommendationsApplied,
    recommendationsDismissed,
    recommendationsPending,
    actionRatePct: recommendationsTotal > 0
      ? Math.round(recommendationsApplied / recommendationsTotal * 1000) / 10
      : null,
    rows: [...rows].sort((a, b) => {
      const totalDiff = numberOrZero(b.recommendations_total) - numberOrZero(a.recommendations_total);
      if (totalDiff !== 0) return totalDiff;
      return numberOrZero(b.recommendations_applied) - numberOrZero(a.recommendations_applied);
    }),
  };
}

export function calculateRiskSeriesMetrics(rows: PlatformRiskSeriesRow[]): PlatformRiskSeriesMetrics {
  const ordered = [...rows].sort((a, b) => (a.snapshot_date || "").localeCompare(b.snapshot_date || ""));
  const latest = ordered.length ? ordered[ordered.length - 1] : null;
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const riskOrganizations = numberOrZero(latest?.comercios_en_riesgo);

  return {
    observations: ordered.length,
    latest,
    previous,
    riskOrganizations,
    riskOrganizationChange: previous
      ? riskOrganizations - numberOrZero(previous.comercios_en_riesgo)
      : null,
    atRiskGmv: numberOrZero(latest?.gmv_en_riesgo),
    rows: ordered,
  };
}

const CRON_STATE_ORDER: Record<string, number> = {
  fallando: 0,
  ejecutando: 1,
  sin_ejecuciones: 2,
  saludable: 3,
  pausado: 4,
};

export function calculateCronHealthMetrics(rows: PlatformCronHealthRow[]): PlatformCronHealthMetrics {
  const activeRows = rows.filter(row => row.active === true);

  return {
    totalJobs: rows.length,
    activeJobs: activeRows.length,
    pausedJobs: rows.filter(row => row.active === false).length,
    failingJobs: activeRows.filter(row => row.estado === "fallando").length,
    runningJobs: activeRows.filter(row => row.estado === "ejecutando").length,
    jobsWithoutRuns: activeRows.filter(row => row.last_run_at === null).length,
    // `sin_respuesta` es un estado propio: el despacho salio y la funcion no
    // contesto. No es lo mismo que `fallando` —que contesto mal— ni que estar
    // sano, y meterlo en cualquiera de los dos borra la unica pista del
    // problema.
    noResponseJobs: activeRows.filter(row => row.estado === "sin_respuesta").length,
    runs7d: rows.reduce((sum, row) => sum + numberOrZero(row.runs_7d), 0),
    failedRuns7d: rows.reduce((sum, row) => sum + numberOrZero(row.failed_runs_7d), 0),
    rows: [...rows].sort((a, b) => {
      const statusDiff = (CRON_STATE_ORDER[a.estado || ""] ?? 3) - (CRON_STATE_ORDER[b.estado || ""] ?? 3);
      if (statusDiff !== 0) return statusDiff;
      return (a.jobname || "").localeCompare(b.jobname || "");
    }),
  };
}

export function calculatePlatformMetrics(rows: PlatformHealthRow[]): PlatformMetrics {
  const activationTimes = withActivationTimes(rows);
  const completedTimes = activationTimes
    .map(row => row.daysToFirstCharge)
    .filter((value): value is number => value !== null);
  const totalOrganizations = rows.length;
  const onboardedOrganizations = rows.filter(row => row.onboarding_completed === true).length;
  const catalogReadyOrganizations = rows.filter(row => numberOrZero(row.productos) > 0).length;
  const storeReadyOrganizations = rows.filter(row => numberOrZero(row.tiendas_activas) > 0).length;
  const activatedOrganizations = rows.filter(row => numberOrZero(row.cobros_total) > 0).length;
  const signalCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const signal = row.senal || "sin_dato";
    counts[signal] = (counts[signal] || 0) + 1;
    return counts;
  }, {});

  return {
    totalOrganizations,
    onboardedOrganizations,
    catalogReadyOrganizations,
    storeReadyOrganizations,
    activatedOrganizations,
    onboardingRate: totalOrganizations ? Math.round(onboardedOrganizations / totalOrganizations * 100) : 0,
    catalogRate: totalOrganizations ? Math.round(catalogReadyOrganizations / totalOrganizations * 100) : 0,
    storeRate: totalOrganizations ? Math.round(storeReadyOrganizations / totalOrganizations * 100) : 0,
    activationRate: totalOrganizations ? Math.round(activatedOrganizations / totalOrganizations * 100) : 0,
    gmv30d: rows.reduce((sum, row) => sum + numberOrZero(row.gmv_30d), 0),
    gmvTotal: rows.reduce((sum, row) => sum + numberOrZero(row.gmv_total), 0),
    commission30d: rows.reduce((sum, row) => sum + numberOrZero(row.comision_30d), 0),
    payingOrganizations: rows.filter(row => row.subscription_status === "active").length,
    trialOrganizations: rows.filter(row => row.subscription_status === "trialing").length,
    riskOrganizations: rows.filter(row => ["en_riesgo", "cayendo", "dormido"].includes(row.senal || "")).length,
    averageDaysToFirstCharge: completedTimes.length
      ? Math.round(completedTimes.reduce((sum, value) => sum + value, 0) / completedTimes.length * 10) / 10
      : null,
    medianDaysToFirstCharge: median(completedTimes),
    activationTimes: activationTimes.sort((a, b) => {
      if (a.daysToFirstCharge === null) return 1;
      if (b.daysToFirstCharge === null) return -1;
      return b.daysToFirstCharge - a.daysToFirstCharge;
    }),
    signalCounts,
  };
}

/**
 * Salud real de las Edge Functions que dispara el cron.
 *
 * ── Por qué el error rate puede ser null ──────────────────────────────────
 *
 * Sin invocaciones reconciliadas no hay tasa. Devolver 0% ahí diría "no falló
 * nada" cuando lo cierto es "no se sabe", y ésa es la confusión que este
 * módulo existe para evitar: `platform_cron_health` mostraba los 20 jobs en
 * verde mientras el 10% de las invocaciones fallaba, porque el éxito del cron
 * sólo probaba que pg_net encoló el request.
 *
 * Una invocación pendiente de reconciliar no cuenta ni como éxito ni como
 * falla: la vista sólo clasifica lo que ya tiene respuesta.
 */
export function calculateEdgeInvocationMetrics(
  rows: PlatformEdgeInvocationRow[],
): PlatformEdgeInvocationMetrics {
  const invocaciones24h = rows.reduce((sum, row) => sum + numberOrZero(row.invocaciones_24h), 0);
  const errores24h = rows.reduce((sum, row) => sum + numberOrZero(row.errores_24h), 0);

  // El peor P95 se busca sobre las que respondieron. Promediar P95 entre
  // funciones no significa nada: un percentil no se promedia.
  let peorP95: { funcion: string; segundos: number } | null = null;
  for (const row of rows) {
    const p95 = row.p95_seg_24h;
    if (p95 === null || p95 === undefined || !Number.isFinite(Number(p95))) continue;
    const segundos = Number(p95);
    if (!peorP95 || segundos > peorP95.segundos) {
      peorP95 = { funcion: row.function_name || "(sin nombre)", segundos };
    }
  }

  return {
    invocaciones24h,
    errores24h,
    timeouts24h: rows.reduce((sum, row) => sum + numberOrZero(row.timeouts_24h), 0),
    sinDespachar24h: rows.reduce((sum, row) => sum + numberOrZero(row.sin_despachar_24h), 0),
    errorRate24h: invocaciones24h > 0
      ? Math.round(errores24h / invocaciones24h * 1000) / 10
      : null,
    peorP95,
    funcionesConError: rows
      .filter(row => numberOrZero(row.errores_24h) > 0 || numberOrZero(row.sin_despachar_24h) > 0)
      .sort((a, b) => numberOrZero(b.errores_24h) - numberOrZero(a.errores_24h)),
    rows: [...rows].sort((a, b) => {
      const errorDiff = numberOrZero(b.errores_24h) - numberOrZero(a.errores_24h);
      if (errorDiff !== 0) return errorDiff;
      return (a.function_name || "").localeCompare(b.function_name || "");
    }),
  };
}
