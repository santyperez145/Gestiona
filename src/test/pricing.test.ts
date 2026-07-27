import { describe, it, expect } from "vitest";
import {
  getCategoryMarkup,
  getCategoryDiscount,
  calcLandedCostUSD,
  calcAutoSalePrice,
  calcAutoDiscountPrice,
  calcMarginPct,
  DEFAULT_MARKUP,
  DEFAULT_DISCOUNT_PERCENT,
} from "@/lib/pricing";

// Fuente de verdad del pricing: la usan el form de producto, "Recalcular Todo"
// de Ajustes y el "Ajuste masivo" de Productos.

const settings = {
  default_discount_percent: 25,
  category_pricing: {
    perfume_arabe: { markup: 2.2, discount: 30 },
    vaper: { markup: 1.6 },            // sin discount propio
    electronico: { discount: 0 },       // descuento 0 explícito, sin markup
  },
};

describe("getCategoryMarkup", () => {
  it("usa el markup de la categoría cuando está configurado", () => {
    expect(getCategoryMarkup(settings, "perfume_arabe")).toBe(2.2);
    expect(getCategoryMarkup(settings, "vaper")).toBe(1.6);
  });

  it("cae al markup por defecto (×2) si la categoría no lo define", () => {
    expect(getCategoryMarkup(settings, "electronico")).toBe(DEFAULT_MARKUP);
    expect(getCategoryMarkup(settings, "perfume_diseñador")).toBe(DEFAULT_MARKUP);
    expect(getCategoryMarkup(undefined, "vaper")).toBe(DEFAULT_MARKUP);
    expect(getCategoryMarkup(settings, null)).toBe(DEFAULT_MARKUP);
  });

  it("ignora markups inválidos (0, negativos, no numéricos)", () => {
    expect(getCategoryMarkup({ category_pricing: { x: { markup: 0 } } }, "x")).toBe(DEFAULT_MARKUP);
    expect(getCategoryMarkup({ category_pricing: { x: { markup: -1 } } }, "x")).toBe(DEFAULT_MARKUP);
  });
});

describe("getCategoryDiscount", () => {
  it("prioriza el descuento de la categoría", () => {
    expect(getCategoryDiscount(settings, "perfume_arabe")).toBe(30);
  });

  it("respeta un descuento 0 explícito de la categoría", () => {
    expect(getCategoryDiscount(settings, "electronico")).toBe(0);
  });

  it("cae al descuento global si la categoría no define uno", () => {
    expect(getCategoryDiscount(settings, "vaper")).toBe(25);
  });

  it("cae al default (20) si no hay nada configurado", () => {
    expect(getCategoryDiscount({}, "vaper")).toBe(DEFAULT_DISCOUNT_PERCENT);
    expect(getCategoryDiscount(undefined, undefined)).toBe(DEFAULT_DISCOUNT_PERCENT);
  });
});

describe("calcLandedCostUSD", () => {
  it("suma el pasero al costo", () => {
    expect(calcLandedCostUSD(100, 15)).toBeCloseTo(115);
    expect(calcLandedCostUSD(100, 0)).toBe(100);
  });
});

describe("calcAutoSalePrice", () => {
  it("aplica costo landeado × TC × markup", () => {
    // (10 + 15%) = 11.5 USD → ×1000 = 11.500 ARS → ×2 = 23.000
    expect(calcAutoSalePrice(10, 15, 1000, 2)).toBe(23_000);
    // mismo costo con markup 2.2 → 25.300
    expect(calcAutoSalePrice(10, 15, 1000, 2.2)).toBe(25_300);
  });

  it("cambiar el markup cambia el precio proporcionalmente", () => {
    const base = calcAutoSalePrice(10, 15, 1000, 2);
    const alto = calcAutoSalePrice(10, 15, 1000, 2.2);
    expect(alto / base).toBeCloseTo(1.1, 5);
  });

  it("devuelve 0 si no hay costo", () => {
    expect(calcAutoSalePrice(0, 15, 1000, 2)).toBe(0);
  });

  it("cae al markup por defecto si le pasan uno inválido", () => {
    expect(calcAutoSalePrice(10, 15, 1000, 0)).toBe(23_000);
  });
});

describe("calcAutoDiscountPrice", () => {
  it("resta el % del precio de venta", () => {
    expect(calcAutoDiscountPrice(100_000, 20)).toBe(80_000);
    expect(calcAutoDiscountPrice(100_000, 0)).toBe(100_000);
  });

  it("ignora porcentajes inválidos (≥100 o negativos)", () => {
    expect(calcAutoDiscountPrice(100_000, 100)).toBe(100_000);
    expect(calcAutoDiscountPrice(100_000, -5)).toBe(100_000);
  });

  it("devuelve 0 sin precio base", () => {
    expect(calcAutoDiscountPrice(0, 20)).toBe(0);
  });
});

describe("calcMarginPct", () => {
  it("calcula el margen sobre el precio de venta", () => {
    expect(calcMarginPct(100, 60)).toBeCloseTo(40);
    expect(calcMarginPct(100, 100)).toBe(0);
  });

  it("puede ser negativo si se vende bajo costo", () => {
    expect(calcMarginPct(80, 100)).toBeCloseTo(-25);
  });

  it("devuelve 0 si no hay precio", () => {
    expect(calcMarginPct(0, 50)).toBe(0);
  });
});
