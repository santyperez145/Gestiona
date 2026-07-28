import { describe, it, expect } from "vitest";
import {
  calculateProductProfits,
  calculateDecantPrice,
  calculateWholesalePrice,
  calculateTaxes,
  formatARS,
  formatUSD,
} from "@/lib/supabaseStore";

describe("calculateProductProfits", () => {
  it("calcula costo, arancel y ganancia correctamente", () => {
    // costUSD=10, customs=15%, saleARS=15000, rate=1000
    // totalCostUSD = 10 * 1.15 = 11.5, totalCostARS = 11500, profit = 3500
    const result = calculateProductProfits(10, 15, 15000, 1000);
    expect(result.customsFee).toBeCloseTo(1.5);
    expect(result.totalCostUSD).toBeCloseTo(11.5);
    expect(result.totalCostARS).toBeCloseTo(11500);
    expect(result.profitPerUnitARS).toBeCloseTo(3500);
    expect(result.profitPerUnitUSD).toBeCloseTo(3.5);
  });

  it("ganancia negativa cuando el precio es menor al costo", () => {
    const result = calculateProductProfits(10, 0, 500, 1000);
    expect(result.profitPerUnitARS).toBeLessThan(0);
  });

  it("arancel cero cuando customsPercent es 0", () => {
    const result = calculateProductProfits(10, 0, 2000, 1000);
    expect(result.customsFee).toBe(0);
    expect(result.totalCostUSD).toBe(10);
  });
});

describe("calculateDecantPrice", () => {
  it("calcula precio de decant proporcional con margen", () => {
    // 100ml bottle at USD 20 total cost, decant 10ml, 50% margin, rate 1000
    const price = calculateDecantPrice(20, 100, 10, 50, 1000);
    // cost_prop = (20/100)*10 = 2 USD; price = 2 * 1000 * 1.5 = 3000
    expect(price).toBe(3000);
  });

  it("retorna 0 si contentMl o decantMl es 0", () => {
    expect(calculateDecantPrice(20, 0, 10, 50, 1000)).toBe(0);
    expect(calculateDecantPrice(20, 100, 0, 50, 1000)).toBe(0);
  });
});

describe("calculateWholesalePrice", () => {
  it("aplica descuento mayorista correctamente", () => {
    const result = calculateWholesalePrice(1000, 1200, 10, 5, 100);
    // basePrice = 1000 (discountPrice), wholesale = 1000 * 0.9 = 900
    // minPrice = 5 * 100 * 1.2 = 600
    expect(result.wholesalePrice).toBe(900);
    expect(result.belowFloor).toBe(false);
  });

  it("aplica precio minimo cuando el mayorista queda debajo", () => {
    const result = calculateWholesalePrice(500, 600, 50, 10, 100);
    // wholesale = 500 * 0.5 = 250; minPrice = 10 * 100 * 1.2 = 1200
    expect(result.wholesalePrice).toBe(1200);
    expect(result.belowFloor).toBe(true);
  });

  it("usa sale_price_ars cuando no hay discount_price", () => {
    const result = calculateWholesalePrice(0, 1000, 20, 5, 100);
    // basePrice = 1000, wholesale = 800
    expect(result.wholesalePrice).toBe(800);
  });
});

describe("calculateTaxes", () => {
  it("retorna cero cuando tax_enabled es false", () => {
    const result = calculateTaxes(10_000, 1000, { tax_enabled: false });
    expect(result.totalTax).toBe(0);
    expect(result.netProfit).toBe(1000);
  });

  it("calcula IVA e IIBB sobre las VENTAS, no sobre la ganancia", () => {
    const settings = {
      tax_enabled: true,
      tax_iva_percent: 21,
      tax_iibb_percent: 3.5,
      tax_monotributo_monthly: 100,
    };
    // Ventas 121.000 con IVA incluido → neto 100.000, IVA débito 21.000
    const result = calculateTaxes(121_000, 40_000, settings);
    expect(result.iva).toBeCloseTo(21_000, 0);
    expect(result.iibb).toBeCloseTo(4_235);   // 3,5% de la facturación
    expect(result.monotributo).toBe(100);
    expect(result.totalTax).toBeCloseTo(25_335, 0);
    expect(result.netProfit).toBeCloseTo(40_000 - 25_335, 0);
  });

  it("si los precios NO incluyen IVA, lo agrega sobre el neto", () => {
    const settings = { tax_enabled: true, tax_iva_percent: 21, tax_iibb_percent: 0, tax_prices_include_iva: false };
    const result = calculateTaxes(100_000, 40_000, settings);
    expect(result.iva).toBeCloseTo(21_000);
  });

  it("el IVA ya no depende de la ganancia (mismo importe con distinta ganancia)", () => {
    const settings = { tax_enabled: true, tax_iva_percent: 21, tax_iibb_percent: 0 };
    const pocoMargen = calculateTaxes(121_000, 5_000, settings);
    const muchoMargen = calculateTaxes(121_000, 80_000, settings);
    expect(pocoMargen.iva).toBeCloseTo(muchoMargen.iva);
  });

  it("usa defaults cuando los porcentajes no estan seteados", () => {
    const result = calculateTaxes(121_000, 10_000, { tax_enabled: true });
    expect(result.iva).toBeCloseTo(21_000, 0);   // 21% incluido
    expect(result.iibb).toBeCloseTo(4_235);      // 3,5%
  });
});

describe("formatARS", () => {
  it("formatea numeros en pesos argentinos", () => {
    const formatted = formatARS(1500);
    expect(formatted).toContain("1.500");
  });

  it("incluye simbolo de moneda", () => {
    const formatted = formatARS(100);
    expect(formatted).toMatch(/\$|ARS/);
  });
});

describe("formatUSD", () => {
  it("formatea numeros en dolares", () => {
    const formatted = formatUSD(9.99);
    expect(formatted).toContain("9.99");
    expect(formatted).toMatch(/\$|USD/);
  });
});
