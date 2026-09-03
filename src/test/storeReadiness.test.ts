import { describe, it, expect } from 'vitest';
import {
  evaluateStoreReadiness, readinessSummary,
  type StoreReadinessInput,
} from '@/lib/storeReadiness';

/** Tienda que puede vender: la base sobre la que se rompe una cosa por test. */
function tiendaLista(over: Partial<StoreReadinessInput> = {}): StoreReadinessInput {
  return {
    store: {
      is_active: true,
      slug: 'mi-tienda',
      name: 'Mi Tienda',
      logo_url: 'https://x/logo.png',
      description: 'Perfumes importados',
      meta_title: 'Mi Tienda',
      payment_methods: ['mercadopago', 'transferencia'],
      shipping_mode: 'zones',
      pickup_enabled: false,
      pickup_address: null,
      shipping_cost: 2500,
      notification_email: 'ventas@ejemplo.com',
    },
    publishedProducts: 12,
    productsWithoutWeight: 0,
    shippingZones: 6,
    zonesWithRates: 6,
    coveredProvinces: 24,
    paymentConnected: true,
    bankTransferReady: true,
    legalPages: { missingOrTemplate: 0, drafts: 0 },
    ...over,
  };
}

const idsDe = (cs: { id: string }[]) => cs.map(c => c.id);

describe('evaluateStoreReadiness — puede publicar', () => {
  it('una tienda completa no tiene bloqueantes', () => {
    const r = evaluateStoreReadiness(tiendaLista());
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.canPublish).toBe(true);
    expect(r.score).toBe(100);
  });
});

