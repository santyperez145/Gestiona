import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { firstProductPath } from '@/lib/activationHandoff';
import { politicaDePrivacidad, storeAnalyticsDisclosureReady } from '@/lib/legalPages';
import {
  storeAfterCatalogCopy,
  parseStorePerformanceSnapshot,
  storeAttributionCoverageCopy,
  storeFunnelCoverageCopy,
  storeFunnelFromPerformance,
  storePerformanceComparisonCopy,
  storePerformancePeriodLabel,
  storePerformanceTrend,
  storeChannelCoverageCopy,
  storePublishCta,
  storePublishNudges,
  storeShouldLeadWithPay,
  storeShouldShowAfterCatalog,
  storeShouldShowCatalogHandoff,
  storeShouldShowStoreMissingHandoff,
  storeShouldShowPerformanceChrome,
  storeMissingCopy,
  storeStatusLabel,
  storeShouldLeadSettingsWithIdentity,
  storeShouldLeadSettingsWithBank,
  storeShouldLeadSettingsWithPickup,
  storeBankLeadCopy,
  storePickupLeadCopy,
  storeShouldSeedPagesOnCreate,
  storeShouldLeadSettingsWithLegal,
  storeShouldLeadSettingsWithEmail,
  storeLegalLeadCopy,
  storeEmailLeadCopy,
  storeShouldLeadSettingsWithHours,
  storeHoursLeadCopy,
  storeAfterCreateCopy,
  storeWizardFinishCopy,
  urlPublicaDeTienda,
  enlaceCanonicoDeVitrina,
  storeFirstSaleSharePath,
  storeOrdersEmptyShareCopy,
  storeShareIntentActive,
  storeShareIntentCopy,
  storeTrafficChannelLabel,
  enlaceInfluencerConRef,
} from '@/lib/storeFirstPublish';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ONBOARDING = readFileSync(resolve(ROOT, 'src/pages/OnboardingPage.tsx'), 'utf8');
const STORE = readFileSync(resolve(ROOT, 'src/pages/EcommerceStorePage.tsx'), 'utf8');
const ORDERS_PAGE = readFileSync(resolve(ROOT, 'src/pages/StoreOrdersPage.tsx'), 'utf8');
const PRODUCTS = readFileSync(resolve(ROOT, 'src/pages/ProductsPage.tsx'), 'utf8');
const PERFORMANCE_SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260904000020_store_checkout_stage.sql'),
  'utf8',
);
const PERFORMANCE_PERIOD_SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260904000030_store_performance_period.sql'),
  'utf8',
);
const CHANNEL_ATTRIBUTION_SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260904000040_store_channel_attribution.sql'),
  'utf8',
);
const ANALYTICS_DISCLOSURE_SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260904000050_store_analytics_disclosure.sql'),
  'utf8',
);
const CHECKOUT = readFileSync(resolve(ROOT, 'src/storefront/StoreCheckout.tsx'), 'utf8');
const PUBLIC_DATA = readFileSync(resolve(ROOT, 'src/lib/publicDataSource.ts'), 'utf8');
const DATE_RANGE = readFileSync(resolve(ROOT, 'src/components/shared/DateRangeFilter.tsx'), 'utf8');

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

  it('sin fila de tienda el overview pide crear antes del catálogo', () => {
    expect(storeShouldShowStoreMissingHandoff(null)).toBe(true);
    expect(storeShouldShowStoreMissingHandoff(undefined)).toBe(true);
    expect(storeShouldShowStoreMissingHandoff('uuid')).toBe(false);
    expect(storeMissingCopy().title).toMatch(/Creá la tienda/i);
    expect(storeStatusLabel({
      storeExists: false, isActive: false, canPublish: false, readinessSummary: 'x',
    })).toBe('○ Sin crear');
    expect(storeStatusLabel({
      storeExists: true, isActive: false, canPublish: false, readinessSummary: 'x',
    })).toBe('○ Inactiva');
    expect(STORE).toContain('storeShouldShowStoreMissingHandoff');
    expect(STORE).toContain('storeStatusLabel');
    expect(STORE).toContain('.select("*")');
    expect(STORE).toContain('.single()');
  });

  it('en settings la identidad va antes de Pay y tras crear hay handoff al catálogo', () => {
    expect(storeShouldLeadSettingsWithIdentity(null)).toBe(true);
    expect(storeShouldLeadSettingsWithIdentity('id')).toBe(false);
    expect(storeAfterCreateCopy().href).toContain('/productos');
    expect(storeAfterCreateCopy().title).toMatch(/catálogo/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithIdentity');
    expect(STORE).toContain('storeAfterCreateCopy');
    expect(STORE).toContain('Crear tienda');
    expect(STORE).toContain('Primero nombre y dirección');
    // Pay no es el primer hijo del tab cuando falta la fila.
    const settingsIdx = STORE.indexOf('tab === "settings"');
    const identityIdx = STORE.indexOf('Primero nombre y dirección', settingsIdx);
    const payIdx = STORE.indexOf('<PaymentConnectionsPanel', settingsIdx);
    expect(identityIdx).toBeGreaterThan(settingsIdx);
    expect(payIdx).toBeGreaterThan(identityIdx);
  });

  it('con tienda y transferencia sin CBU el panel pide banco antes de OAuth', () => {
    expect(storeShouldLeadSettingsWithBank({
      storeId: null,
      offersTransfer: true,
      bankReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithBank({
      storeId: 'id',
      offersTransfer: true,
      bankReady: false,
    })).toBe(true);
    expect(storeShouldLeadSettingsWithBank({
      storeId: 'id',
      offersTransfer: true,
      bankReady: true,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithBank({
      storeId: 'id',
      offersTransfer: false,
      bankReady: false,
    })).toBe(false);
    expect(storeBankLeadCopy().title).toMatch(/CBU|alias/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithBank');
    expect(STORE).toContain('Guardar datos para transferir');
    expect(STORE).toContain('bankPersistedReady');
    expect(STORE).toContain('!leadSettingsWithIdentity && !leadSettingsWithBank');
  });

  it('con retiro activo sin dirección pide el lugar antes de OAuth', () => {
    expect(storeShouldLeadSettingsWithPickup({
      storeId: null,
      pickupEnabled: true,
      addressReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithPickup({
      storeId: 'id',
      pickupEnabled: true,
      addressReady: false,
    })).toBe(true);
    expect(storeShouldLeadSettingsWithPickup({
      storeId: 'id',
      pickupEnabled: true,
      addressReady: true,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithPickup({
      storeId: 'id',
      pickupEnabled: false,
      addressReady: false,
    })).toBe(false);
    expect(storePickupLeadCopy().title).toMatch(/retir/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithPickup');
    expect(STORE).toContain('Guardar dirección de retiro');
    expect(STORE).toContain('!leadSettingsWithIdentity && !leadSettingsWithBank && !leadSettingsWithPickup');
  });

  it('al crear la tienda siembra borradores legales y no reabre Pay bajo identidad', () => {
    expect(storeShouldSeedPagesOnCreate(true)).toBe(true);
    expect(storeShouldSeedPagesOnCreate(false)).toBe(false);
    expect(STORE).toContain('storeShouldSeedPagesOnCreate');
    expect(STORE).toContain('seed_store_pages');
    // El panel de Pay no puede colarse otra vez al pie del lead de identidad.
    const identityLeadFoot = STORE.indexOf('Nerqia Pay puede esperar: primero guardá nombre y slug arriba.');
    expect(identityLeadFoot).toBeGreaterThan(0);
    const afterFoot = STORE.slice(identityLeadFoot, identityLeadFoot + 280);
    expect(afterFoot).not.toContain('<PaymentConnectionsPanel');
  });

  it('después de CBU y retiro, legales van antes de OAuth', () => {
    expect(storeShouldLeadSettingsWithLegal({
      storeId: null,
      legalReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithLegal({
      storeId: 'id',
      legalReady: false,
    })).toBe(true);
    expect(storeShouldLeadSettingsWithLegal({
      storeId: 'id',
      legalReady: true,
    })).toBe(false);
    expect(storeLegalLeadCopy().actionLabel).toMatch(/Páginas/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithLegal');
    expect(STORE).toContain('goToTab("pages")');
    expect(STORE).toContain('!leadSettingsWithIdentity && !leadSettingsWithBank && !leadSettingsWithPickup && !leadSettingsWithLegal');
  });

  it('después de legales, el email de avisos va antes de OAuth', () => {
    expect(storeShouldLeadSettingsWithEmail({
      storeId: null,
      emailReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithEmail({
      storeId: 'id',
      emailReady: false,
    })).toBe(true);
    expect(storeShouldLeadSettingsWithEmail({
      storeId: 'id',
      emailReady: true,
    })).toBe(false);
    expect(storeEmailLeadCopy().title).toMatch(/email|avisos/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithEmail');
    expect(STORE).toContain('Guardar email de avisos');
    expect(STORE).toContain('!leadSettingsWithIdentity && !leadSettingsWithBank && !leadSettingsWithPickup && !leadSettingsWithLegal && !leadSettingsWithEmail && !leadSettingsWithHours');
  });

  it('después del email, el horario de retiro va antes de OAuth', () => {
    expect(storeShouldLeadSettingsWithHours({
      storeId: null,
      pickupEnabled: true,
      addressReady: true,
      hoursReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithHours({
      storeId: 'id',
      pickupEnabled: true,
      addressReady: false,
      hoursReady: false,
    })).toBe(false);
    expect(storeShouldLeadSettingsWithHours({
      storeId: 'id',
      pickupEnabled: true,
      addressReady: true,
      hoursReady: false,
    })).toBe(true);
    expect(storeShouldLeadSettingsWithHours({
      storeId: 'id',
      pickupEnabled: true,
      addressReady: true,
      hoursReady: true,
    })).toBe(false);
    expect(storeHoursLeadCopy().title).toMatch(/cuándo|horario/i);
    expect(STORE).toContain('storeShouldLeadSettingsWithHours');
    expect(STORE).toContain('Guardar horario de retiro');
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

  it('cuenta el embudo server-side sin confundir pedidos con sesiones', () => {
    const snapshot = parseStorePerformanceSnapshot({
      orders_total: 6,
      orders_paid: 2,
      paid_revenue_ars: '2.00',
      attributed_orders: 1,
      sessions_total: 4,
      sessions_with_items: 3,
      checkout_started_sessions: 2,
      converted_sessions: 1,
      recoverable_carts: 1,
      channels: [
        { channel: 'paid', sessions: 2, sessions_with_items: 2, checkout_started_sessions: 2, converted_sessions: 1, orders: 1, orders_paid: 1, paid_revenue_ars: 2 },
        { channel: 'direct', sessions: 2, sessions_with_items: 1, checkout_started_sessions: 0, converted_sessions: 0, orders: 0, orders_paid: 0, paid_revenue_ars: 0 },
      ],
      attribution_started_at: '2026-09-04T00:00:00Z',
      checkout_tracking_started_at: '2026-09-04T03:41:11Z',
      visit_retention_months: 13,
      snapshot_at: '2026-09-04T12:00:00Z',
    });
    expect(snapshot).not.toBeNull();
    const steps = storeFunnelFromPerformance(snapshot!);
    expect(steps.map((s) => s.label)).toEqual([
      'Sesiones medidas', 'Con items en carrito', 'Checkout iniciado', 'Sesiones con compra',
    ]);
    expect(steps.map((s) => s.value)).toEqual([4, 3, 2, 1]);
    expect(steps.map((s) => s.pct)).toEqual([100, 75, 50, 25]);
    expect(storeFunnelCoverageCopy(snapshot!)).toContain('Checkout iniciado se mide desde');
    expect(storeAttributionCoverageCopy(snapshot!)).toContain('5 pedidos anteriores o sin atribución');
    expect(storeChannelCoverageCopy(snapshot!)).toContain('sin IP ni URL completa');
    expect(storeTrafficChannelLabel(snapshot!.channels[0].channel)).toBe('Publicidad paga');
  });

  it('rechaza un contrato parcial en vez de convertirlo en ceros', () => {
    expect(parseStorePerformanceSnapshot({ orders_total: 6 })).toBeNull();
    expect(parseStorePerformanceSnapshot({
      orders_total: 0,
      orders_paid: 0,
      paid_revenue_ars: 0,
      attributed_orders: 0,
      sessions_total: 0,
      sessions_with_items: 0,
      checkout_started_sessions: 0,
      converted_sessions: 0,
      recoverable_carts: -1,
      channels: [],
      attribution_started_at: '2026-09-04T00:00:00Z',
      checkout_tracking_started_at: '2026-09-04T03:41:11Z',
      visit_retention_months: 13,
      snapshot_at: '2026-09-04T12:00:00Z',
    })).toBeNull();
    expect(parseStorePerformanceSnapshot({
      orders_total: 1,
      orders_paid: 2,
      paid_revenue_ars: 10,
      attributed_orders: 0,
      sessions_total: 1,
      sessions_with_items: 1,
      checkout_started_sessions: 0,
      converted_sessions: 0,
      recoverable_carts: 0,
      channels: [{ channel: 'direct', sessions: 1, sessions_with_items: 1, checkout_started_sessions: 0, converted_sessions: 0, orders: 0, orders_paid: 0, paid_revenue_ars: 0 }],
      attribution_started_at: '2026-09-04T00:00:00Z',
      checkout_tracking_started_at: '2026-09-04T03:41:11Z',
      visit_retention_months: 13,
      snapshot_at: '2026-09-04T12:00:00Z',
    })).toBeNull();
  });

  it('valida período y comparación sin inventar crecimiento sobre cero', () => {
    const snapshot = parseStorePerformanceSnapshot({
      orders_total: 3,
      orders_paid: 2,
      paid_revenue_ars: 150,
      attributed_orders: 1,
      sessions_total: 4,
      sessions_with_items: 3,
      checkout_started_sessions: 2,
      converted_sessions: 1,
      recoverable_carts: 1,
      channels: [{ channel: 'social', sessions: 4, sessions_with_items: 3, checkout_started_sessions: 2, converted_sessions: 1, orders: 1, orders_paid: 1, paid_revenue_ars: 150 }],
      period_from: '2026-09-01',
      period_to: '2026-09-04',
      comparison: {
        period_from: '2026-08-28',
        period_to: '2026-08-31',
        orders_total: 2,
        orders_paid: 1,
        paid_revenue_ars: 100,
      },
      attribution_started_at: '2026-09-04T00:00:00Z',
      checkout_tracking_started_at: '2026-09-04T03:41:11Z',
      visit_retention_months: 13,
      snapshot_at: '2026-09-04T12:00:00Z',
    });
    expect(snapshot).not.toBeNull();
    expect(storePerformancePeriodLabel(snapshot!)).toContain('1 de sept de 2026');
    expect(storePerformanceComparisonCopy(snapshot!.comparison)).toContain('28 de ago de 2026');
    expect(storePerformanceTrend(150, 100)).toEqual({ value: 50, label: 'vs período anterior' });
    expect(storePerformanceTrend(150, 0)).toBeNull();
  });

  it('Commerce usa el embudo medido y no un 37%', () => {
    expect(STORE).toContain('get_store_performance_snapshot');
    expect(STORE).toContain('storeFunnelFromPerformance');
    expect(STORE).toContain('Facturación paga');
    expect(STORE).toContain('Conversión medible');
    expect(STORE).toContain('storeShouldShowPerformanceChrome');
    expect(STORE).toContain('storeShouldLeadWithPay');
    expect(STORE).toContain('StoreReadinessPanel');
    expect(STORE).not.toMatch(/\*\s*0\.37/);
    expect(STORE).toContain('storeFunnelCoverageCopy');
    expect(CHECKOUT).toContain('startStoreCheckout');
    expect(PUBLIC_DATA).toContain("'start_store_checkout'");
    expect(PUBLIC_DATA).toContain("'record_store_visit'");
    expect(STORE).toContain('Canales de adquisición');
  });

  it('el snapshot protege tenant, cobro, atribución y recuperación', () => {
    expect(PERFORMANCE_SQL).toContain('public.is_org_member(p_org_id, v_actor)');
    expect(PERFORMANCE_SQL).toContain('REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid) FROM anon');
    expect(PERFORMANCE_SQL).toContain("payment_status = 'paid'");
    expect(PERFORMANCE_SQL).toContain('linked.cart_session_id = cs.id');
    expect(PERFORMANCE_SQL).toContain("'2026-09-03 00:00:00+00'");
    expect(PERFORMANCE_SQL).toContain('cs.expires_at > now()');
    expect(PERFORMANCE_SQL).toContain('checkout_started_sessions');
    expect(PERFORMANCE_SQL).toContain('public.save_store_cart_v2(p_slug, p_token, p_items, p_email)');
    expect(PERFORMANCE_SQL).toContain('COALESCE(checkout_started_at, now())');
    expect(PERFORMANCE_SQL).toContain('GRANT EXECUTE ON FUNCTION public.start_store_checkout');
    expect(STORE).not.toContain('value: String(orders.length');
  });

  it('el período usa límites argentinos, comparación equivalente y URL compartible', () => {
    expect(PERFORMANCE_PERIOD_SQL).toContain("'America/Argentina/Buenos_Aires'");
    expect(PERFORMANCE_PERIOD_SQL).toContain('v_previous_from_date := v_from_date - v_days');
    expect(PERFORMANCE_PERIOD_SQL).toContain("'comparison', CASE WHEN v_filtered");
    expect(PERFORMANCE_PERIOD_SQL).toContain('created_at >= v_period_start AND created_at < v_period_end');
    expect(PERFORMANCE_PERIOD_SQL).toContain('REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid, date, date) FROM anon');
    expect(STORE).toContain('useDateRangeFilter');
    expect(STORE).toContain('p_from: performanceFromParam');
    expect(STORE).toContain('performanceRequestRef');
    expect(STORE).toContain('storePerformanceTrend');
    expect(DATE_RANGE).toContain('min-h-11');
    expect(DATE_RANGE).toContain('aria-label="Limpiar filtro de fechas"');
    expect(DATE_RANGE).toContain('subDays(new Date(), 29)');
  });

  it('la atribución separa visita de carrito, minimiza datos y protege tenant', () => {
    expect(CHANNEL_ATTRIBUTION_SQL).toContain('CREATE TABLE IF NOT EXISTS public.ecommerce_store_visits');
    expect(CHANNEL_ATTRIBUTION_SQL).toContain('visit_token_hash');
    expect(CHANNEL_ATTRIBUTION_SQL).toContain("extensions.digest(convert_to(p_visit_token, 'UTF8'), 'sha256'::text)");
    expect(CHANNEL_ATTRIBUTION_SQL).toContain("'visit_retention_months', 13");
    expect(CHANNEL_ATTRIBUTION_SQL).toContain('public.store_traffic_channel');
    expect(CHANNEL_ATTRIBUTION_SQL).toContain('REVOKE ALL ON TABLE public.ecommerce_store_visits FROM anon, authenticated');
    expect(CHANNEL_ATTRIBUTION_SQL).toContain('public.is_org_member(p_org_id, v_actor)');
    expect(CHANNEL_ATTRIBUTION_SQL).not.toContain('user_agent text');
    expect(CHANNEL_ATTRIBUTION_SQL).not.toContain('ip_address text');
  });

  it('no mide antes de que el comercio informe y acepte la política', () => {
    const generated = politicaDePrivacidad({
      razonSocial: 'Comercio Ejemplo SA',
      cuit: '30712345678',
      domicilio: 'Calle 123',
      emailContacto: 'legal@example.com',
      nombreTienda: 'Ejemplo',
      usaPixeles: false,
    });
    expect(storeAnalyticsDisclosureReady([{
      slug: 'politica-de-privacidad',
      content: generated,
      status: 'published',
    }])).toBe(true);
    expect(storeAnalyticsDisclosureReady([{
      slug: 'politica-de-privacidad',
      content: generated,
      status: 'draft',
    }])).toBe(false);
    expect(ANALYTICS_DISCLOSURE_SQL).toContain("'privacy_disclosure_required'");
    expect(ANALYTICS_DISCLOSURE_SQL).toContain('public.store_analytics_disclosure_ready');
    expect(ANALYTICS_DISCLOSURE_SQL).toContain("v_role NOT IN ('owner', 'admin')");
    expect(ANALYTICS_DISCLOSURE_SQL).toContain("'store.analytics.enable'");
    expect(STORE).toContain('La medición de visitas está pausada');
    expect(STORE).toContain('Confirmo y activar');
  });
});

describe('el enlace de la tienda se puede copiar', () => {
  it('arma /tienda/:slug y no inventa un dominio', () => {
    expect(urlPublicaDeTienda('https://exentryimports.vercel.app', 'exentryimports'))
      .toBe('https://exentryimports.vercel.app/tienda/exentryimports');
    expect(urlPublicaDeTienda('https://exentryimports.vercel.app/', '  ')).toBeNull();
    expect(urlPublicaDeTienda('', 'exentryimports')).toBeNull();
  });

  it('usa slug.nerqia.app cuando la tienda se comparte desde producción', () => {
    expect(urlPublicaDeTienda('https://nerqia.app', 'mi-tienda'))
      .toBe('https://mi-tienda.nerqia.app');
    expect(urlPublicaDeTienda('https://app.nerqia.app', 'mi-tienda'))
      .toBe('https://mi-tienda.nerqia.app');
  });

  it('si la tienda está activa se comparte /tienda/:slug, no el catálogo WhatsApp', () => {
    expect(enlaceCanonicoDeVitrina({
      origin: 'https://app.example',
      userId: 'user-1',
      storeSlug: 'mi-tienda',
      storeActive: true,
    })).toEqual({ href: 'https://app.example/tienda/mi-tienda', kind: 'tienda' });
    expect(enlaceCanonicoDeVitrina({
      origin: 'https://app.example',
      userId: 'user-1',
      storeSlug: 'mi-tienda',
      storeActive: false,
    })).toEqual({ href: 'https://app.example/catalogo/user-1', kind: 'catalogo' });
    expect(enlaceCanonicoDeVitrina({
      origin: 'https://app.example',
      userId: 'user-1',
    })).toEqual({ href: 'https://app.example/catalogo/user-1', kind: 'catalogo' });
  });

  it('Commerce copia el mismo link que abre Ver tienda', () => {
    expect(STORE).toContain('urlPublicaDeTienda');
    expect(STORE).toContain('Copiar enlace');
  });

  it('Foco «Compartí el enlace» aterriza en overview con share accionable', () => {
    expect(storeFirstSaleSharePath(true)).toBe('/tienda-online?tab=overview&share=1');
    expect(storeFirstSaleSharePath(false)).toBe('/tienda-online');
    expect(storeShareIntentActive('1')).toBe(true);
    expect(storeShareIntentActive(null)).toBe(false);
    expect(storeShareIntentCopy().actionLabel).toBe('Copiar enlace');
    expect(STORE).toContain('storeShareIntentActive');
    expect(ORDERS_PAGE).toContain('publicStoreUrl={urlPublica}');
  });

  it('Pedidos vacíos ofrecen copiar el link cuando hay URL pública', () => {
    expect(storeOrdersEmptyShareCopy(true).actionLabel).toBe('Copiar enlace de la tienda');
    expect(storeOrdersEmptyShareCopy(false).actionLabel).toBeUndefined();
  });

  it('el link de influencer usa la tienda publicada + ?ref=', () => {
    expect(enlaceInfluencerConRef({
      origin: 'https://app.example',
      userId: 'user-1',
      storeSlug: 'mi-tienda',
      storeActive: true,
      referralCode: 'ana10',
    })).toBe('https://app.example/tienda/mi-tienda?ref=ANA10');
    expect(enlaceInfluencerConRef({
      origin: 'https://app.example',
      userId: 'user-1',
      storeActive: false,
      referralCode: 'ANA10',
    })).toBe('https://app.example/catalogo/user-1?ref=ANA10');
  });
});
