import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('regresiones encontradas por el barrido de rutas productivas', () => {
  it('no vuelve a concatenar una hora a timestamps completos de ventas', () => {
    const products = read('src/pages/ProductsPage.tsx');
    expect(products).toContain('daysSinceKnownDate(last, today)');
    expect(products).not.toContain("new Date(last + 'T12:00:00')");
  });

  it('cada superficie aislada conserva una identidad de pestaña útil', () => {
    for (const file of [
      'src/pages/AuthPage.tsx',
      'src/pages/ResetPasswordPage.tsx',
      'src/pages/OnboardingPage.tsx',
      'src/pages/LibroPage.tsx',
    ]) {
      expect(read(file), file).toContain('usePageTitle');
    }
  });

  it('impide reejecutar onboarding sobre una organización ya configurada', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('activeOrg && onboarded && onOnboardingRoute');
    expect(app).toContain('return <Navigate to="/" replace />;');
  });

  it('el checkout vacío anuncia su estado como título de página', () => {
    expect(read('src/storefront/StoreCheckout.tsx')).toContain('<h1 className="font-medium">Tu carrito está vacío</h1>');
  });

  it('Platform no convierte una consulta pendiente o fallida en métricas cero', () => {
    const platform = read('src/pages/PlatformAdminPage.tsx');
    expect(platform).toContain('orgMetricsReady ? stats.orgs');
    expect(platform).toContain('setOrgMetricsError');
    expect(platform).toContain('if (failed) throw failed');
    expect(platform).toContain("plansError ? (");
  });
});
