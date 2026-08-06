/**
 * Promo "llevando 2" en la tienda online.
 *
 * ⚠️ **Espejo de `public.store_promo_2x_discount`**
 * (`20260805000001_promo_llevando_2.sql`). El servidor es la autoridad —el
 * checkout manda ids y cantidades, nunca precios— y esto existe sólo para que
 * el carrito muestre el mismo número que se va a cobrar. Si se toca una, se
 * toca la otra.
 *
 * La regla que la define, y que no es obvia: **el ahorro se cuenta por
 * producto, cruzando todas sus líneas**. Los dos productos que hoy tienen
 * promo cargada son vapers con 9 y 10 sabores, así que la compra real —"uno de
 * frutilla y otro de uva"— son dos líneas de una unidad cada una. Mirar
 * `cantidad >= 2` línea por línea no dispararía nunca.
 */

export interface LineaCarrito {
  productId: string;
  qty: number;
  /** Precio unitario que se está cobrando por esa línea. */
  price: number;
}

/** `price_2x_ars` por producto: el precio TOTAL de las dos unidades. */
export type PreciosPar = Record<string, number | null | undefined>;

export interface DetallePromo2x {
  productId: string;
  /** Pares que entran en la promo. Una unidad suelta queda a precio normal. */
  pares: number;
  ahorro: number;
}

export interface ResultadoPromo2x {
  total: number;
  detalle: DetallePromo2x[];
}

/**
 * Ahorro total de la promo para un carrito.
 *
 * Nunca devuelve negativo: si el 2x quedó peor que el precio vigente —una
 * oferta nueva más agresiva que la promo vieja, por ejemplo— la promo
 * simplemente no se aplica en vez de encarecer la compra.
 */
export function ahorroPromo2x(
  lineas: LineaCarrito[],
  precios2x: PreciosPar,
): ResultadoPromo2x {
  const porProducto = new Map<string, { qty: number; total: number }>();

  for (const l of lineas) {
    const qty = Math.max(0, Number(l.qty) || 0);
    const price = Number(l.price) || 0;
    if (qty === 0) continue;
    const acc = porProducto.get(l.productId) ?? { qty: 0, total: 0 };
    acc.qty += qty;
    acc.total += qty * price;
    porProducto.set(l.productId, acc);
  }

  const detalle: DetallePromo2x[] = [];

  for (const [productId, { qty, total }] of porProducto) {
    const precio2x = Number(precios2x[productId]) || 0;
    if (precio2x <= 0 || qty < 2) continue;

    // Precio de referencia: lo que realmente se está cobrando en promedio por
    // unidad. Con sabores que tengan precio propio, el par se valúa a lo que
    // cuestan y no al precio de lista.
    const unitario = total / qty;
    const pares = Math.floor(qty / 2);
    const ahorro = Math.max(0, pares * (2 * unitario - precio2x));

    if (ahorro > 0) detalle.push({ productId, pares, ahorro });
  }

  return {
    total: Math.round(detalle.reduce((s, d) => s + d.ahorro, 0)),
    detalle,
  };
}

/**
 * Cuánto ahorra el comprador llevando dos de un producto, para el cartel de la
 * ficha. Devuelve `null` cuando no hay promo o cuando no ahorra nada — un
 * cartel que promete un ahorro de cero es peor que no tener cartel.
 */
export function ahorroDeUnPar(
  precioUnitario: number,
  precio2x: number | null | undefined,
): number | null {
  const p2 = Number(precio2x) || 0;
  const unit = Number(precioUnitario) || 0;
  if (p2 <= 0 || unit <= 0) return null;
  const ahorro = 2 * unit - p2;
  return ahorro > 0 ? Math.round(ahorro) : null;
}

// ── Descuento por cantidad ──────────────────────────────────────────────────
//
// ⚠️ Espejo de `public.store_volume_discount`
// (`20260806000004_descuento_por_cantidad.sql`). Misma regla que en el resto de
// los precios de este repo: **por producto gana el mejor, nunca la suma.**

export interface ReglaCantidad {
  id: string;
  name: string;
  scope: "todos" | "categoria" | "producto";
  target: string | null;
  min_qty: number;
  discount_percent: number;
}

export interface LineaConProducto extends LineaCarrito {
  /** Categoría del producto, para resolver el alcance de la regla. */
  category?: string | null;
}

/** ¿Esta regla aplica a este producto? */
export function reglaAplica(
  regla: ReglaCantidad,
  productId: string,
  category: string | null | undefined,
): boolean {
  switch (regla.scope) {
    case "todos":     return true;
    case "categoria": return !!category && regla.target === category;
    case "producto":  return regla.target === productId;
    default:          return false;
  }
}

/**
 * Ahorro por volumen: por cada producto, el mejor entre el precio 2x y la mejor
 * regla de cantidad que alcance esa cantidad.
 */
export function ahorroPorVolumen(
  lineas: LineaConProducto[],
  precios2x: PreciosPar,
  reglas: ReglaCantidad[],
): ResultadoPromo2x {
  const porProducto = new Map<string, { qty: number; total: number; category?: string | null }>();

  for (const l of lineas) {
    const qty = Math.max(0, Number(l.qty) || 0);
    if (qty === 0) continue;
    const acc = porProducto.get(l.productId) ?? { qty: 0, total: 0, category: l.category };
    acc.qty += qty;
    acc.total += qty * (Number(l.price) || 0);
    if (l.category) acc.category = l.category;
    porProducto.set(l.productId, acc);
  }

  const detalle: DetallePromo2x[] = [];

  for (const [productId, { qty, total, category }] of porProducto) {
    if (qty < 2) continue;

    const precio2x = Number(precios2x[productId]) || 0;
    const unitario = total / qty;
    const pares = Math.floor(qty / 2);
    const ahorro2x = precio2x > 0
      ? Math.max(0, pares * (2 * unitario - precio2x))
      : 0;

    const mejorPct = reglas
      .filter(r => r.min_qty <= qty && reglaAplica(r, productId, category))
      .reduce((max, r) => Math.max(max, Number(r.discount_percent) || 0), 0);
    const ahorroCantidad = (total * mejorPct) / 100;

    const ahorro = Math.max(ahorro2x, ahorroCantidad);
    if (ahorro > 0) detalle.push({ productId, pares, ahorro });
  }

  return {
    total: Math.round(detalle.reduce((s, d) => s + d.ahorro, 0)),
    detalle,
  };
}
