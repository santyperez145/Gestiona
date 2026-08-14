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
}

export interface PlatformChannelMetrics {
  totalOrganizations: number;
  organizationsWithStorePublished: number;
  organizationsWithStoreActive: number;
  organizationsWithStorePublicationKnown: number;
  organizationsWithOnline: number;
  organizationsWithPos: number;
  omnichannelOrganizations: number;
  storePublishedRate: number;
  onlineRate: number;
  posRate: number;
  omnichannelRate: number;
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
}

export interface PlatformCronHealthMetrics {
  totalJobs: number;
  activeJobs: number;
  pausedJobs: number;
  failingJobs: number;
  runningJobs: number;
  jobsWithoutRuns: number;
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
  return rows.map(row => ({
    ...row,
    daysToStorePublish: finiteOrNull(row.days_to_store_publish) ?? daysBetween(row.org_creada, row.store_published_at),
    daysToFirstOnlineOrder: finiteOrNull(row.days_to_first_online_order) ?? daysBetween(row.org_creada, row.first_online_order_at),
  }));
}

export function calculateChannelMetrics(rows: PlatformActivationRow[]): PlatformChannelMetrics {
  const activationRows = withChannelActivationTimes(rows);
  const totalOrganizations = rows.length;
  const organizationsWithStorePublished = rows.filter(row => row.store_publication_known === true).length;
  const organizationsWithStoreActive = rows.filter(row => row.store_is_active === true).length;
  const organizationsWithStorePublicationKnown = rows.filter(row => row.store_publication_known === true).length;
  const organizationsWithOnline = rows.filter(row => row.uses_online === true).length;
  const organizationsWithPos = rows.filter(row => row.uses_pos === true).length;
  const omnichannelOrganizations = rows.filter(row => row.is_omnichannel === true).length;
  const storePublishTimes = activationRows
    .map(row => row.daysToStorePublish)
    .filter((value): value is number => value !== null);
  const onlineOrderTimes = activationRows
    .map(row => row.daysToFirstOnlineOrder)
    .filter((value): value is number => value !== null);

  return {
    totalOrganizations,
    organizationsWithStorePublished,
    organizationsWithStoreActive,
    organizationsWithStorePublicationKnown,
    organizationsWithOnline,
    organizationsWithPos,
    omnichannelOrganizations,
    storePublishedRate: percentage(organizationsWithStorePublished, totalOrganizations),
    onlineRate: percentage(organizationsWithOnline, totalOrganizations),
    posRate: percentage(organizationsWithPos, totalOrganizations),
    omnichannelRate: percentage(omnichannelOrganizations, totalOrganizations),
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
