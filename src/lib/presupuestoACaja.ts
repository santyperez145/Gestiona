/**
 * Presupuesto → caja (2026-10-14, migración 20261014000900). «Convertir en
 * venta» abre la caja con el presupuesto cargado y el cobro pasa por la venta
 * real (stock, caja, factura y topes de descuento). Esto decide qué renglones
 * se pueden cargar y cuáles no, sin adivinar.
 */

export interface ItemDePresupuesto {
  description: string;
  qty: number;
  unitPrice: number;
  /** Descuento del renglón (editor 2026-10-14): la caja cobra el precio ya descontado. */
  discountPct?: number | null;
  productId?: string | null;
  variantId?: string | null;
}

export interface ProductoDeCaja {
  id: string;
  name: string;
}

export interface PlanDePresupuesto<P extends ProductoDeCaja, V extends { id: string } = { id: string }> {
  /**
   * Un renglón por producto y variante (si el presupuesto lo repite, se suman
   * las cantidades). `precio` es el del presupuesto ya descontado;
   * `descuentoPct`, el descuento del renglón, para aplicarlo igual a precios de hoy.
   */
  lineas: Array<{ producto: P; variante: V | null; cantidad: number; precio: number; descuentoPct: number }>;
  /** Lo que no se cargó y por qué, para decírselo al cajero. */
  faltantes: Array<{ descripcion: string; motivo: string }>;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");

export function planDePresupuesto<P extends ProductoDeCaja, V extends { id: string } = { id: string }>(
  items: ItemDePresupuesto[],
  productos: P[],
  variantesPorProducto: Record<string, V[] | undefined>,
): PlanDePresupuesto<P, V> {
  const porId = new Map(productos.map(p => [p.id, p]));
  const porNombre = new Map<string, P | null>();
  for (const p of productos) {
    const k = normalizar(p.name);
    // Dos productos con el mismo nombre: no se elige uno a ciegas.
    porNombre.set(k, porNombre.has(k) ? null : p);
  }

  const lineas = new Map<string, { producto: P; variante: V | null; cantidad: number; precio: number; descuentoPct: number }>();
  const faltantes: PlanDePresupuesto<P, V>["faltantes"] = [];
  for (const item of items ?? []) {
    const descripcion = (item.description ?? "").trim() || "Ítem sin descripción";
    const cantidad = Number(item.qty);
    if (!(cantidad > 0)) { faltantes.push({ descripcion, motivo: "no tiene cantidad" }); continue; }
    let producto: P | null | undefined;
    if (item.productId) {
      producto = porId.get(item.productId);
      if (!producto) { faltantes.push({ descripcion, motivo: "el producto ya no está en el catálogo" }); continue; }
    } else {
      producto = porNombre.get(normalizar(descripcion));
      if (producto === null) { faltantes.push({ descripcion, motivo: "hay más de un producto con ese nombre" }); continue; }
      if (!producto) { faltantes.push({ descripcion, motivo: "no está en el catálogo" }); continue; }
    }
    const variantes = variantesPorProducto[producto.id] ?? [];
    let variante: V | null = null;
    if (variantes.length > 0) {
      variante = item.variantId ? variantes.find(v => v.id === item.variantId) ?? null : null;
      if (!variante) {
        faltantes.push({ descripcion, motivo: item.variantId ? "la variante ya no está disponible" : "tiene variantes: elegila en la caja" });
        continue;
      }
    }
    const pct = Math.min(100, Math.max(0, Number(item.discountPct) || 0));
    const precio = Math.round(Math.max(0, Number(item.unitPrice) || 0) * (1 - pct / 100) * 100) / 100;
    const clave = variante ? `${producto.id}__${variante.id}` : producto.id;
    const previa = lineas.get(clave);
    if (previa) previa.cantidad += cantidad;
    else lineas.set(clave, { producto, variante, cantidad, precio, descuentoPct: pct });
  }
  return { lineas: [...lineas.values()], faltantes };
}

/** Lo que vale hoy un renglón: el precio vigente con el mismo descuento que tenía en el presupuesto. */
export function precioDeHoy(
  producto: { sale_price_ars?: number | null; discount_price_ars?: number | null },
  variante: { price_override?: number | null } | null,
  descuentoPct: number,
): number {
  const override = Number(variante?.price_override) || 0;
  const oferta = Number(producto.discount_price_ars) || 0;
  const lista = override > 0 ? override : oferta > 0 ? oferta : Number(producto.sale_price_ars) || 0;
  const pct = Math.min(100, Math.max(0, Number(descuentoPct) || 0));
  return Math.round(Math.max(0, lista) * (1 - pct / 100) * 100) / 100;
}

/**
 * Con inflación, un presupuesto vencido cobrado a sus precios es plata que se
 * pierde. Esto compara el total presupuestado con el de hoy para que la caja
 * pregunte en vez de cobrar el precio viejo sin avisar.
 */
export function comparacionConHoy<L extends { cantidad: number; precio: number }>(
  lineas: L[],
  hoy: (linea: L) => number,
): { presupuestado: number; hoy: number; subieron: number } {
  let presupuestado = 0;
  let total = 0;
  let subieron = 0;
  for (const linea of lineas) {
    const actual = hoy(linea);
    presupuestado += linea.precio * linea.cantidad;
    total += actual * linea.cantidad;
    if (actual > linea.precio) subieron += 1;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { presupuestado: r(presupuestado), hoy: r(total), subieron };
}
