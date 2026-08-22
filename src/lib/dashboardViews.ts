export const DASHBOARD_VIEW_IDS = [
  'dashboard-overview',
  'dashboard-sales',
  'dashboard-customers',
  'dashboard-inventory',
  'dashboard-finance',
  'dashboard-intelligence',
] as const;

export type DashboardViewId = (typeof DASHBOARD_VIEW_IDS)[number];
export type DashboardViewKey = DashboardViewId extends `dashboard-${infer Key}` ? Key : never;

const DASHBOARD_VIEW_ID_SET = new Set<string>(DASHBOARD_VIEW_IDS);

export function isDashboardViewId(value: string): value is DashboardViewId {
  return DASHBOARD_VIEW_ID_SET.has(value);
}

/**
 * El hash público conserva `dashboard-*`, mientras que el selector de layout
 * usa la clave corta que comparten `data-dashboard-view` y
 * `data-dashboard-section`. Centralizar la traducción evita que todas las
 * vistas terminen ocultas por un contrato CSS divergente.
 */
export function dashboardViewKey(viewId: DashboardViewId): DashboardViewKey {
  return viewId.slice('dashboard-'.length) as DashboardViewKey;
}
