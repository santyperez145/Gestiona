import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * El Inicio abre con qué hacer —vender, reponer, cobrar, facturar— y deja el
 * análisis plegado en «Más indicadores» (2026-10-10). Antes, ~30 bloques con
 * el mismo peso: el mejor día de la semana al lado de una deuda vencida.
 */
const dashboard = readFileSync(resolve(process.cwd(), 'src/pages/Dashboard.tsx'), 'utf8');
const inicio = dashboard.slice(
  dashboard.indexOf('data-dashboard-section="overview"'),
  dashboard.indexOf('data-dashboard-section="sales"'),
);
const plegado = inicio.slice(inicio.indexOf('id="dashboard-mas-indicadores"'));
const aLaVista = inicio.slice(0, inicio.indexOf('id="dashboard-mas-indicadores"'));

describe('Inicio por tarea', () => {
  it('lo accionable queda a la vista', () => {
    for (const bloque of ['<FocoDelDia', '<DashboardKPIsSection', '<CommerceQuickActions', 'Tasks Due Today', 'Smart Alerts', 'Productos por vencer']) {
      expect(aLaVista, bloque).toContain(bloque);
    }
  });

  it('el análisis espera plegado', () => {
    for (const bloque of ['Best day of the week', 'Best hour of day', 'Last 8 hours', '7-day forecast', 'USD Rates Banner', 'Birthday Reminders', 'Top cliente de la semana']) {
      expect(plegado, bloque).toContain(bloque);
      expect(aLaVista, bloque).not.toContain(bloque);
    }
    expect(dashboard).toContain('orgViewKey("dashboard.mas-indicadores", activeOrg?.id),\n    false,');
  });

  it('el Foco incluye qué facturar', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/lib/dashboardFocus.ts'), 'utf8')).toContain('id: "facturas-con-problema"');
  });
});
