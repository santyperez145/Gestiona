import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { firstProductPath } from '@/lib/activationHandoff';
import {
  storeAbandonedCartCount,
  storeAfterCatalogCopy,
  storeFunnelFromCarts,
  storePublishCta,
  storePublishNudges,
  storeShouldLeadWithPay,
  storeShouldShowAfterCatalog,
  storeShouldShowCatalogHandoff,
  storeShouldShowPerformanceChrome,
  storeWizardFinishCopy,
  urlPublicaDeTienda,
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
      publishedProducts: 0,
      paymentConnected: false,
      wantsMercadoPago: false,
      hasOfflinePayment: true,
    })).toBe(false);
    expect(storeShouldLeadWithPay({
      publishedProducts: 1,
      paymentConnected: false,
      wantsMercadoPago: false,
      hasOfflinePayment: true,
    })).toBe(false);
  });

  it('Pay no es el CTA primario si transferencia ya cobra', () => {
    expect(storeShouldLeadWithPay({
      publishedProducts: 1,
      paymentConnected: false,
      wantsMercadoPago: true,
      hasOfflinePayment: true,
    })).toBe(false);
  });

  it('Pay sí encabeza cuando el checkout no puede cobrar', () => {
    expect(storeShouldLeadWithPay({
      publishedProducts: 1,
      paymentConnected: false,
      wantsMercadoPago: true,
      hasOfflinePayment: false,
    })).toBe(true);
    expect(storeShouldLeadWithPay({
      publishedProducts: 1,
      paymentConnected: true,
      wantsMercadoPago: true,
      hasOfflinePayment: false,
    })).toBe(false);
  });

  it('sin catálogo el overview pide el primer producto sin exigir el wizard', () => {
    expect(storeShouldShowCatalogHandoff(0)).toBe(true);
    expect(storeShouldShowCatalogHandoff(1)).toBe(false);
    expect(STORE).toContain('storeShouldShowCatalogHandoff');
    expect(STORE).not.toContain('fromWizard && signals.publishedProducts === 0');
  });

  it('después del primer producto el overview habla de publicar, no de Pay', () => {
    expect(storeShouldShowAfterCatalog({
      fromWizard: true, publishedProducts: 1, storeActive: false,
    })).toBe(true);
    expect(storeShouldShowAfterCatalog({
      fromWizard: true, publishedProducts: 1, storeActive: true,
    })).toBe(false);
    expect(storeAfterCatalogCopy({ canPublish: false }).title).toMatch(/publicá/i);
    expect(storeAfterCatalogCopy({ canPublish: true }).title).toMatch(/Listo/);
    expect(STORE).toContain('storeAfterCatalogCopy');
    expect(STORE).toContain('storeShouldShowAfterCatalog');
    expect(storePublishCta({ canPublish: false })).toEqual({
      kind: 'complete', label: 'Pagos y envíos',
    });
    expect(storePublishCta({ canPublish: true })).toEqual({
      kind: 'activate', label: 'Publicar la tienda',
    });
    expect(STORE).toContain('saveStore({ activate: true })');
    expect(STORE).toContain('reloadReadinessSignals');
    expect(STORE).toContain('onPagesChanged={reloadReadinessSignals}');
    expect(STORE).toContain('onConnectionChange={reloadReadinessSignals}');
    // Toggle+guardar no puede saltarse el mismo gate que «Publicar».
    expect(STORE).toContain('if (isActive && !readiness.canPublish)');
    expect(STORE).not.toContain('if (opts?.activate && !readiness.canPublish)');
  });

  it('los nudges de publicar apuntan a tarifario, legales y pesos', () => {
    const nudges = storePublishNudges({
      productsWithoutWeight: 4,
      legalMissingOrDraft: 2,
      shippingGaps: true,
    });
    expect(nudges.map((n) => n.id)).toEqual(['shipping', 'legal', 'weights']);
    expect(nudges[0].actionHref).toBe('/envios?tab=zonas');
    expect(nudges[2].actionHref).toBe('/productos?completar=pesos');
    expect(STORE).toContain('storePublishNudges');
    expect(PRODUCTS).toContain('completar');
    expect(PRODUCTS).toContain('setPesosOpen(true)');
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

describe('el enlace de la tienda se puede copiar', () => {
  it('arma /tienda/:slug y no inventa un dominio', () => {
    expect(urlPublicaDeTienda('https://exentryimports.vercel.app', 'exentryimports'))
      .toBe('https://exentryimports.vercel.app/tienda/exentryimports');
    expect(urlPublicaDeTienda('https://exentryimports.vercel.app/', '  ')).toBeNull();
    expect(urlPublicaDeTienda('', 'exentryimports')).toBeNull();
  });

  it('Commerce copia el mismo link que abre Ver tienda', () => {
    expect(STORE).toContain('urlPublicaDeTienda');
    expect(STORE).toContain('Copiar enlace');
  });
});
