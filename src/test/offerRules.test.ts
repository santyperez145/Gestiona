import { describe, expect, it } from 'vitest';
import { proposeOffersFromRules } from '@/lib/offerRules';

describe('proposeOffersFromRules', () => {
  it('prioriza sobrestock dormido como liquidación', () => {
    const offers = proposeOffersFromRules([
      {
        id: 'a', name: 'AA Dormido', stock: 20, sale_price_ars: 10000,
        profit_per_unit_ars: 5000, units_sold_90d: 0, days_since_last_sale: 60,
      },
      {
        id: 'b', name: 'BB Activo', stock: 3, sale_price_ars: 8000,
        profit_per_unit_ars: 4000, units_sold_90d: 12, days_since_last_sale: 2,
      },
    ]);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].product_id).toBe('a');
    expect(offers[0].tipo).toBe('liquidacion');
    expect(offers[0].source).toBe('rules');
    expect(offers[0].descuento_sugerido_percent).toBeLessThanOrEqual(35);
    expect(offers[0].precio_sugerido_ars).toBeLessThan(10000);
  });

  it('omite productos sin stock o ya en oferta', () => {
    const offers = proposeOffersFromRules([
      { id: 'x', name: 'Agotado', stock: 0, sale_price_ars: 1000, profit_per_unit_ars: 400 },
      {
        id: 'y', name: 'En oferta', stock: 5, sale_price_ars: 1000,
        discount_price_ars: 800, profit_per_unit_ars: 400, days_since_last_sale: 40,
      },
    ]);
    expect(offers).toEqual([]);
  });

  it('no propone descuento que rompa el piso de margen medible', () => {
    const offers = proposeOffersFromRules(
      [{
        id: 'm', name: 'Margen fino', stock: 15, sale_price_ars: 1000,
        profit_per_unit_ars: 320, units_sold_90d: 0, days_since_last_sale: 45,
      }],
      { margin_alert_percent: 30, max_ai_discount_percent: 35 },
    );
    for (const o of offers) {
      expect(o.margen_resultante_percent).toBeGreaterThanOrEqual(30);
    }
  });
});