describe('evaluateStoreReadiness — bloqueantes', () => {
  it('sin productos no se puede vender', () => {
    const r = evaluateStoreReadiness(tiendaLista({ publishedProducts: 0 }));
    expect(idsDe(r.blockers)).toContain('products');
    expect(r.canPublish).toBe(false);
    expect(r.blockers.find(c => c.id === 'products')?.actionHref)
      .toBe('/productos?onboarding=1&goal=online');
  });

  it('sin ningún medio de pago no se puede cobrar', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: [] },
    }));
    expect(idsDe(r.blockers)).toContain('payments');
  });

  it('MercadoPago habilitado pero sin conectar, y sin otro medio, bloquea', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['mercadopago'] },
      paymentConnected: false,
    }));
    expect(idsDe(r.blockers)).toContain('payments');
    const payments = r.blockers.find(c => c.id === 'payments');
    expect(payments?.actionHref).toBe('/tienda-online?tab=settings');
    expect(payments?.actionLabel).toBe('Activar Gestiona Pay');
  });

  it('los avisos de Pay y slug abren la pestaña correcta, no el overview', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['mercadopago', 'transferencia'] },
      paymentConnected: false,
    }));
    expect(r.checks.find(c => c.id === 'pay-rail')?.actionHref)
      .toBe('/tienda-online?tab=settings');
    expect(r.checks.find(c => c.id === 'slug')?.actionHref)
      .toBe('/tienda-online?tab=settings');
    expect(r.checks.find(c => c.id === 'branding')?.actionHref)
      .toBe('/tienda-online?tab=design');
  });

  it('con transferencia alcanza aunque MercadoPago no esté conectado', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['mercadopago', 'transferencia'] },
      paymentConnected: false,
      bankTransferReady: true,
    }));
    expect(idsDe(r.blockers)).not.toContain('payments');
    expect(idsDe(r.warnings)).toContain('pay-rail');
    expect(r.canPublish).toBe(true);
  });

  it('transferencia sin CBU ni alias no publica', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['transferencia'] },
      paymentConnected: false,
      bankTransferReady: false,
      bank_cbu: null,
      bank_alias: null,
    }));
    expect(idsDe(r.blockers)).toContain('bank-transfer');
    expect(r.canPublish).toBe(false);
    expect(r.blockers.find(c => c.id === 'bank-transfer')?.actionHref)
      .toBe('/tienda-online?tab=settings');
  });

  it('sólo efectivo no exige datos bancarios', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['efectivo'] },
      paymentConnected: false,
      bankTransferReady: false,
    }));
    expect(idsDe(r.blockers)).not.toContain('bank-transfer');
    expect(r.canPublish).toBe(true);
  });

  it('sin Gestiona Pay no exige el rail OAuth', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['efectivo'] },
      paymentConnected: false,
    }));
    expect(idsDe(r.warnings)).not.toContain('pay-rail');
    expect(r.checks.find(c => c.id === 'pay-rail')?.done).toBe(true);
  });

  it('efectivo también alcanza para cobrar', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['efectivo'] },
      paymentConnected: false,
    }));
    expect(idsDe(r.blockers)).not.toContain('payments');
  });

  it('modo zonas sin tarifas cargadas bloquea', () => {
    const r = evaluateStoreReadiness(tiendaLista({ zonesWithRates: 0 }));
    expect(idsDe(r.blockers)).toContain('shipping-rates');
    expect(r.canPublish).toBe(false);
  });

  // El caso real que se escapó: la tienda decía "Activa" mientras 22 de 23
  // provincias no podían terminar la compra, porque alcanzaba con que UNA zona
  // tuviera tarifa. Un comprador de Santa Fe recibía "No hay envío disponible
  // para esa provincia" en el checkout.
  it('tarifas en una sola zona no es estar listo: falta casi todo el país', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      shippingZones: 6,
      zonesWithRates: 1,
      coveredProvinces: 1,
    }));
    expect(idsDe(r.blockers)).toContain('coverage');
    expect(r.canPublish).toBe(false);
  });

  it('con retiro en local, la falta de cobertura molesta pero no bloquea', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, pickup_enabled: true, pickup_address: 'Alsina 123', pickup_instructions: 'Lun a vie 10-18' },
      shippingZones: 6,
      zonesWithRates: 1,
      coveredProvinces: 1,
    }));
    expect(idsDe(r.blockers)).not.toContain('coverage');
    expect(idsDe(r.warnings)).toContain('coverage');
  });

  it('faltar unas pocas provincias sigue siendo aviso, no bloqueo', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      shippingZones: 6,
      zonesWithRates: 5,
      coveredProvinces: 20,
    }));
    expect(idsDe(r.blockers)).not.toContain('coverage');
    expect(idsDe(r.warnings)).toContain('coverage');
  });

  it('con retiro en tienda, la falta de tarifas molesta pero no bloquea', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, pickup_enabled: true, pickup_address: 'Alsina 123', pickup_instructions: 'Lun a vie 10-18' },
      zonesWithRates: 0,
    }));
    expect(idsDe(r.blockers)).not.toContain('shipping-rates');
    expect(idsDe(r.warnings)).toContain('shipping-rates');
    expect(r.canPublish).toBe(true);
  });

  it('retiro sin dirección no se presenta como listo', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, pickup_enabled: true, pickup_address: null },
    }));
    expect(idsDe(r.blockers)).toContain('pickup-address');
    expect(idsDe(r.warnings)).not.toContain('pickup-hours');
    expect(r.canPublish).toBe(false);
    expect(r.blockers.find(c => c.id === 'pickup-address')?.actionHref)
      .toBe('/tienda-online?tab=settings');
  });

  it('retiro con dirección y sin horario molesta, no bloquea, y no inventa texto', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: {
        ...tiendaLista().store!,
        pickup_enabled: true,
        pickup_address: 'Alsina 123',
        pickup_instructions: null,
      },
    }));
    expect(idsDe(r.blockers)).not.toContain('pickup-hours');
    expect(idsDe(r.warnings)).toContain('pickup-hours');
    expect(r.canPublish).toBe(true);
    expect(r.warnings.find(c => c.id === 'pickup-hours')?.actionHref)
      .toBe('/tienda-online?tab=settings');
  });

  it('sin dirección propia no hay link que compartir', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, slug: null },
    }));
    expect(idsDe(r.blockers)).toContain('slug');
  });

  it('sin términos o privacidad publicados no presenta la tienda como lista', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      legalPages: { missingOrTemplate: 1, drafts: 0 },
    }));
    const check = r.blockers.find(x => x.id === 'legal-pages');
    expect(check?.detail).toContain('plantilla');
    expect(r.canPublish).toBe(false);
  });

  it('un borrador legal no alcanza: el comprador tiene que poder verlo', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      legalPages: { missingOrTemplate: 0, drafts: 2 },
    }));
    expect(idsDe(r.blockers)).toContain('legal-pages');
    expect(r.blockers.find(x => x.id === 'legal-pages')?.detail).toContain('borrador');
    expect(r.blockers.find(x => x.id === 'legal-pages')?.actionLabel).toBe('Revisar y publicar');
  });

  it('sin tienda configurada, todos los bloqueantes están presentes', () => {
    const r = evaluateStoreReadiness({
      store: null,
      publishedProducts: 0,
      productsWithoutWeight: 0,
      shippingZones: 0,
      zonesWithRates: 0,
      coveredProvinces: 0,
      paymentConnected: false,
      legalPages: { missingOrTemplate: 2, drafts: 0 },
    });
    expect(idsDe(r.blockers)).toEqual(
      expect.arrayContaining(['products', 'payments', 'slug', 'legal-pages']));
    expect(r.canPublish).toBe(false);
  });
});

