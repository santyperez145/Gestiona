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
      shipping_cost: 2500,
    },
    publishedProducts: 12,
    productsWithoutWeight: 0,
    shippingZones: 6,
    zonesWithRates: 6,
    coveredProvinces: 24,
    paymentConnected: true,
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
  });

  it('con transferencia alcanza aunque MercadoPago no esté conectado', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, payment_methods: ['mercadopago', 'transferencia'] },
      paymentConnected: false,
    }));
    expect(idsDe(r.blockers)).not.toContain('payments');
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

  it('con retiro en tienda, la falta de tarifas molesta pero no bloquea', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, pickup_enabled: true },
      zonesWithRates: 0,
    }));
    expect(idsDe(r.blockers)).not.toContain('shipping-rates');
    expect(idsDe(r.warnings)).toContain('shipping-rates');
    expect(r.canPublish).toBe(true);
  });

  it('sin dirección propia no hay link que compartir', () => {
    const r = evaluateStoreReadiness(tiendaLista({
      store: { ...tiendaLista().store!, slug: null },
    }));
    expect(idsDe(r.blockers)).toContain('slug');
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
    });
    expect(idsDe(r.blockers)).toEqual(
      expect.arrayContaining(['products', 'payments', 'slug']));
    expect(r.canPublish).toBe(false);
  });
});

describe('evaluateStoreReadiness — avisos', () => {
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
