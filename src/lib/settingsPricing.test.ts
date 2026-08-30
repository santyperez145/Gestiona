import { describe, expect, it } from 'vitest';
import { buildPricingSettingsUpdate } from './settingsPricing';

const base = {
  discountCash: '10',
  discountTransfer: '5',
  discountDebit: '0',
  discountCredit: '0',
  volumeThreshold: '3',
  volumeDiscount: '10',
  decantMargin10: '250',
  decantMargin5: '350',
  decantMargin2_5: '500',
};

describe('configuración de precios del POS', () => {
  it('normaliza los porcentajes al mismo rango que la autoridad de Caja', () => {
    expect(buildPricingSettingsUpdate({
      ...base,
      discountCash: '-4',
      discountTransfer: '120',
      discountDebit: '2,5',
      discountCredit: '',
    })).toMatchObject({
      discount_cash_percent: 0,
      discount_transfer_percent: 90,
      discount_debit_percent: 2.5,
      discount_credit_percent: 0,
    });
  });

  it('evita umbrales y márgenes negativos en la misma sección', () => {
    expect(buildPricingSettingsUpdate({
      ...base,
      volumeThreshold: '1',
      volumeDiscount: '-10',
      decantMargin10: '-1',
    })).toMatchObject({
      volume_discount_threshold: 2,
      volume_discount_percent: 0,
      decant_margin_10ml: 0,
    });
  });
});
