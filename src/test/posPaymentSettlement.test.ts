import { describe, expect, it } from 'vitest';
import { previewPosSettlement } from '@/lib/posPaymentSettlement';

describe('previewPosSettlement', () => {
  it('reconcilia bruto, arancel, IVA, plataforma y neto', () => {
    expect(previewPosSettlement(10_000, 500, 105, 50)).toEqual({
      gross: 10_000,
      providerFee: 500,
      providerFeeIva: 105,
      platformFee: 50,
      net: 9_345,
    });
  });

  it('conserva centavos sin deriva binaria', () => {
    expect(previewPosSettlement(1000.1, 10.05, 2.11, 0).net).toBe(987.94);
  });

  it('rechaza costos negativos', () => {
    expect(previewPosSettlement(1000, -1, 0, 0).error).toMatch(/negativos/);
  });

  it('rechaza costos mayores que el bruto', () => {
    expect(previewPosSettlement(100, 90, 11, 0).error).toMatch(/superan/);
  });

  it('no convierte NaN en un neto aparentemente válido', () => {
    expect(previewPosSettlement(1000, Number.NaN, 0, 0).error).toMatch(/válidos/);
  });
});