describe('evaluateStoreReadiness — avisos', () => {
  it('avisa si falta el email de avisos de la tienda', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, notification_email: null },
    }));
    expect(idsDe(r.warnings)).toContain('notification-email');
    expect(r.canPublish).toBe(true);
    expect(r.warnings.find(c => c.id === 'notification-email')?.actionHref)
      .toBe('/tienda-online?tab=settings');
  });

  it('avisa las provincias sin cobertura', () => {
    const r = evaluateStoreReadiness(tiendaLista({ coveredProvinces: 18 }));
    const c = r.warnings.find(x => x.id === 'coverage')!;
    expect(c.detail).toContain('6 provincias');
  });

  it('no avisa cobertura si no hay tarifas: ya es un problema más grave', () => {
    const r = evaluateStoreReadiness(tiendaLista({ zonesWithRates: 0, coveredProvinces: 10 }));
    expect(idsDe(r.warnings)).not.toContain('coverage');
  });

  it('avisa los productos sin peso, que hacen cotizar con estimado', () => {
    const r = evaluateStoreReadiness(tiendaLista({ productsWithoutWeight: 3 }));
    const c = r.warnings.find(x => x.id === 'weights')!;
    expect(c.detail).toContain('3 productos');
    expect(c.actionLabel).toBe('Completar pesos');
    expect(c.actionHref).toBe('/productos?completar=pesos');
  });

  it('el CTA de tarifas manda a Completar tarifario', () => {
    const r = evaluateStoreReadiness(tiendaLista({ zonesWithRates: 0 }));
    expect(r.blockers.find(c => c.id === 'shipping-rates')?.actionLabel)
      .toBe('Completar tarifario');
  });

  it('sin zonas el CTA no promete Completar tarifario', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      shippingZones: 0, zonesWithRates: 0, coveredProvinces: 0,
    }));
    expect(r.blockers.find(c => c.id === 'shipping-rates')?.actionLabel)
      .toBe('Crear zonas');
  });

  it('con retiro, la cobertura no promete envío nacional', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, pickup_enabled: true, pickup_address: 'Alsina 123', pickup_instructions: 'Lun a vie 10-18' },
      coveredProvinces: 1,
      zonesWithRates: 1,
    }));
    const c = r.warnings.find(x => x.id === 'coverage')!;
    expect(c.detail).toMatch(/retiro/i);
    expect(c.actionLabel).toBe('Completar tarifario');
  });

  it('el peso no importa cuando la tienda cobra un precio plano', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, shipping_mode: 'flat' },
      productsWithoutWeight: 9,
    }));
    expect(idsDe(r.warnings)).not.toContain('weights');
  });

  it('un envío plano en $0 sugiere usar el modo gratis, sin bloquear', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, shipping_mode: 'flat', shipping_cost: 0 },
    }));
    expect(r.canPublish).toBe(true);
    const c = r.checks.find(x => x.id === 'shipping-flat')!;
    expect(c.severity).toBe('suggestion');
    expect(c.done).toBe(false);
  });

  it('las sugerencias de presentación nunca bloquean', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: {
        ...tiendaLista().store!,
        logo_url: null, description: null, meta_title: null,
      },
    }));
    expect(r.canPublish).toBe(true);
    expect(r.score).toBeLessThan(100);
  });
});

describe('readinessSummary', () => {
  it('prioriza los bloqueantes sobre los avisos', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      publishedProducts: 0, coveredProvinces: 20,
    }));
    expect(readinessSummary(r)).toBe('Falta 1 cosa para poder vender');
  });

  it('pluraliza', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      publishedProducts: 0,
      store: { ...tiendaLista().store!, slug: null },
    }));
    expect(readinessSummary(r)).toBe('Faltan 2 cosas para poder vender');
  });

  it('sin bloqueantes informa los detalles pendientes', () => {
    const r = evaluateStoreReadiness(tiendaLista({ coveredProvinces: 23 }));
    expect(readinessSummary(r)).toBe('Lista para vender, con 1 detalle pendiente');
  });

  it('todo listo', () => {
    expect(readinessSummary(evaluateStoreReadiness(tiendaLista()))).toBe('Lista para vender');
  });
});
