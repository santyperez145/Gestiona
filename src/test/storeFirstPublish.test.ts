import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { firstProductPath } from '@/lib/activationHandoff';
import {
  storeAbandonedCartCount,
  storeFunnelFromCarts,
  storeShouldLeadWithPay,
  storeShouldShowPerformanceChrome,
  storeWizardFinishCopy,
} from '@/lib/storeFirstPublish';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ONBOARDING = readFileSync(resolve(ROOT, 'src/pages/OnboardingPage.tsx'), 'utf8');
const STORE = readFileSync(resolve(ROOT, 'src/pages/EcommerceStorePage.tsx'), 'utf8');
const PRODUCTS = readFileSync(resolve(ROOT, 'src/pages/ProductsPage.tsx'), 'utf8');

describe('la primera publicación empieza por el catálogo', () => {
  it('el wizard online manda a Productos, no a un panel vacío', () => {
    expect(firstProductPath('online')).toBe('/productos?onboarding=1&goal=online');
    expect(storeWizardFinishCopy().toast).toMatch(/producto/);
    expect(ONBOARDING).toContain("navigate(firstProductPath('online'))");
    expect(ONBOARDING).toContain('storeWizardFinishCopy');
    expect(ONBOARDING).not.toContain("navigate('/tienda-online?onboarding=1&goal=online')");
    expect(PRODUCTS).toContain('firstProductFormDescription');
  });

  it('sin catálogo el overview no abre con Mercado Pago', () => {
    expect(storeShouldLeadWithPay({
      fromWizard: true, publishedProducts: 0, paymentConnected: false,
    })).toBe(false);
    expect(storeShouldLeadWithPay({
      fromWizard: true, publishedProducts: 1, paymentConnected: false,
    })).toBe(true);
    expect(storeShouldLeadWithPay({
      fromWizard: false, publishedProducts: 0, paymentConnected: true,
    })).toBe(false);
  });
});

describe('el embudo no inventa un checkout', () => {
  it('no muestra analítica cuando no hubo tráfico', () => {
    expect(storeShouldShowPerformanceChrome({ sessionCount: 0, orderCount: 0 })).toBe(false);
    expect(storeShouldShowPerformanceChrome({ sessionCount: 2, orderCount: 0 })).toBe(true);
    expect(storeShouldShowPerformanceChrome({ sessionCount: 0, orderCount: 1 })).toBe(true);
  });

  it('cuenta sesiones, carritos y órdenes reales', () => {
    const steps = storeFunnelFromCarts([
      { status: 'active', items: [] },
      { status: 'active', items: [{ id: 1 }] },
      { status: 'converted', items: [{ id: 1 }] },
      { status: 'abandoned', items: [{ id: 1 }] },
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      'Sesiones', 'Con items en carrito', 'Órdenes completadas',
    ]);
    expect(steps.map((s) => s.value)).toEqual([4, 3, 1]);
    expect(storeAbandonedCartCount([
      { status: 'abandoned', items: [] },
      { status: 'converted', items: [] },
    ])).toBe(1);
  });

  it('Commerce usa el embudo medido y no un 37%', () => {
    expect(STORE).toContain('storeFunnelFromCarts');
    expect(STORE).toContain('storeShouldShowPerformanceChrome');
    expect(STORE).toContain('storeShouldLeadWithPay');
    expect(STORE).toContain('StoreReadinessPanel');
    expect(STORE).not.toMatch(/\*\s*0\.37/);
    expect(STORE).not.toContain('Checkout iniciado');
  });
});
