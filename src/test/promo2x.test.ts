import { describe, it, expect } from "vitest";
import { ahorroPromo2x, ahorroDeUnPar, type LineaCarrito } from "@/lib/promo2x";

// Los números son los reales de producción: ELFBAR ICE KING 40K, oferta
// $30.912 la unidad y $42.000 llevando dos. Ahorro del par: $19.824.
const ELFBAR = "elfbar";
const precios = { [ELFBAR]: 42000 };
const UNIT = 30912;
const AHORRO_PAR = 2 * UNIT - 42000; // 19.824

const linea = (qty: number, price = UNIT, productId = ELFBAR): LineaCarrito =>
  ({ productId, qty, price });

describe("ahorroPromo2x", () => {
  it("con una sola unidad no hay promo", () => {
    expect(ahorroPromo2x([linea(1)], precios).total).toBe(0);
  });

  it("dos unidades de la misma línea aplican", () => {
    expect(ahorroPromo2x([linea(2)], precios).total).toBe(AHORRO_PAR);
  });

  it("DOS SABORES DISTINTOS aplican: es el caso real", () => {
    // Dos líneas de una unidad cada una. Una regla que mirara `qty >= 2` por
    // línea no dispararía nunca, y estos productos tienen 9 y 10 sabores.
    const r = ahorroPromo2x([linea(1), linea(1)], precios);
    expect(r.total).toBe(AHORRO_PAR);
    expect(r.detalle[0].pares).toBe(1);
  });

  it("tres unidades pagan un par con promo y una suelta a precio normal", () => {
    expect(ahorroPromo2x([linea(2), linea(1)], precios).total).toBe(AHORRO_PAR);
  });

  it("cuatro unidades son dos pares", () => {
    expect(ahorroPromo2x([linea(2), linea(2)], precios).total).toBe(2 * AHORRO_PAR);
  });

  it("cinco unidades siguen siendo dos pares", () => {
    expect(ahorroPromo2x([linea(5)], precios).total).toBe(2 * AHORRO_PAR);
  });

  it("no mezcla productos distintos: dos unidades de dos productos no son un par", () => {
    const r = ahorroPromo2x(
      [linea(1, UNIT, "a"), linea(1, UNIT, "b")],
      { a: 42000, b: 42000 },
    );
    expect(r.total).toBe(0);
  });

  it("suma varios productos con promo por separado", () => {
    const r = ahorroPromo2x(
      [linea(2, 30912, "a"), linea(2, 26496, "b")],
      { a: 42000, b: 36000 },
    );
    expect(r.total).toBe((2 * 30912 - 42000) + (2 * 26496 - 36000));
    expect(r.detalle).toHaveLength(2);
  });

  it("un producto sin promo cargada no descuenta nada", () => {
    expect(ahorroPromo2x([linea(4)], {}).total).toBe(0);
    expect(ahorroPromo2x([linea(4)], { [ELFBAR]: null }).total).toBe(0);
    expect(ahorroPromo2x([linea(4)], { [ELFBAR]: 0 }).total).toBe(0);
  });

  it("nunca encarece: si el 2x quedó peor que el precio, no se aplica", () => {
    // Pasa de verdad cuando entra una oferta más agresiva que la promo vieja.
    expect(ahorroPromo2x([linea(2, 10000)], { [ELFBAR]: 25000 }).total).toBe(0);
  });

  it("usa el precio realmente cobrado, no el de lista", () => {
    // Sabores con `price_override` distinto: el par se valúa al promedio real.
    const r = ahorroPromo2x([linea(1, 30000), linea(1, 40000)], { [ELFBAR]: 42000 });
    expect(r.total).toBe(2 * 35000 - 42000);
  });

  it("un carrito vacío da cero y no rompe", () => {
    expect(ahorroPromo2x([], precios)).toEqual({ total: 0, detalle: [] });
  });

  it("ignora líneas con cantidad cero o basura", () => {
    const r = ahorroPromo2x(
      [linea(0), { productId: ELFBAR, qty: NaN as number, price: UNIT }, linea(2)],
      precios,
    );
    expect(r.total).toBe(AHORRO_PAR);
  });

  it("no informa detalle de un producto que no ahorra nada", () => {
    expect(ahorroPromo2x([linea(2, 10000)], { [ELFBAR]: 25000 }).detalle).toEqual([]);
  });
});

