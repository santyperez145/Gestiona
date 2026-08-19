import { describe, it, expect } from "vitest";
import {
  metodoDeTarifa, ordenarOpciones, costoEfectivoPct, compararCobro,
  puedeReintentar, costoRealPorVentaLograda, ESTADO_INTENT,
  type OpcionDeCobro,
} from "@/lib/paymentRouting";

const op = (o: Partial<OpcionDeCobro> = {}): OpcionDeCobro => ({
  provider: "mercadopago", prioridad: 10, costo: 1000, costo_pct: 4.79,
  dias_acredita: 14, ...o,
});

describe("metodoDeTarifa — el puente entre dos vocabularios", () => {
  // ⚠️ No cruzarlos hizo que el ruteo por costo devolviera cero para todo.
  it("traduce el vocabulario de la tienda al de las tarifas", () => {
    expect(metodoDeTarifa("efectivo")).toBe("cash");
    expect(metodoDeTarifa("transferencia")).toBe("transfer");
    expect(metodoDeTarifa("tarjeta")).toBe("credit");
    expect(metodoDeTarifa("debito")).toBe("debit");
  });

  // Un pago en una cuota por la billetera cuesta 4,79%; en cuotas, 12,9%.
  // Confundirlos es plata real.
  it("mercadopago en un pago es billetera, en cuotas es crédito", () => {
    expect(metodoDeTarifa("mercadopago", 1)).toBe("wallet");
    expect(metodoDeTarifa("mercadopago", 3)).toBe("credit");
    expect(metodoDeTarifa("mercadopago", 12)).toBe("credit");
  });

  it("lo que no conoce cae a la tarifa genérica", () => {
    expect(metodoDeTarifa("cripto")).toBe("default");
    expect(metodoDeTarifa("")).toBe("default");
  });

  it("no se rompe con mayúsculas ni con cuotas inválidas", () => {
    expect(metodoDeTarifa("MercadoPago", NaN)).toBe("wallet");
    expect(metodoDeTarifa("EFECTIVO")).toBe("cash");
  });
});

describe("ordenarOpciones", () => {
  it("la prioridad manda sobre el costo", () => {
    const r = ordenarOpciones([
      op({ provider: "caro_pero_preferido", prioridad: 10, costo: 5000 }),
      op({ provider: "barato", prioridad: 50, costo: 100 }),
    ]);
    expect(r[0].provider).toBe("caro_pero_preferido");
  });

  it("a igual prioridad gana el más barato", () => {
    const r = ordenarOpciones([
      op({ provider: "caro", prioridad: 10, costo: 5000 }),
      op({ provider: "barato", prioridad: 10, costo: 100 }),
    ]);
    expect(r[0].provider).toBe("barato");
  });

  // ⚠️ Costo desconocido no es costo cero: si no, el proveedor del que menos
  // sabemos gana siempre.
  it("lo que no tiene tarifa cargada va último, no primero", () => {
    const r = ordenarOpciones([
      op({ provider: "sin_tarifa", prioridad: 10, costo: null }),
      op({ provider: "conocido", prioridad: 10, costo: 5000 }),
    ]);
    expect(r[0].provider).toBe("conocido");
    expect(r[1].provider).toBe("sin_tarifa");
  });

  it("no explota con la lista vacía", () => {
    expect(ordenarOpciones([])).toEqual([]);
  });
});

describe("costoEfectivoPct", () => {
  it("expresa el costo como porcentaje del monto", () => {
    expect(costoEfectivoPct(op({ costo: 5795.9 }), 100000)).toBe(5.8);
  });

  it("sin costo conocido no inventa un porcentaje", () => {
    expect(costoEfectivoPct(op({ costo: null }), 100000)).toBeNull();
  });

  it("un monto inválido no da infinito", () => {
    expect(costoEfectivoPct(op(), 0)).toBeNull();
    expect(costoEfectivoPct(op(), NaN)).toBeNull();
  });
});

describe("compararCobro", () => {
  const opciones = [
    op({ provider: "barato_lento", costo: 3000, dias_acredita: 30 }),
    op({ provider: "caro_rapido", costo: 6000, dias_acredita: 2 }),
  ];

  it("dice cuánto se ahorra eligiendo el más barato", () => {
    const c = compararCobro(opciones);
    expect(c.mejor?.provider).toBe("barato_lento");
    expect(c.ahorro).toBe(3000);
  });

  // La comisión no es el único costo: los días de acreditación también.
  it("y qué se resigna en días de acreditación", () => {
    expect(compararCobro(opciones).diasExtra).toBe(28);
  });

  it("avisa si hay opciones sin tarifa cargada", () => {
    const c = compararCobro([...opciones, op({ provider: "x", costo: null })]);
    expect(c.hayDesconocidos).toBe(true);
  });

  it("sin ninguna opción con costo no elige nada", () => {
    const c = compararCobro([op({ costo: null })]);
    expect(c.mejor).toBeNull();
    expect(c.hayDesconocidos).toBe(true);
  });
});

describe("puedeReintentar", () => {
  // ⚠️ Reintentar algo acreditado sería cobrar dos veces.
  it("nunca sobre algo ya pago", () => {
    const r = puedeReintentar("acreditado", ["mercadopago"], ["mercadopago", "otro"]);
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("ya está paga");
  });

  it("no repite un proveedor que ya rechazó", () => {
    const r = puedeReintentar("pendiente", ["mercadopago"], ["mercadopago"]);
    expect(r.puede).toBe(false);
    expect(r.motivo).toContain("No quedan medios");
  });

  it("sí cuando queda otro proveedor", () => {
    expect(puedeReintentar("pendiente", ["mercadopago"], ["mercadopago", "otro"]).puede).toBe(true);
  });

  it("un cobro cancelado no se reintenta", () => {
    expect(puedeReintentar("cancelado", [], ["otro"]).puede).toBe(false);
  });
});

describe("costoRealPorVentaLograda", () => {
  // Un proveedor barato que rechaza el 30% sale más caro que uno caro que
  // aprueba todo: cada rechazo es una venta perdida, no un descuento.
  it("el rechazo encarece el costo real", () => {
    expect(costoRealPorVentaLograda(5, 100)).toBe(5);
    expect(costoRealPorVentaLograda(5, 70)).toBe(7.14);
  });

  it("un proveedor caro que aprueba todo puede salir mejor", () => {
    const barato = costoRealPorVentaLograda(4, 70)!;   // 5.71
    const caro   = costoRealPorVentaLograda(5, 95)!;   // 5.26
    expect(caro).toBeLessThan(barato);
  });

  it("sin datos no inventa", () => {
    expect(costoRealPorVentaLograda(null, 90)).toBeNull();
    expect(costoRealPorVentaLograda(5, 0)).toBeNull();
    expect(costoRealPorVentaLograda(5, null)).toBeNull();
  });
});

describe("estados del cobro", () => {
  it("cada estado tiene etiqueta y tono", () => {
    expect(ESTADO_INTENT.acreditado.tono).toBe("green");
    expect(ESTADO_INTENT.rechazado.label).toBe("Rechazado");
    expect(Object.keys(ESTADO_INTENT)).toHaveLength(6);
  });
});
