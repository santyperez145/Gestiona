import { describe, expect, it } from 'vitest';
import {
  activationGoalLabel,
  evaluateActivationReadiness,
  normalizeActivationGoal,
  type ActivationReadinessSignals,
} from '@/lib/activationReadiness';

function ready(overrides: Partial<ActivationReadinessSignals> = {}): ActivationReadinessSignals {
  return {
    onboarding_goal: 'pos',
    identity_ready: true,
    catalog_products_count: 3,
    sellable_stock_products_count: 2,
    catalog_ready: true,
    stock_ready: true,
    online_channel_ready: true,
    legal_ready: true,
    mercadopago_ready: true,
    online_payment_ready: true,
    online_shipping_ready: true,
    fiscal_status: 'listo',
    fiscal_ready: true,
    pos_sales_total: 1,
    online_orders_total: 1,
    ...overrides,
  };
}

describe('evaluateActivationReadiness', () => {
  it('cierra la ruta POS sin exigir pasarela ni logística online', () => {
    const result = evaluateActivationReadiness(ready({
      onboarding_goal: 'pos',
      online_channel_ready: false,
      online_payment_ready: false,
      online_shipping_ready: false,
      legal_ready: false,
    }));

    expect(result.complete).toBe(true);
    expect(result.doneCount).toBe(8);
    expect(result.milestones.find(item => item.id === 'payment')?.done).toBe(true);
    expect(result.milestones.find(item => item.id === 'shipping')?.done).toBe(true);
  });

  it('no llama lista a una tienda sin legales, cobro o entrega', () => {
    const result = evaluateActivationReadiness(ready({
      onboarding_goal: 'online',
      legal_ready: false,
      online_payment_ready: false,
      online_shipping_ready: false,
      online_orders_total: 0,
    }));

    expect(result.complete).toBe(false);
    expect(result.milestones.filter(item => !item.done).map(item => item.id)).toEqual([
      'identity', 'payment', 'shipping', 'sale',
    ]);
  });

  it('distingue cargar producto de tener stock vendible', () => {
    const result = evaluateActivationReadiness(ready({
      catalog_products_count: 4,
      catalog_ready: true,
      sellable_stock_products_count: 0,
      stock_ready: false,
    }));

    expect(result.milestones.find(item => item.id === 'catalog')?.done).toBe(true);
    expect(result.milestones.find(item => item.id === 'stock')?.done).toBe(false);
    expect(result.next?.id).toBe('stock');
  });

  it('un catálogo vacío manda al formulario, no a un listado genérico', () => {
    const pos = evaluateActivationReadiness(ready({
      catalog_products_count: 0,
      catalog_ready: false,
      sellable_stock_products_count: 0,
      stock_ready: false,
    }));
    const online = evaluateActivationReadiness(ready({
      onboarding_goal: 'online',
      catalog_products_count: 0,
      catalog_ready: false,
      sellable_stock_products_count: 0,
      stock_ready: false,
    }));

    expect(pos.milestones.find(item => item.id === 'catalog')?.href)
      .toBe('/productos?onboarding=1&goal=pos');
    expect(online.milestones.find(item => item.id === 'catalog')?.href)
      .toBe('/productos?onboarding=1&goal=online');
  });

  it('exige elegir canal cuando el comercio sólo está explorando', () => {
    const result = evaluateActivationReadiness(ready({ onboarding_goal: 'explore' }));

    expect(result.needsGoalChoice).toBe(true);
    expect(result.effectiveGoal).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.milestones.find(item => item.id === 'channel')?.done).toBe(false);
  });

  it.each([
    ['falta_datos_fiscales', 'CUIT'],
    ['falta_certificado_propio', 'certificado'],
    ['falta_plataforma', 'plataforma'],
    ['falta_delegar', 'delegar'],
    ['falta_verificar_ciclo', 'CAE'],
  ])('explica el bloqueo fiscal %s y nunca lo marca listo', (status, expectedText) => {
    const result = evaluateActivationReadiness(ready({ fiscal_status: status, fiscal_ready: false }));
    const fiscal = result.milestones.find(item => item.id === 'fiscal');

    expect(fiscal?.done).toBe(false);
    expect(fiscal?.detail).toContain(expectedText);
  });

  it('atribuye la primera venta al canal elegido', () => {
    const online = evaluateActivationReadiness(ready({
      onboarding_goal: 'online', online_orders_total: 0, pos_sales_total: 9,
    }));
    const pos = evaluateActivationReadiness(ready({
      onboarding_goal: 'pos', online_orders_total: 9, pos_sales_total: 0,
    }));

    expect(online.milestones.find(item => item.id === 'sale')?.done).toBe(false);
    expect(pos.milestones.find(item => item.id === 'sale')?.done).toBe(false);
  });

  it('un comercio que no eligió canal no está en POS por default', () => {
    const result = evaluateActivationReadiness(ready({ onboarding_goal: null }));

    expect(result.needsGoalChoice).toBe(true);
    expect(result.effectiveGoal).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.milestones.find(item => item.id === 'channel')?.done).toBe(false);
  });

  it('normaliza valores desconocidos a explorar, no a POS', () => {
    expect(normalizeActivationGoal('online')).toBe('online');
    expect(normalizeActivationGoal('pos')).toBe('pos');
    expect(normalizeActivationGoal('explore')).toBe('explore');
    expect(normalizeActivationGoal('invalido')).toBe('explore');
    expect(normalizeActivationGoal(null)).toBe('explore');
    expect(activationGoalLabel('pos')).toBe('POS / mostrador');
    expect(activationGoalLabel('explore')).toBe('Sin canal elegido');
  });
});
