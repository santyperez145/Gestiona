import { describe, it, expect } from "vitest";
import {
  decimalesDeMoneda, redondearMoneda, prorratear, sumaCierra,
} from "./rounding";

describe("decimalesDeMoneda", () => {
  it("ARS y USD tienen centavos", () => {
    expect(decimalesDeMoneda("ARS")).toBe(2);
    expect(decimalesDeMoneda("USD")).toBe(2);
  });

  it("el peso chileno y el guaraní no", () => {
    expect(decimalesDeMoneda("CLP")).toBe(0);
    expect(decimalesDeMoneda("PYG")).toBe(0);
  });

  it("no le importa la mayúscula ni el espacio", () => {
    expect(decimalesDeMoneda(" clp ")).toBe(0);
  });

  it("sin moneda, o desconocida, cae en 2 y no rompe", () => {
    expect(decimalesDeMoneda(undefined)).toBe(2);
    expect(decimalesDeMoneda(null)).toBe(2);
    expect(decimalesDeMoneda("XXX")).toBe(2);
  });
});

describe("redondearMoneda", () => {
  it("media unidad va hacia arriba", () => {
    expect(redondearMoneda(0.005)).toBe(0.01);
    expect(redondearMoneda(0.015)).toBe(0.02);
    expect(redondearMoneda(2.675)).toBe(2.68);
  });

  it("el clásico 1.005 no se va para abajo", () => {
    // Multiplicando por 100 da 100.49999999999999 y Math.round daría 1.00.
    expect(redondearMoneda(1.005)).toBe(1.01);
  });

  it("redondea igual de los dos lados del cero", () => {
    // Math.round(-0.5) da -0, o sea hacia el infinito positivo: un reintegro
    // de -0,005 terminaría en 0,00.
    expect(redondearMoneda(-0.005)).toBe(-0.01);
    expect(redondearMoneda(-2.675)).toBe(-2.68);
  });

  it("nunca devuelve -0", () => {
    expect(Object.is(redondearMoneda(-0.001), 0)).toBe(true);
  });

  it("una moneda sin centavos va a entero", () => {
    expect(redondearMoneda(1234.56, "CLP")).toBe(1235);
    expect(redondearMoneda(1234.4, "PYG")).toBe(1234);
  });

  it("un valor que no es número da 0, no NaN", () => {
    expect(redondearMoneda(NaN)).toBe(0);
    expect(redondearMoneda(Infinity)).toBe(0);
  });
});

describe("prorratear", () => {
  it("la suma cierra exactamente aunque no divida", () => {
    const p = prorratear(100, [1, 1, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(sumaCierra(p, 100)).toBe(true);
  });

  it("respeta la proporción", () => {
    expect(prorratear(1000, [3, 7])).toEqual([300, 700]);
  });

  it("reparte centavos sin perder ninguno", () => {
    const p = prorratear(0.03, [1, 1, 1]);
    expect(redondearMoneda(p.reduce((a, b) => a + b, 0))).toBe(0.03);
  });

  it("sin pesos positivos reparte en partes iguales, no en ceros", () => {
    // Devolver ceros escondería el importe en vez de distribuirlo.
    const p = prorratear(100, [0, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("un peso negativo cuenta como cero, no resta", () => {
    const p = prorratear(100, [-5, 10]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(p[0]).toBe(0);
  });

  it("sin partes devuelve vacío", () => {
    expect(prorratear(100, [])).toEqual([]);
  });

  it("una sola parte se lleva todo", () => {
    expect(prorratear(33.333, [1])).toEqual([33.33]);
  });

  it("cierra también en una moneda sin centavos", () => {
    const p = prorratear(100, [1, 1, 1], "CLP");
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(p.every(x => Number.isInteger(x))).toBe(true);
  });

  // El caso que motivó todo: el IVA de una orden con líneas de distinta
  // alícuota. Lo que no puede pasar es que las bases sumen distinto al total.
  it("las bases de una orden suman el total gravado", () => {
    const total = 12345.67;
    const lineas = [1000 * 3, 4500, 899.99];
    const bases = prorratear(total, lineas);
    expect(sumaCierra(bases, total)).toBe(true);
  });
});
