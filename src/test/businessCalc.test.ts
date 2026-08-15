import { describe, it, expect } from "vitest";
import {
  calcSellerCommission,
  calcMonthPeriod,
  calcInfluencerROI,
  calcCPM,
  calcFulfillmentRate,
  calcCostARS,
  calcInventoryValue,
  calcLayerUnitCostARS,
  calcMeliLineMargin,
  calcPnLMargins,
  resolveSaleAttribution,
} from "@/lib/businessCalc";

// Estas funciones son las que efectivamente usan las páginas (comisiones,
// canjes, valuación de inventario, P&L). Testeamos la fuente de verdad real,
// no una reimplementación.

describe("calcSellerCommission", () => {
  it("calcula la comisión como % del total de ventas, redondeada", () => {
    expect(calcSellerCommission(150_000, 10)).toBe(15_000);
    expect(calcSellerCommission(99_999, 10)).toBe(10_000); // 9999.9 -> 10000
  });

  it("devuelve 0 si no hay ventas o el porcentaje es 0/negativo", () => {
    expect(calcSellerCommission(0, 10)).toBe(0);
    expect(calcSellerCommission(100_000, 0)).toBe(0);
    expect(calcSellerCommission(-5000, 10)).toBe(0);
  });
});

describe("calcMonthPeriod", () => {
  it("devuelve el primer y último día del mes", () => {
    const { periodStart, periodEnd } = calcMonthPeriod("2026-02");
    expect(periodStart).toBe("2026-02-01");
    expect(periodEnd).toBe("2026-02-28"); // 2026 no es bisiesto
  });

  it("maneja diciembre (rollover de año) correctamente", () => {
    const { periodStart, periodEnd } = calcMonthPeriod("2025-12");
    expect(periodStart).toBe("2025-12-01");
    expect(periodEnd).toBe("2025-12-31");
  });
});

describe("calcInfluencerROI", () => {
  it("calcula ROI% = (ventas - inversión) / inversión × 100", () => {
    // invertí 10k en producto, generó 30k en ventas -> +200%
    expect(calcInfluencerROI(30_000, 10_000)).toBeCloseTo(200);
  });

  it("ROI negativo cuando las ventas no cubren la inversión", () => {
    expect(calcInfluencerROI(4_000, 10_000)).toBeCloseTo(-60);
  });

  it("devuelve null cuando falta inversión o ventas (sin dato)", () => {
    expect(calcInfluencerROI(0, 10_000)).toBeNull();
    expect(calcInfluencerROI(30_000, 0)).toBeNull();
  });
});

describe("calcCPM", () => {
  it("calcula CPM = inversión / alcance × 1000", () => {
    // 10k de inversión, 50k de alcance -> $200 por cada mil impresiones
    expect(calcCPM(10_000, 50_000)).toBeCloseTo(200);
  });

  it("devuelve null sin alcance o sin inversión", () => {
    expect(calcCPM(10_000, 0)).toBeNull();
    expect(calcCPM(0, 50_000)).toBeNull();
  });
});

describe("calcFulfillmentRate", () => {
  it("calcula el % de posts entregados sobre los esperados", () => {
    expect(calcFulfillmentRate(8, 10)).toBeCloseTo(80);
    expect(calcFulfillmentRate(12, 10)).toBeCloseTo(120); // sobrecumplió
  });

  it("devuelve 0 cuando no había posts esperados", () => {
    expect(calcFulfillmentRate(5, 0)).toBe(0);
  });
});

describe("calcCostARS", () => {
  it("costo = precio de venta - ganancia por unidad", () => {
    expect(calcCostARS(15_000, 3_500)).toBe(11_500);
  });

  it("nunca es negativo aunque la ganancia supere el precio", () => {
    expect(calcCostARS(1_000, 5_000)).toBe(0);
  });

  it("tolera valores nulos/undefined", () => {
    expect(calcCostARS(undefined as any, undefined as any)).toBe(0);
  });
});

describe("calcInventoryValue", () => {
  it("valor = stock × costo unitario", () => {
    expect(calcInventoryValue(10, 11_500)).toBe(115_000);
  });

  it("es 0 sin stock", () => {
    expect(calcInventoryValue(0, 11_500)).toBe(0);
  });
});

describe("calcLayerUnitCostARS", () => {
  it("usa el tipo de cambio de la compra cuando existe", () => {
    // 10 USD × 1000 (rate de la compra) = 10000, ignora el fallback
    expect(calcLayerUnitCostARS(10, 1000, 1200)).toBe(10_000);
  });

  it("cae al tipo de cambio de referencia si la compra no lo tiene", () => {
    expect(calcLayerUnitCostARS(10, 0, 1200)).toBe(12_000);
  });
});

describe("calcMeliLineMargin", () => {
  it("resta costo con tipo de cambio y la comisión real de MercadoLibre", () => {
    // 2 × $100, costo USD 1 a $100 y $10 de comisión -> -$10.
    expect(calcMeliLineMargin(2, 100, 1, 100, 10)).toEqual({
      totalARS: 200,
      costARS: 200,
      feeARS: 10,
      profitARS: -10,
      profitUSD: -0.1,
    });
  });

  it("redondea los importes monetarios sin inventar una comisión faltante", () => {
    expect(calcMeliLineMargin(3, 99.995, 0.25, 1200, 0)).toEqual({
      totalARS: 299.99,
      costARS: 900,
      feeARS: 0,
      profitARS: -600.01,
      profitUSD: -0.5,
    });
  });
});

describe("resolveSaleAttribution", () => {
  it("sin cupón la venta es orgánica (null)", () => {
    expect(resolveSaleAttribution(null, false)).toBeNull();
    expect(resolveSaleAttribution("", false)).toBeNull();
    expect(resolveSaleAttribution(undefined, true)).toBeNull();
  });

  it("un cupón que coincide con código de influencer atribuye a 'influencer'", () => {
    expect(resolveSaleAttribution("VALE10", true)).toBe("influencer");
  });

  it("un cupón común (sin match de influencer) atribuye a 'coupon'", () => {
    expect(resolveSaleAttribution("PROMO20", false)).toBe("coupon");
  });
});

describe("calcPnLMargins", () => {
  it("calcula resultado neto y márgenes bruto/neto", () => {
    // ingresos 100k, ganancia bruta 40k, gastos 15k -> neto 25k
    const r = calcPnLMargins(100_000, 40_000, 15_000);
    expect(r.net).toBe(25_000);
    expect(r.grossMargin).toBeCloseTo(40);
    expect(r.netMargin).toBeCloseTo(25);
  });

  it("márgenes en 0 cuando no hay ingresos (evita división por cero)", () => {
    const r = calcPnLMargins(0, 0, 5_000);
    expect(r.net).toBe(-5_000);
    expect(r.grossMargin).toBe(0);
    expect(r.netMargin).toBe(0);
  });

  it("resultado neto negativo cuando los gastos superan la ganancia bruta", () => {
    const r = calcPnLMargins(100_000, 20_000, 35_000);
    expect(r.net).toBe(-15_000);
    expect(r.netMargin).toBeCloseTo(-15);
  });
});
