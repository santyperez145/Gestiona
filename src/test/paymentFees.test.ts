import { describe, it, expect } from 'vitest';
import {
  resolveProviderFee, resolvePlatformRule, resolveLivePlatformRule, platformFeeFor,
  computeSettlement, grossUpForNet, installmentPricing, normalizarAppliesTo,
  type ProviderFee, type CommissionRule,
} from '@/lib/paymentFees';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SCHEDULE: ProviderFee[] = [
  { provider: 'mercadopago', method: 'default', installments: 0, percent_fee: 6.29, fixed_fee: 0, iva_on_fee_pct: 21, release_days: 0, effective_from: '2026-01-01' },
  { provider: 'mercadopago', method: 'credit',  installments: 0, percent_fee: 6.29, fixed_fee: 0, iva_on_fee_pct: 21, effective_from: '2026-01-01' },
  { provider: 'mercadopago', method: 'credit',  installments: 6, percent_fee: 12.9, fixed_fee: 0, iva_on_fee_pct: 21, effective_from: '2026-01-01' },
  { provider: 'mercadopago', method: 'debit',   installments: 0, percent_fee: 3.49, fixed_fee: 0, iva_on_fee_pct: 21, effective_from: '2026-01-01' },
  { provider: 'efectivo',    method: 'cash',    installments: 0, percent_fee: 0,    fixed_fee: 0, iva_on_fee_pct: 0, effective_from: '2026-01-01' },
];

const NO_IVA: ProviderFee = {
  provider: 'mercadopago', method: 'default', installments: 0,
  percent_fee: 10, fixed_fee: 0, iva_on_fee_pct: 0,
};

// ── Arancel del procesador ──────────────────────────────────────────────────

describe('resolveProviderFee', () => {
  it('encuentra el match exacto de medio y cuotas', () => {
    const f = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit', installments: 6 });
    expect(f?.percent_fee).toBe(12.9);
  });

  it('cae al contado del mismo medio si no hay tramo para esas cuotas', () => {
    const f = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit', installments: 9 });
    expect(f?.percent_fee).toBe(6.29);
  });

  it('cae a default si el medio no está cargado', () => {
    const f = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'wallet' });
    expect(f?.method).toBe('default');
  });

  it('devuelve null para un proveedor desconocido', () => {
    expect(resolveProviderFee(SCHEDULE, { provider: 'paypal' })).toBeNull();
  });

  it('no aplica un arancel con fecha futura', () => {
    const withFuture: ProviderFee[] = [
      ...SCHEDULE,
      { provider: 'mercadopago', method: 'debit', installments: 0, percent_fee: 4.5, fixed_fee: 0, effective_from: '2026-12-01' },
    ];
    const f = resolveProviderFee(withFuture, {
      provider: 'mercadopago', method: 'debit', asOf: new Date('2026-07-29'),
    });
    expect(f?.percent_fee).toBe(3.49);
  });

  it('cuando ya entró en vigencia, usa el más reciente', () => {
    const withFuture: ProviderFee[] = [
      ...SCHEDULE,
      { provider: 'mercadopago', method: 'debit', installments: 0, percent_fee: 4.5, fixed_fee: 0, effective_from: '2026-06-01' },
    ];
    const f = resolveProviderFee(withFuture, {
      provider: 'mercadopago', method: 'debit', asOf: new Date('2026-07-29'),
    });
    expect(f?.percent_fee).toBe(4.5);
  });

  it('no mezcla monedas', () => {
    const usd: ProviderFee[] = [
      { provider: 'stripe', method: 'default', installments: 0, percent_fee: 2.9, fixed_fee: 0.3, currency: 'USD' },
    ];
    expect(resolveProviderFee(usd, { provider: 'stripe', currency: 'ARS' })).toBeNull();
    expect(resolveProviderFee(usd, { provider: 'stripe', currency: 'USD' })?.percent_fee).toBe(2.9);
  });
});

// ── Regla de comisión ───────────────────────────────────────────────────────

describe('resolvePlatformRule', () => {
  const rules: CommissionRule[] = [
    { id: 'default', plan_id: null, org_id: null, percent: 1, fixed: 0, applies_to: 'online' },
    { id: 'plan-pro', plan_id: 'pro', org_id: null, percent: 0.5, fixed: 0, applies_to: 'online' },
    { id: 'deal', plan_id: null, org_id: 'org-1', percent: 0, fixed: 0, applies_to: 'online' },
    { id: 'inactive', plan_id: null, org_id: 'org-2', percent: 99, fixed: 0, applies_to: 'online', is_active: false },
  ];

  it('sin plan ni acuerdo usa la regla base', () => {
    expect(resolvePlatformRule(rules, { channel: 'online' })?.id).toBe('default');
  });

  it('el plan pisa la regla base', () => {
    expect(resolvePlatformRule(rules, { planId: 'pro', channel: 'online' })?.id).toBe('plan-pro');
  });

  it('el acuerdo por org pisa el plan', () => {
    expect(resolvePlatformRule(rules, { orgId: 'org-1', planId: 'pro', channel: 'online' })?.id).toBe('deal');
  });

  it('ignora reglas desactivadas', () => {
    expect(resolvePlatformRule(rules, { orgId: 'org-2', channel: 'online' })?.id).toBe('default');
  });

  it('no aplica una regla de otro canal', () => {
    expect(resolvePlatformRule(rules, { channel: 'pos' })).toBeNull();
  });

  it("'all' sirve para cualquier canal", () => {
    const withAll: CommissionRule[] = [{ plan_id: null, org_id: null, percent: 2, fixed: 0, applies_to: 'all' }];
    expect(resolvePlatformRule(withAll, { channel: 'pos' })?.percent).toBe(2);
  });

  it('la regla del canal exacto le gana a la genérica', () => {
    const mixed: CommissionRule[] = [
      { id: 'all', plan_id: null, org_id: null, percent: 2, fixed: 0, applies_to: 'all' },
      { id: 'online', plan_id: null, org_id: null, percent: 1, fixed: 0, applies_to: 'online' },
    ];
    expect(resolvePlatformRule(mixed, { channel: 'online' })?.id).toBe('online');
  });
});

