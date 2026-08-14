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

