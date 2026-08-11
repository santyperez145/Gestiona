import { describe, it, expect } from "vitest";
import {
  precioDeLista, tramoAplicable, listaVigente, etiquetaDescuento,
  type ListaDePrecios, type ItemDeLista,
} from "@/lib/priceListCalc";

const HOY = new Date("2026-08-11T12:00:00Z");
const lista = (over: Partial<ListaDePrecios> = {}): ListaDePrecios => ({
  id: "l1", name: "Mayorista", discount_type: "percentage", discount_value: 20, ...over,
});
const item = (over: Partial<ItemDeLista> = {}): ItemDeLista => ({
  product_id: "p1", custom_price: null, discount_pct: null, min_quantity: 1, ...over,
});

describe("precioDeLista — orden de resolución", () => {
  it("sin lista se cobra el precio base", () => {
    expect(precioDeLista(10_000, null, [], "p1", 1, HOY))
      .toEqual({ precio: 10_000, origen: "precio_base", ahorroUnitario: 0 });
  });

  it("el descuento general de la lista", () => {
    const r = precioDeLista(10_000, lista(), [], "p1", 1, HOY);
    expect(r.precio).toBe(8_000);
    expect(r.origen).toBe("descuento_lista");
    expect(r.ahorroUnitario).toBe(2_000);
  });

  it("el porcentaje del producto pisa al de la lista", () => {
    const r = precioDeLista(10_000, lista(), [item({ discount_pct: 30 })], "p1", 1, HOY);
    expect(r.precio).toBe(7_000);
    expect(r.origen).toBe("pct_producto");
  });

  // Lo más específico gana: si alguien escribió "este producto vale $X", vale $X.
  it("el precio fijo pisa a los dos porcentajes", () => {
    const r = precioDeLista(10_000, lista(), [item({ custom_price: 6_500, discount_pct: 30 })], "p1", 1, HOY);
    expect(r.precio).toBe(6_500);
    expect(r.origen).toBe("precio_fijo");
  });

  it("un producto que no está en la lista usa el descuento general", () => {
    const r = precioDeLista(10_000, lista(), [item({ product_id: "otro", custom_price: 1 })], "p1", 1, HOY);
    expect(r.precio).toBe(8_000);
  });

  it("una lista sin descuento devuelve el precio base", () => {
    const r = precioDeLista(10_000, lista({ discount_type: "none", discount_value: 0 }), [], "p1", 1, HOY);
    expect(r.origen).toBe("precio_base");
  });
});

describe("descuento fijo", () => {
  // Si se restara del total de la línea, comprar más saldría proporcionalmente
  // peor — al revés de para qué existe una lista mayorista.
  it("se resta por unidad, no del total", () => {
    const l = lista({ discount_type: "fixed", discount_value: 500 });
    expect(precioDeLista(10_000, l, [], "p1", 1, HOY).precio).toBe(9_500);
    expect(precioDeLista(10_000, l, [], "p1", 10, HOY).precio).toBe(9_500);
  });

  it("nunca deja el precio en negativo", () => {
    const l = lista({ discount_type: "fixed", discount_value: 50_000 });
    expect(precioDeLista(10_000, l, [], "p1", 1, HOY).precio).toBe(0);
  });
});

describe("tramos por cantidad", () => {
  const items = [
    item({ min_quantity: 1, discount_pct: 10 }),
    item({ min_quantity: 6, discount_pct: 20 }),
    item({ min_quantity: 12, discount_pct: 30 }),
  ];

  it("gana el tramo más alto que la cantidad alcanza", () => {
    expect(tramoAplicable(items, "p1", 1)?.min_quantity).toBe(1);
    expect(tramoAplicable(items, "p1", 5)?.min_quantity).toBe(1);
    expect(tramoAplicable(items, "p1", 6)?.min_quantity).toBe(6);
    expect(tramoAplicable(items, "p1", 15)?.min_quantity).toBe(12);
    expect(tramoAplicable(items, "p1", 100)?.min_quantity).toBe(12);
  });

  it("se traduce al precio", () => {
    expect(precioDeLista(10_000, lista(), items, "p1", 1, HOY).precio).toBe(9_000);
    expect(precioDeLista(10_000, lista(), items, "p1", 12, HOY).precio).toBe(7_000);
  });

  it("sin tramo que alcance cae al descuento de la lista", () => {
    const solo12 = [item({ min_quantity: 12, discount_pct: 30 })];
    expect(precioDeLista(10_000, lista(), solo12, "p1", 3, HOY).precio).toBe(8_000);
  });

  it("una cantidad inválida cuenta como una unidad", () => {
    expect(tramoAplicable(items, "p1", 0)?.min_quantity).toBe(1);
    expect(tramoAplicable(items, "p1", NaN)?.min_quantity).toBe(1);
  });
});

describe("vigencia", () => {
  it("una lista inactiva no cobra", () => {
    expect(listaVigente(lista({ is_active: false }), HOY)).toBe(false);
    expect(precioDeLista(10_000, lista({ is_active: false }), [], "p1", 1, HOY).precio).toBe(10_000);
  });

  // El precio mayorista de una temporada no es el de la siguiente.
  it("una lista vencida no cobra", () => {
    expect(listaVigente(lista({ valid_until: "2026-08-10" }), HOY)).toBe(false);
  });

  it("una lista que todavía no empezó tampoco", () => {
    expect(listaVigente(lista({ valid_from: "2026-09-01" }), HOY)).toBe(false);
  });

  it("el día exacto de inicio y de fin sí cuentan", () => {
    expect(listaVigente(lista({ valid_from: "2026-08-11" }), HOY)).toBe(true);
    expect(listaVigente(lista({ valid_until: "2026-08-11" }), HOY)).toBe(true);
  });

  it("sin fechas siempre vigente", () => {
    expect(listaVigente(lista(), HOY)).toBe(true);
  });
});

describe("etiquetaDescuento", () => {
  it("lo dice como se lee", () => {
    expect(etiquetaDescuento(lista())).toBe("−20%");
    expect(etiquetaDescuento(lista({ discount_type: "fixed", discount_value: 500 }))).toBe("−$500");
    expect(etiquetaDescuento(lista({ discount_type: "none", discount_value: 0 }))).toBe("Precio de lista");
    expect(etiquetaDescuento(null)).toBe("Precio de lista");
  });
});

describe("entradas raras", () => {
  it("un precio base inválido no explota", () => {
    expect(precioDeLista(NaN, lista(), [], "p1", 1, HOY).precio).toBe(0);
    expect(precioDeLista(-500, lista(), [], "p1", 1, HOY).precio).toBe(0);
  });

  it("items nulos", () => {
    expect(precioDeLista(10_000, lista(), null, "p1", 1, HOY).precio).toBe(8_000);
  });
});
