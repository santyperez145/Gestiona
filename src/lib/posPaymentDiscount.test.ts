import { describe, expect, it } from "vitest";
import {
  posPaymentDiscountPercent,
  posPaymentDiscounts,
  posPriceForPayment,
} from "./posPaymentDiscount";

const settings = {
  discount_cash_percent: 10,
  discount_transfer_percent: 15,
  discount_debit_percent: 2.5,
  discount_credit_percent: 0,
};

describe("descuentos por medio de pago del POS", () => {
  it("adapta las cuatro columnas configurables sin inventar QR", () => {
    expect(posPaymentDiscounts(settings)).toEqual({
      efectivo: 10,
      transferencia: 15,
      debito: 2.5,
      credito: 0,
    });
    expect(posPaymentDiscountPercent("qr", settings)).toBe(0);
  });

  it("cobra el menor entre oferta y descuento del medio", () => {
    expect(posPriceForPayment(10_000, 9_500, "efectivo", settings)).toBe(9_000);
    expect(posPriceForPayment(10_000, 8_000, "efectivo", settings)).toBe(8_000);
  });

  it("aplica también la configuración de débito", () => {
    expect(posPriceForPayment(10_000, 10_000, "debito", settings)).toBe(9_750);
  });

  it("no convierte un pago dividido en una cuenta circular", () => {
    expect(posPaymentDiscountPercent("efectivo", settings, true)).toBe(0);
    expect(posPriceForPayment(10_000, 9_500, "efectivo", settings, true)).toBe(9_500);
  });

  it("falla cerrado ante porcentajes inválidos", () => {
    expect(posPaymentDiscountPercent("efectivo", { discount_cash_percent: -5 })).toBe(0);
    expect(posPaymentDiscountPercent("efectivo", { discount_cash_percent: 500 })).toBe(90);
    expect(posPriceForPayment(10_000, 10_000, "credito", settings)).toBe(10_000);
  });
});
