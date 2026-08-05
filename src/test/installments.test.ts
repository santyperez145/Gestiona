import { describe, it, expect } from "vitest";
import {
  opcionDestacada,
  textoCuotas,
  convieneConsultar,
  MONTO_MINIMO_CUOTAS,
  type RespuestaCuotas,
} from "@/lib/installments";

const fmt = (n: number) => `$${n.toLocaleString("es-AR")}`;

const opt = (cuotas: number, monto: number, sinInteres: boolean) =>
  ({ cuotas, monto, total: monto * cuotas, sinInteres });

describe("opcionDestacada", () => {
  it("prefiere la mejor sin interés aunque haya más cuotas con recargo", () => {
    const r: RespuestaCuotas = {
      opciones: [opt(1, 60000, true), opt(3, 20000, true), opt(6, 10000, true), opt(12, 6000, false)],
      mejorSinInteres: opt(6, 10000, true),
      maxCuotas: 12,
    };
    expect(opcionDestacada(r)?.cuotas).toBe(6);
  });

  // "12 cuotas con recargo" no vende, pero sigue siendo información útil.
  it("cae a la de más cuotas cuando ninguna es sin interés", () => {
    const r: RespuestaCuotas = {
      opciones: [opt(1, 60000, true), opt(3, 22000, false), opt(6, 12000, false)],
      mejorSinInteres: null,
      maxCuotas: 6,
    };
    expect(opcionDestacada(r)?.cuotas).toBe(6);
  });

  // Una sola "cuota" es pagar al contado, no financiación.
  it("ignora la opción de 1 cuota", () => {
    const r: RespuestaCuotas = {
      opciones: [opt(1, 60000, true)],
      mejorSinInteres: opt(1, 60000, true),
      maxCuotas: 1,
    };
    expect(opcionDestacada(r)).toBeNull();
  });

  it("da null sin datos", () => {
    expect(opcionDestacada(null)).toBeNull();
    expect(opcionDestacada({ opciones: [], mejorSinInteres: null, maxCuotas: 0 })).toBeNull();
  });
});

describe("textoCuotas", () => {
  it("redacta la línea sin interés", () => {
    expect(textoCuotas(opt(6, 12500, true), fmt)).toBe("6 cuotas sin interés de $12.500");
  });

  // No se dice "sin interés" si MercadoPago informó recargo: es la diferencia
  // entre informar y prometer.
  it("no dice sin interés cuando hay recargo", () => {
    expect(textoCuotas(opt(12, 7000, false), fmt)).toBe("12 cuotas de $7.000");
  });

  it("no muestra nada para una cuota o sin opción", () => {
    expect(textoCuotas(opt(1, 60000, true), fmt)).toBeNull();
    expect(textoCuotas(null, fmt)).toBeNull();
  });
});

describe("convieneConsultar", () => {
  it("consulta desde el mínimo", () => {
    expect(convieneConsultar(MONTO_MINIMO_CUOTAS)).toBe(true);
    expect(convieneConsultar(50000)).toBe(true);
  });

  it("no consulta por montos que no pueden tener cuotas", () => {
    expect(convieneConsultar(MONTO_MINIMO_CUOTAS - 1)).toBe(false);
    expect(convieneConsultar(0)).toBe(false);
    expect(convieneConsultar(null)).toBe(false);
    expect(convieneConsultar(NaN)).toBe(false);
  });
});
