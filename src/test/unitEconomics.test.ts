import { describe, expect, it } from 'vitest';
import {
  calculateUnitEconomics,
  type UnitEconomicsInput,
} from '@/lib/unitEconomics';

const BASE: UnitEconomicsInput = {
  monthlyGmv: 1_000_000,
  transactions: 100,
  activeMerchants: 10,
  commissionPercent: 1,
  commissionFixed: 0,
  commissionTaxTreatment: 'included',
  commissionTaxRatePct: 21,
  commissionLeakagePct: 0,
  subscriptionRevenuePerMerchant: 0,
  providerFeePercent: 5,
  providerFeeFixed: 0,
  providerFeeTaxRatePct: 21,
  variableCostPerTransaction: 10,
  variableCostPerMerchant: 100,
  riskLossPctOfGmv: 0.1,
  monthlyFixedCosts: 5_000,
};

describe('calculateUnitEconomics', () => {
  it('separa impuesto incluido del ingreso neto de plataforma', () => {
    const result = calculateUnitEconomics(BASE);
    expect(result.platformChargeToMerchant).toBe(10_000);
    expect(result.commissionTax).toBe(1_735.54);
    expect(result.commissionRevenueNet).toBe(8_264.46);
    expect(result.netTakeRatePct).toBe(0.83);
  });

  it('suma el impuesto cuando el tratamiento aprobado es adicional', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      commissionTaxTreatment: 'added',
    });
    expect(result.platformChargeToMerchant).toBe(12_100);
    expect(result.commissionTax).toBe(2_100);
    expect(result.commissionRevenueNet).toBe(10_000);
  });

  it('aplica leakage a ingreso, impuesto y cargo realizado', () => {
    const result = calculateUnitEconomics({ ...BASE, commissionLeakagePct: 10 });
    expect(result.platformChargeToMerchant).toBe(9_000);
    expect(result.commissionTax).toBe(1_561.99);
    expect(result.commissionRevenueNet).toBe(7_438.01);
  });

  it('respeta piso y techo por cada transacción del ticket promedio', () => {
    const withMinimum = calculateUnitEconomics({
      ...BASE,
      commissionPercent: 0,
      commissionMin: 150,
      commissionTaxRatePct: 0,
    });
    const withMaximum = calculateUnitEconomics({
      ...BASE,
      commissionPercent: 10,
      commissionMax: 200,
      commissionTaxRatePct: 0,
    });
    expect(withMinimum.platformChargeToMerchant).toBe(15_000);
    expect(withMaximum.platformChargeToMerchant).toBe(20_000);
  });

  it('muestra el costo del procesador al merchant sin convertirlo en COGS de Nerqia', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      variableCostPerTransaction: 0,
      variableCostPerMerchant: 0,
      riskLossPctOfGmv: 0,
    });
    expect(result.providerCostToMerchant).toBe(60_500);
    expect(result.totalVariableCosts).toBe(0);
    expect(result.contribution).toBe(result.platformRevenueNet);
    expect(result.merchantPaymentCost).toBe(70_500);
  });

  it('calcula contribución, resultado operativo y break-even al mix actual', () => {
    const result = calculateUnitEconomics(BASE);
    expect(result.totalVariableCosts).toBe(3_000);
    expect(result.contribution).toBe(5_264.46);
    expect(result.operatingResult).toBe(264.46);
    expect(result.contributionMarginPct).toBe(63.7);
    expect(result.breakEvenGmv).toBe(949_765.03);
    expect(result.breakEvenMerchants).toBeCloseTo(9.5, 2);
  });

  it('incluye ingreso recurrente neto por merchant', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      subscriptionRevenuePerMerchant: 2_000,
    });
    expect(result.subscriptionRevenueNet).toBe(20_000);
    expect(result.platformRevenueNet).toBe(28_264.46);
    expect(result.contribution).toBe(25_264.46);
  });

  it('no inventa break-even cuando la contribución unitaria es negativa', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      variableCostPerMerchant: 5_000,
    });
    expect(result.contribution).toBeLessThan(0);
    expect(result.breakEvenGmv).toBeNull();
    expect(result.breakEvenMerchants).toBeNull();
  });

  it('marca el escenario incompleto cuando no hay volumen operativo', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      monthlyGmv: 0,
      transactions: 0,
      activeMerchants: 0,
    });
    expect(result.isModelUsable).toBe(false);
    expect(result.averageTicket).toBe(0);
    expect(result.contributionPerMerchant).toBeNull();
    expect(result.breakEvenGmv).toBeNull();
  });

  it('normaliza entradas negativas y no finitas', () => {
    const result = calculateUnitEconomics({
      ...BASE,
      monthlyGmv: Number.NaN,
      transactions: -2,
      providerFeePercent: -10,
      monthlyFixedCosts: -1,
    });
    expect(result.isModelUsable).toBe(false);
    expect(result.providerCostToMerchant).toBe(0);
    expect(result.operatingResult).toBeLessThanOrEqual(0);
  });
});