describe("ahorroDeUnPar", () => {
  it("da el ahorro del cartel de la ficha", () => {
    expect(ahorroDeUnPar(UNIT, 42000)).toBe(AHORRO_PAR);
    expect(ahorroDeUnPar(26496, 36000)).toBe(16992);
  });

  it("devuelve null cuando no hay promo o no ahorra: un cartel de cero es peor que nada", () => {
    expect(ahorroDeUnPar(UNIT, null)).toBeNull();
    expect(ahorroDeUnPar(UNIT, 0)).toBeNull();
    expect(ahorroDeUnPar(10000, 25000)).toBeNull();
    expect(ahorroDeUnPar(10000, 20000)).toBeNull();  // igual, no ahorra
    expect(ahorroDeUnPar(0, 42000)).toBeNull();
  });
});

// ── Descuento por cantidad ──────────────────────────────────────────────────
import { ahorroPorVolumen, reglaAplica, type ReglaCantidad } from "@/lib/promo2x";

const regla = (o: Partial<ReglaCantidad>): ReglaCantidad => ({
  id: "r", name: "R", scope: "todos", target: null, min_qty: 2, discount_percent: 10, ...o,
});

describe("reglaAplica", () => {
  it("'todos' alcanza a cualquier producto", () => {
    expect(reglaAplica(regla({ scope: "todos" }), "x", "cat")).toBe(true);
  });

  it("'categoria' sólo a la suya, y no si el producto no tiene categoría", () => {
    const r = regla({ scope: "categoria", target: "vaper" });
    expect(reglaAplica(r, "x", "vaper")).toBe(true);
    expect(reglaAplica(r, "x", "perfume")).toBe(false);
    expect(reglaAplica(r, "x", null)).toBe(false);
  });

  it("'producto' sólo al suyo", () => {
    const r = regla({ scope: "producto", target: "abc" });
    expect(reglaAplica(r, "abc", null)).toBe(true);
    expect(reglaAplica(r, "otro", null)).toBe(false);
  });
});

describe("ahorroPorVolumen", () => {
  const lineas = [{ productId: ELFBAR, qty: 2, price: UNIT, category: "vaper" }];

  it("sin reglas se comporta como el 2x de siempre", () => {
    expect(ahorroPorVolumen(lineas, precios, []).total).toBe(AHORRO_PAR);
  });

  it("una regla FLOJA no se suma al 2x: gana el mejor", () => {
    // Es la regla de oro de los precios acá: apilar da porcentajes que nadie
    // configuró y que el comprador no puede verificar.
    const r = [regla({ scope: "categoria", target: "vaper", discount_percent: 5 })];
    expect(ahorroPorVolumen(lineas, precios, r).total).toBe(AHORRO_PAR);
  });

  it("una regla FUERTE gana al 2x", () => {
    const r = [regla({ scope: "categoria", target: "vaper", discount_percent: 40 })];
    expect(ahorroPorVolumen(lineas, precios, r).total).toBe(Math.round(2 * UNIT * 0.4));
  });

  it("respeta min_qty", () => {
    const r = [regla({ min_qty: 3, discount_percent: 40 })];
    expect(ahorroPorVolumen(lineas, precios, r).total).toBe(AHORRO_PAR);
  });

  it("cuenta la cantidad cruzando líneas, no por línea", () => {
    // Dos sabores distintos del mismo producto: una regla de 3+ tiene que
    // disparar con 2 + 1.
    const dos = [
      { productId: ELFBAR, qty: 2, price: UNIT, category: "vaper" },
      { productId: ELFBAR, qty: 1, price: UNIT, category: "vaper" },
    ];
    const r = [regla({ min_qty: 3, discount_percent: 40 })];
    expect(ahorroPorVolumen(dos, {}, r).total).toBe(Math.round(3 * UNIT * 0.4));
  });

  it("aplica a un producto sin 2x cargado", () => {
    const otro = [{ productId: "p", qty: 3, price: 10_000, category: "x" }];
    const r = [regla({ min_qty: 3, discount_percent: 20 })];
    expect(ahorroPorVolumen(otro, {}, r).total).toBe(6_000);
  });

  it("entre varias reglas gana la de mayor descuento", () => {
    const r = [regla({ id: "a", discount_percent: 10 }), regla({ id: "b", discount_percent: 25 })];
    expect(ahorroPorVolumen(lineas, {}, r).total).toBe(Math.round(2 * UNIT * 0.25));
  });

  it("una sola unidad no descuenta nada", () => {
    const una = [{ productId: ELFBAR, qty: 1, price: UNIT, category: "vaper" }];
    expect(ahorroPorVolumen(una, precios, [regla({ discount_percent: 50 })]).total).toBe(0);
  });
});
