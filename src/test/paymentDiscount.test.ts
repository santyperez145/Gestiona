import { describe, it, expect } from "vitest";
import {
  porcentajeDe,
  montoDescuento,
  totalConDescuento,
  mejorDescuento,
  MAX_DESCUENTO_PORCENTAJE,
} from "@/lib/paymentDiscount";

const DESC = { transferencia: 10, efectivo: 5 };

describe("porcentajeDe", () => {
  it("devuelve el porcentaje configurado", () => {
    expect(porcentajeDe("transferencia", DESC)).toBe(10);
    expect(porcentajeDe("efectivo", DESC)).toBe(5);
  });

  it("da 0 para un medio sin descuento", () => {
    expect(porcentajeDe("mercadopago", DESC)).toBe(0);
  });

  it("da 0 sin medio o sin mapa", () => {
    expect(porcentajeDe(null, DESC)).toBe(0);
    expect(porcentajeDe("transferencia", null)).toBe(0);
    expect(porcentajeDe("transferencia", {})).toBe(0);
  });

  // Un descuento inventado sale más caro que uno que no se aplica.
  it("ignora valores imposibles en vez de confiar en ellos", () => {
    expect(porcentajeDe("x", { x: -5 })).toBe(0);
    expect(porcentajeDe("x", { x: 0 })).toBe(0);
    expect(porcentajeDe("x", { x: NaN })).toBe(0);
    expect(porcentajeDe("x", { x: "abc" as unknown as number })).toBe(0);
  });

  it("recorta al tope en vez de regalar la mercadería", () => {
    expect(porcentajeDe("x", { x: 100 })).toBe(MAX_DESCUENTO_PORCENTAJE);
    expect(porcentajeDe("x", { x: 5000 })).toBe(MAX_DESCUENTO_PORCENTAJE);
  });
});

describe("montoDescuento", () => {
  it("aplica el porcentaje sobre la base", () => {
    expect(montoDescuento(10000, "transferencia", DESC)).toBe(1000);
    expect(montoDescuento(10000, "efectivo", DESC)).toBe(500);
  });

  it("no descuenta nada con un medio sin beneficio", () => {
    expect(montoDescuento(10000, "mercadopago", DESC)).toBe(0);
  });

  // Espejo de `round()` en SQL: si difiriera, el comprador ve un precio y se le
  // cobra otro.
  it("redondea igual que la base", () => {
    expect(montoDescuento(1005, "transferencia", DESC)).toBe(101); // 100.5 → 101
    expect(montoDescuento(1004, "transferencia", DESC)).toBe(100); // 100.4 → 100
    expect(montoDescuento(333, "transferencia", DESC)).toBe(33);   // 33.3  → 33
  });

  it("no descuenta sobre una base vacía o inválida", () => {
    expect(montoDescuento(0, "transferencia", DESC)).toBe(0);
    expect(montoDescuento(-100, "transferencia", DESC)).toBe(0);
    expect(montoDescuento(NaN, "transferencia", DESC)).toBe(0);
  });

  it("nunca descuenta más que la base", () => {
    expect(montoDescuento(100, "x", { x: MAX_DESCUENTO_PORCENTAJE })).toBeLessThanOrEqual(100);
  });
});

describe("totalConDescuento", () => {
  it("resta el descuento", () => {
    expect(totalConDescuento(10000, "transferencia", DESC)).toBe(9000);
    expect(totalConDescuento(10000, "mercadopago", DESC)).toBe(10000);
  });

  it("nunca da negativo", () => {
    expect(totalConDescuento(10, "x", { x: MAX_DESCUENTO_PORCENTAJE })).toBeGreaterThanOrEqual(0);
  });

  it("monto + total = base, sin centavos perdidos", () => {
    for (const base of [999, 1000, 1001, 12345, 7777]) {
      const d = montoDescuento(base, "transferencia", DESC);
      const t = totalConDescuento(base, "transferencia", DESC);
      expect(d + t).toBe(Math.round(base));
    }
  });
});

describe("mejorDescuento", () => {
  it("elige el más alto entre los medios aceptados", () => {
    const m = mejorDescuento(["mercadopago", "transferencia", "efectivo"], DESC);
    expect(m).toEqual({ metodo: "transferencia", porcentaje: 10 });
  });

  // Anunciar un descuento de un medio que la tienda ya no acepta es mentir.
  it("ignora los descuentos de medios que la tienda no acepta", () => {
    expect(mejorDescuento(["mercadopago"], DESC)).toBeNull();
    expect(mejorDescuento(["mercadopago", "efectivo"], DESC))
      .toEqual({ metodo: "efectivo", porcentaje: 5 });
  });

  it("da null cuando no hay nada que anunciar", () => {
    expect(mejorDescuento([], DESC)).toBeNull();
    expect(mejorDescuento(["transferencia"], {})).toBeNull();
    expect(mejorDescuento(null, DESC)).toBeNull();
  });
});