describe('resolveLivePlatformRule', () => {
  const asOf = new Date('2026-09-01T12:00:00Z');

  it('no cobra un draft aunque esté is_active', () => {
    const rules: CommissionRule[] = [{
      percent: 5, fixed: 0, applies_to: 'online', is_active: true,
      approval_status: 'draft', effective_from: '2026-01-01',
    }];
    expect(resolveLivePlatformRule(rules, { channel: 'online' }, asOf)).toBeNull();
  });

  it('no cobra una aprobada sin vigencia', () => {
    const rules: CommissionRule[] = [{
      percent: 5, fixed: 0, applies_to: 'online', is_active: true,
      approval_status: 'approved',
    }];
    expect(resolveLivePlatformRule(rules, { channel: 'online' }, asOf)).toBeNull();
  });

  it('usa la aprobada vigente', () => {
    const rules: CommissionRule[] = [{
      id: 'viva', percent: 0.5, fixed: 0, applies_to: 'online', is_active: true,
      approval_status: 'approved', effective_from: '2026-08-26',
    }];
    expect(resolveLivePlatformRule(rules, { channel: 'online' }, asOf)?.id).toBe('viva');
  });
});

describe('normalizarAppliesTo', () => {
  it('traduce todos a all', () => {
    expect(normalizarAppliesTo('todos')).toBe('all');
  });
});

describe('platformFeeFor', () => {
  it('porcentaje más fijo', () => {
    expect(platformFeeFor(10000, { percent: 2, fixed: 50, applies_to: 'online' })).toBe(250);
  });

  it('respeta el tope por transacción', () => {
    expect(platformFeeFor(1000000, {
      percent: 2, fixed: 0, max_per_transaction: 5000, applies_to: 'online',
    })).toBe(5000);
  });

  it('respeta el piso por transacción', () => {
    expect(platformFeeFor(100, {
      percent: 2, fixed: 0, min_per_transaction: 50, applies_to: 'online',
    })).toBe(50);
  });

  it('nunca cobra más que el bruto', () => {
    expect(platformFeeFor(100, {
      percent: 0, fixed: 500, applies_to: 'online',
    })).toBe(100);
  });

  it('sin regla no cobra nada', () => {
    expect(platformFeeFor(10000, null)).toBe(0);
  });

  it('un bruto 0 no genera comisión aunque haya fijo', () => {
    expect(platformFeeFor(0, { percent: 2, fixed: 100, applies_to: 'online' })).toBe(0);
  });

  it('no vuelve a sumar el impuesto cuando ya está incluido', () => {
    expect(platformFeeFor(10000, {
      percent: 2, fixed: 0, applies_to: 'online', tax_treatment: 'included', tax_rate_pct: 21,
    })).toBe(200);
  });

  it('suma el impuesto después del tope cuando fue aprobado como adicionado', () => {
    expect(platformFeeFor(10000, {
      percent: 2, fixed: 0, max_per_transaction: 150, applies_to: 'online',
      tax_treatment: 'added', tax_rate_pct: 21,
    })).toBe(181.5);
  });
});

// ── Liquidación ─────────────────────────────────────────────────────────────

