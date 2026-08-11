/**
 * Listas de precios — qué precio le corresponde a cada cliente.
 *
 * Es la herramienta con la que un comercio vende mayorista, a distribuidores o
 * a clientes VIP sin duplicar el catálogo. La tienen Tiendanube (por "grupo de
 * clientes") y todos los ERP del rubro.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 *
 * Había **dos** implementaciones de la misma cuenta, en dos generaciones de
 * esquema, y no coincidían: el POS leía `price_lists.discount_pct` mientras la
 * página del menú escribía `discount_type`/`discount_value`. Una lista
 * "Mayorista 20%" creada desde el menú le cobraba el precio completo a todo el
 * mundo, en silencio. Ahora la cuenta está acá y las dos superficies la llaman.
 *
 * ── El orden de resolución, y por qué ese ─────────────────────────────────
 *
 *   1. **Precio fijo del producto en la lista** (`custom_price`). Lo más
 *      específico gana: si alguien se tomó el trabajo de escribir "este
 *      producto, en esta lista, vale $X", eso es lo que vale.
 *   2. **Porcentaje propio del producto** (`discount_pct` del ítem). Permite
 *      "la lista es 20%, pero este producto 30%".
 *   3. **Descuento general de la lista** (`discount_type` + `discount_value`).
 *   4. **Precio de lista.** Sin lista, o con una lista que no descuenta.
 *
 * ── Los tramos por cantidad ───────────────────────────────────────────────
 *
 * Cada fila lleva `min_quantity`: "desde 6 unidades, $X; desde 12, $Y". Gana el
 * tramo **más alto que la cantidad alcanza** — con 15 unidades manda el de 12,
 * no el de 6. Sin esto una lista mayorista no sirve, que es para lo que existe.
 *
 * ⚠️ Un descuento fijo se resta **por unidad**, no del total de la línea. Un
 * "-$500" en una lista mayorista significa quinientos pesos menos cada uno; si
 * se restara del total, comprar más lo haría proporcionalmente peor.
 */

export type TipoDescuentoLista = "none" | "percentage" | "fixed";

export interface ListaDePrecios {
  id: string;
  name: string;
  discount_type: TipoDescuentoLista | null;
  discount_value: number | null;
  is_default?: boolean;
  is_active?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ItemDeLista {
  product_id: string;
  /** Precio fijo. Gana sobre cualquier porcentaje. */
  custom_price: number | null;
  /** % propio del producto en esta lista. */
  discount_pct: number | null;
  /** Desde cuántas unidades aplica esta fila. */
  min_quantity: number;
}

export interface PrecioResuelto {
  /** Precio unitario final. */
  precio: number;
  /** De dónde salió, para poder mostrarlo y para poder testearlo. */
  origen: "precio_fijo" | "pct_producto" | "descuento_lista" | "precio_base";
  /** Cuánto se ahorra por unidad contra el precio de lista. */
  ahorroUnitario: number;
}

const redondear = (n: number) => Math.round(n);

/**
 * El tramo que corresponde a esta cantidad: el de mayor `min_quantity` que la
 * cantidad alcanza. Devuelve `null` si el producto no está en la lista o si
 * ningún tramo llega.
 */
export function tramoAplicable(
  items: ItemDeLista[] | null | undefined,
  productId: string,
  cantidad: number,
): ItemDeLista | null {
  const qty = Math.max(1, Math.floor(Number(cantidad) || 1));
  const candidatos = (items ?? [])
    .filter(i => i.product_id === productId && (Number(i.min_quantity) || 1) <= qty)
    .sort((a, b) => (Number(b.min_quantity) || 1) - (Number(a.min_quantity) || 1));
  return candidatos[0] ?? null;
}

/**
 * ¿Esta lista está vigente hoy?
 *
 * Una lista vencida no puede seguir cobrando: el precio mayorista de una
 * temporada no es el de la siguiente. Sin fechas, siempre vigente.
 */
export function listaVigente(
  lista: ListaDePrecios | null | undefined,
  hoy: Date = new Date(),
): boolean {
  if (!lista) return false;
  if (lista.is_active === false) return false;
  const dia = hoy.toISOString().slice(0, 10);
  if (lista.valid_from && dia < lista.valid_from.slice(0, 10)) return false;
  if (lista.valid_until && dia > lista.valid_until.slice(0, 10)) return false;
  return true;
}

/**
 * Precio unitario de un producto para una lista y una cantidad.
 *
 * `precioBase` es el precio de venta normal. Sin lista vigente se devuelve tal
 * cual: una lista rota no puede regalar ni encarecer.
 */
export function precioDeLista(
  precioBase: number,
  lista: ListaDePrecios | null | undefined,
  items: ItemDeLista[] | null | undefined,
  productId: string,
  cantidad = 1,
  hoy: Date = new Date(),
): PrecioResuelto {
  const base = Number(precioBase);
  const limpio = Number.isFinite(base) && base > 0 ? base : 0;
  const sinCambio: PrecioResuelto = { precio: limpio, origen: "precio_base", ahorroUnitario: 0 };

  if (!listaVigente(lista, hoy)) return sinCambio;

  const tramo = tramoAplicable(items, productId, cantidad);

  // 1. Precio fijo: lo más específico gana.
  if (tramo && tramo.custom_price != null && Number(tramo.custom_price) >= 0) {
    const p = redondear(Number(tramo.custom_price));
    return { precio: p, origen: "precio_fijo", ahorroUnitario: Math.max(0, limpio - p) };
  }

  // 2. Porcentaje propio del producto.
  if (tramo && tramo.discount_pct != null && Number(tramo.discount_pct) > 0) {
    const p = redondear(limpio * (1 - Number(tramo.discount_pct) / 100));
    return { precio: p, origen: "pct_producto", ahorroUnitario: Math.max(0, limpio - p) };
  }

  // 3. Descuento general de la lista.
  const tipo = lista?.discount_type ?? "none";
  const valor = Number(lista?.discount_value) || 0;

  if (tipo === "percentage" && valor > 0) {
    const p = redondear(limpio * (1 - Math.min(valor, 100) / 100));
    return { precio: p, origen: "descuento_lista", ahorroUnitario: limpio - p };
  }

  if (tipo === "fixed" && valor > 0) {
    // Por unidad, no del total de la línea. Y nunca por debajo de cero: un
    // precio negativo le devolvería plata al cliente.
    const p = redondear(Math.max(0, limpio - valor));
    return { precio: p, origen: "descuento_lista", ahorroUnitario: limpio - p };
  }

  return sinCambio;
}

/** Cómo se muestra el descuento de una lista en una etiqueta. */
export function etiquetaDescuento(lista: ListaDePrecios | null | undefined): string {
  const tipo = lista?.discount_type ?? "none";
  const valor = Number(lista?.discount_value) || 0;
  if (tipo === "percentage" && valor > 0) return `−${valor}%`;
  if (tipo === "fixed" && valor > 0) return `−$${valor.toLocaleString("es-AR")}`;
  return "Precio de lista";
}
