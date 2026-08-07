import { describe, it, expect } from "vitest";
import {
  evaluarCupon, calcularEfecto, mensajeRechazo, normalizarEmail, type ReglasCupon,
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

describe("calcularEfecto — descuento de mercadería", () => {
  it("porcentaje", () => {
    expect(calcularEfecto({ descuentoPct: 20 }, 50_000).mercaderia).toBe(10_000);
  });

  it("monto fijo", () => {
    expect(calcularEfecto({ descuentoFijo: 5_000 }, 50_000).mercaderia).toBe(5_000);
  });

  it("el porcentaje gana sobre el fijo cuando están los dos", () => {
    // Es como lo resuelve el SQL: son campos excluyentes en la práctica, pero
    // si alguien carga los dos tiene que haber un ganador definido.
    expect(calcularEfecto({ descuentoPct: 10, descuentoFijo: 9_999 }, 50_000).mercaderia).toBe(5_000);
  });

  it("un fijo mayor que la compra no devuelve plata", () => {
    expect(calcularEfecto({ descuentoFijo: 10_000 }, 8_000).mercaderia).toBe(8_000);
  });
});

describe("calcularEfecto — envío gratis (A5)", () => {
  it("bonifica el envío entero", () => {
    const e = calcularEfecto({ bonificaEnvio: true }, 50_000, 12_000);
    expect(e.envio).toBe(12_000);
    expect(e.mercaderia).toBe(0);
    expect(e.total).toBe(12_000);
  });

  // Un "envío gratis" sin tope a Tierra del Fuego puede costar más que la
  // venta. Con tope, el comprador paga la diferencia.
  it("el tope limita lo que absorbe el comercio", () => {
    expect(calcularEfecto({ bonificaEnvio: true, topeEnvio: 8_000 }, 50_000, 20_000).envio).toBe(8_000);
  });

  it("el tope no infla un envío barato", () => {
    expect(calcularEfecto({ bonificaEnvio: true, topeEnvio: 8_000 }, 50_000, 3_000).envio).toBe(3_000);
  });

  it("sobre un envío que ya es gratis no bonifica nada", () => {
    // Retiro en tienda, o umbral de envío gratis ya alcanzado.
    expect(calcularEfecto({ bonificaEnvio: true }, 200_000, 0).total).toBe(0);
  });

  it("un cupón que no bonifica envío deja el flete intacto", () => {
    expect(calcularEfecto({ descuentoPct: 20 }, 50_000, 12_000).envio).toBe(0);
  });

  it("se combinan descuento y envío, y el total es lo que le cuesta al comercio", () => {
    const e = calcularEfecto({ descuentoPct: 10, bonificaEnvio: true }, 50_000, 12_000);
    expect(e).toEqual({ mercaderia: 5_000, envio: 12_000, total: 17_000 });
  });
});

describe("mensajeRechazo — sin efecto", () => {
  it("explica por qué el cupón de envío no hace nada", () => {
    expect(mensajeRechazo({ aplica: false, motivo: "sin_efecto" }, fmt))
      .toBe("Este cupón bonifica el envío y tu pedido no tiene costo de envío");
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
