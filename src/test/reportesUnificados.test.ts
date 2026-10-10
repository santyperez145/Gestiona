import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { businessAliases, navRoutes } from '@/app/routeManifest';

/**
 * 2026-10-10: Reportes y Analytics eran dos destinos del menú con Resumen,
 * Rentabilidad y Proyección repetidos. Ahora es uno, en /reportes.
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

describe('un solo destino de reportes', () => {
  it('el menú tiene Reportes y no Analytics', () => {
    const rutas = navRoutes().map(r => r.path);
    expect(rutas).toContain('/reportes');
    expect(rutas).not.toContain('/analytics');
  });

  it('los enlaces viejos llegan a la vista correcta', () => {
    const alias = new Map(businessAliases());
    expect(alias.get('/analytics')).toBe('/reportes');
    expect(alias.get('/kpi-dashboard')).toBe('/reportes?vista=tableros');
    expect(alias.get('/forecast')).toBe('/reportes?vista=pronostico');
    expect(alias.get('/profit')).toBe('/reportes?vista=rentabilidad');
  });

  it('los informes descargables son una vista y el análisis exige su permiso', () => {
    const espacio = leer('src/pages/AnalyticsPage.tsx');
    expect(espacio).toContain('const InformesView = lazy(() => import("@/pages/ReportsPage"));');
    expect(espacio).toContain('useModulePerms("analytics")');
    expect(espacio).toContain('{ id: "informes", label: "Informes", icon: FileSpreadsheet }');
  });

  it('ningún enlace interno apunta a /analytics', () => {
    for (const archivo of ['src/components/AppLayout.tsx', 'src/components/commerce/CommerceHeader.tsx', 'src/components/shared/OperationMarginPanel.tsx', 'src/components/dashboard/AIProductRecommenderWidget.tsx', 'src/components/ai-chat/AIChatAssistantTab.tsx']) {
      expect(leer(archivo), archivo).not.toMatch(/["']\/analytics/);
    }
  });
});
