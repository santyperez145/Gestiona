import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_VIEW_IDS,
  dashboardViewKey,
  isDashboardViewId,
} from '@/lib/dashboardViews';

const root = resolve(import.meta.dirname, '..', '..');
const dashboard = readFileSync(resolve(root, 'src/pages/Dashboard.tsx'), 'utf8');
const styles = readFileSync(resolve(root, 'src/index.css'), 'utf8');

describe('contrato de vistas del dashboard', () => {
  it('acepta todos los hashes históricos y rechaza valores ajenos', () => {
    for (const id of DASHBOARD_VIEW_IDS) expect(isDashboardViewId(id)).toBe(true);
    expect(isDashboardViewId('dashboard-unknown')).toBe(false);
    expect(isDashboardViewId('sales')).toBe(false);
  });

  it('traduce cada hash a una clave CSS única', () => {
    expect(DASHBOARD_VIEW_IDS.map(dashboardViewKey)).toEqual([
      'overview', 'sales', 'customers', 'inventory', 'finance', 'intelligence',
    ]);
  });

  it('entrega al layout la clave CSS y no el hash completo', () => {
    expect(dashboard).toContain('data-dashboard-view={visibleDashboardViewKey}');
    expect(dashboard).not.toContain('data-dashboard-view={visibleDashboardSection}');
  });

  it('mantiene una regla visible para cada tab', () => {
    for (const id of DASHBOARD_VIEW_IDS) {
      const key = dashboardViewKey(id);
      expect(styles).toContain(
        `[data-dashboard-view="${key}"] > .dashboard-view-section[data-dashboard-section="${key}"]`,
      );
    }
  });
});