describe('computeSettlement', () => {
  it('desglosa arancel, IVA, comisión y neto', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit' })!;
    const s = computeSettlement({
      gross: 10000,
      providerFee: fee,
      platformRule: { percent: 1, fixed: 0, applies_to: 'online' },
    });
    expect(s.providerFee).toBe(629);
    expect(s.providerFeeIva).toBe(132.09);   // 629 * 21%
    expect(s.platformFee).toBe(100);
    expect(s.net).toBe(9138.91);
    expect(s.gross).toBe(10000);
  });

  it('el costo efectivo cierra con el neto', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'debit' })!;
    const s = computeSettlement({ gross: 50000, providerFee: fee, platformRule: null });
    expect(s.effectiveCostPct).toBe(4.22);
    expect(s.net + s.providerFee + s.providerFeeIva + s.platformFee).toBeCloseTo(50000, 2);
  });

  it('efectivo no tiene costo de cobro', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'efectivo', method: 'cash' })!;
    const s = computeSettlement({ gross: 8000, providerFee: fee });
    expect(s.net).toBe(8000);
    expect(s.effectiveCostPct).toBe(0);
  });

  it('el arancel real informado por el procesador pisa el tarifario', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit' })!;
    const s = computeSettlement({ gross: 10000, providerFee: fee, actualProviderFee: 700 });
    expect(s.providerFee).toBe(700);
    expect(s.providerFeeIva).toBe(147);
  });

  it('sin arancel cargado no invita costos', () => {
    const s = computeSettlement({ gross: 10000, providerFee: null });
    expect(s.providerFee).toBe(0);
    expect(s.net).toBe(10000);
    expect(s.releaseDays).toBeNull();
  });

  it('nunca devuelve un neto negativo', () => {
    const s = computeSettlement({
      gross: 100,
      providerFee: { provider: 'otro', method: 'default', installments: 0, percent_fee: 0, fixed_fee: 500 },
    });
    expect(s.net).toBe(0);
  });

  it('un bruto negativo se trata como 0', () => {
    expect(computeSettlement({ gross: -500 }).gross).toBe(0);
  });

  it('propaga los días de acreditación', () => {
    const s = computeSettlement({
      gross: 1000,
      providerFee: { provider: 'stripe', method: 'default', installments: 0, percent_fee: 3.5, fixed_fee: 0, release_days: 7 },
    });
    expect(s.releaseDays).toBe(7);
  });
});

// ── Gross-up ────────────────────────────────────────────────────────────────

describe('grossUpForNet', () => {
  it('el bruto calculado deja exactamente el neto pedido', () => {
    const rule: CommissionRule = { percent: 1, fixed: 0, applies_to: 'online' };
    const gross = grossUpForNet(50000, NO_IVA, rule)!;
    expect(computeSettlement({ gross, providerFee: NO_IVA, platformRule: rule }).net).toBeCloseTo(50000, 1);
  });

  it('funciona con IVA sobre el arancel', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit' })!;
    const gross = grossUpForNet(100000, fee, null)!;
    expect(computeSettlement({ gross, providerFee: fee }).net).toBeCloseTo(100000, 1);
  });

  it('contempla el costo fijo', () => {
    const fee: ProviderFee = { provider: 'stripe', method: 'default', installments: 0, percent_fee: 3, fixed_fee: 100, iva_on_fee_pct: 0 };
    const gross = grossUpForNet(10000, fee, null)!;
    expect(computeSettlement({ gross, providerFee: fee }).net).toBeCloseTo(10000, 1);
  });

  it('se corrige cuando el tope por transacción distorsiona el despeje', () => {
    const rule: CommissionRule = { percent: 10, fixed: 0, max_per_transaction: 100, applies_to: 'online' };
    const gross = grossUpForNet(50000, NO_IVA, rule)!;
    expect(computeSettlement({ gross, providerFee: NO_IVA, platformRule: rule }).net).toBeCloseTo(50000, 1);
  });

  it('contempla el impuesto adicionado a la comisión', () => {
    const rule: CommissionRule = {
      percent: 2, fixed: 50, applies_to: 'online', tax_treatment: 'added', tax_rate_pct: 21,
    };
    const gross = grossUpForNet(50000, NO_IVA, rule)!;
    expect(computeSettlement({ gross, providerFee: NO_IVA, platformRule: rule }).net).toBeCloseTo(50000, 1);
  });

  it('null cuando los porcentajes suman 100% o más', () => {
    expect(grossUpForNet(1000,
      { provider: 'otro', method: 'default', installments: 0, percent_fee: 60, fixed_fee: 0, iva_on_fee_pct: 0 },
      { percent: 40, fixed: 0, applies_to: 'online' },
    )).toBeNull();
  });

  it('un neto 0 o negativo devuelve 0', () => {
    expect(grossUpForNet(0, NO_IVA, null)).toBe(0);
    expect(grossUpForNet(-100, NO_IVA, null)).toBe(0);
  });
});

// ── Cuotas ──────────────────────────────────────────────────────────────────

describe('installmentPricing', () => {
  it('reparte el recargo entre las cuotas', () => {
    const fee = resolveProviderFee(SCHEDULE, { provider: 'mercadopago', method: 'credit', installments: 6 })!;
    const p = installmentPricing(60000, fee, 6);
    expect(p.total).toBe(67740);
    expect(p.perInstallment).toBe(11290);
    expect(p.surcharge).toBe(7740);
    expect(p.surchargePct).toBe(12.9);
  });

  it('sin arancel no hay recargo', () => {
    const p = installmentPricing(10000, null, 3);
    expect(p.total).toBe(10000);
    expect(p.perInstallment).toBeCloseTo(3333.33, 2);
    expect(p.surcharge).toBe(0);
  });

  it('0 cuotas se trata como 1 pago', () => {
    expect(installmentPricing(5000, NO_IVA, 0).perInstallment).toBe(5500);
  });
});
