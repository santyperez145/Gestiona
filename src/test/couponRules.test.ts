import { describe, it, expect } from "vitest";
import {
  evaluarCupon, mensajeRechazo, normalizarEmail, type ReglasCupon,
} from "@/lib/couponRules";

const fmt = (n: number) => `$${n.toLocaleString("es-AR")}`;

describe("evaluarCupon — mínimo de compra", () => {
  // El caso del ROADMAP: un cupón de $10.000 fijo usado en una compra de
  // $12.000 regala el 83% de la venta.
  it("bloquea el cupón cuando no se llega al mínimo", () => {
    const e = evaluarCupon(12_000, 0, { minimoCompra: 50_000 });
    expect(e.aplica).toBe(false);
    expect(e.motivo).toBe("minimo_no_alcanzado");
    expect(e.faltan).toBe(38_000);
  });

  it("lo deja pasar justo en el mínimo", () => {
    expect(evaluarCupon(50_000, 0, { minimoCompra: 50_000 }).aplica).toBe(true);
  });

  it("sin mínimo configurado no bloquea nada", () => {
    expect(evaluarCupon(1_000, 0, { minimoCompra: null }).aplica).toBe(true);
    expect(evaluarCupon(1_000, 0, { minimoCompra: 0 }).aplica).toBe(true);
    expect(evaluarCupon(1_000, 0, {}).aplica).toBe(true);
  });
});

describe("evaluarCupon — límite por persona", () => {
  // Sin esto, una sola persona consume las veinte usadas del tope global: el
  // cupón que era para captar veinte clientes captó uno.
  it("bloquea a quien ya lo usó el máximo de veces", () => {
    const reglas: ReglasCupon = { maxPorPersona: 1 };
    expect(evaluarCupon(100_000, 0, reglas).aplica).toBe(true);
    expect(evaluarCupon(100_000, 1, reglas).aplica).toBe(false);
    expect(evaluarCupon(100_000, 1, reglas).motivo).toBe("limite_por_persona");
  });

  it("permite las que correspondan", () => {
    const reglas: ReglasCupon = { maxPorPersona: 3 };
    expect(evaluarCupon(100_000, 2, reglas).aplica).toBe(true);
    expect(evaluarCupon(100_000, 3, reglas).aplica).toBe(false);
  });

  it("sin límite por persona no bloquea", () => {
    expect(evaluarCupon(100_000, 99, { maxPorPersona: null }).aplica).toBe(true);
  });
});

describe("evaluarCupon — tope global", () => {
  it("bloquea al agotarse", () => {
    const e = evaluarCupon(100_000, 0, { maxUsos: 20, usosActuales: 20 });
    expect(e.aplica).toBe(false);
    expect(e.motivo).toBe("limite_global");
  });

  it("sin tope no bloquea", () => {
    expect(evaluarCupon(100_000, 0, { maxUsos: null, usosActuales: 999 }).aplica).toBe(true);
  });
});

describe("el orden de los rechazos", () => {
  // Primero lo que el comprador puede resolver. Decirle "alcanzaste el límite"
  // a alguien que además no llega al mínimo lo manda a un callejón sin salida.
  it("el mínimo se informa antes que los límites", () => {
    const e = evaluarCupon(1_000, 5, {
      minimoCompra: 50_000, maxPorPersona: 1, maxUsos: 10, usosActuales: 10,
    });
    expect(e.motivo).toBe("minimo_no_alcanzado");
  });

  it("el límite por persona antes que el global", () => {
    const e = evaluarCupon(100_000, 5, { maxPorPersona: 1, maxUsos: 10, usosActuales: 10 });
    expect(e.motivo).toBe("limite_por_persona");
  });
});

describe("mensajeRechazo", () => {
  it("dice cuánto falta, no sólo que no alcanza", () => {
    const e = evaluarCupon(12_000, 0, { minimoCompra: 50_000 });
    expect(mensajeRechazo(e, fmt)).toBe("Te faltan $38.000 para poder usar este cupón");
  });

  it("no dice nada cuando el cupón sirve", () => {
    expect(mensajeRechazo({ aplica: true }, fmt)).toBeNull();
  });

  it("no culpa al comprador por el tope global", () => {
    expect(mensajeRechazo({ aplica: false, motivo: "limite_global" }, fmt))
      .toBe("El cupón alcanzó su límite de usos");
  });
});

describe("normalizarEmail", () => {
  it("iguala mayúsculas y espacios", () => {
    expect(normalizarEmail("  Juan@Ejemplo.COM ")).toBe("juan@ejemplo.com");
  });

  // Fusionar puntos o `+` juntaría cuentas de personas distintas, que es peor
  // que dejar pasar un uso de más.
  it("NO toca puntos ni el signo más", () => {
    expect(normalizarEmail("j.perez+tienda@gmail.com")).toBe("j.perez+tienda@gmail.com");
    expect(normalizarEmail("jperez@gmail.com")).not.toBe(normalizarEmail("j.perez@gmail.com"));
  });

  it("vacío es null, no cadena vacía", () => {
    expect(normalizarEmail("")).toBeNull();
    expect(normalizarEmail("   ")).toBeNull();
    expect(normalizarEmail(null)).toBeNull();
  });
});

describe("entradas raras", () => {
  it("un subtotal inválido cuenta como cero, no como infinito", () => {
    expect(evaluarCupon(NaN, 0, { minimoCompra: 100 }).aplica).toBe(false);
    expect(evaluarCupon(-500, 0, { minimoCompra: 100 }).aplica).toBe(false);
  });

  it("sin reglas el cupón se aplica", () => {
    expect(evaluarCupon(1_000, 0, null).aplica).toBe(true);
    expect(evaluarCupon(1_000, 0, undefined).aplica).toBe(true);
  });
});
