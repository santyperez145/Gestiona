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
  productId?: string | null;
}

export interface ProductoDeCaja {
  id: string;
  name: string;
}

export interface PlanDePresupuesto<P extends ProductoDeCaja> {
  /** Un renglón por producto (si el presupuesto lo repite, se suman las cantidades). */
  lineas: Array<{ producto: P; cantidad: number; precio: number }>;
  /** Lo que no se cargó y por qué, para decírselo al cajero. */
  faltantes: Array<{ descripcion: string; motivo: string }>;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");

export function planDePresupuesto<P extends ProductoDeCaja>(
  items: ItemDePresupuesto[],
  productos: P[],
  variantesPorProducto: Record<string, unknown[] | undefined>,
): PlanDePresupuesto<P> {
  const porId = new Map(productos.map(p => [p.id, p]));
  const porNombre = new Map<string, P | null>();
  for (const p of productos) {
    const k = normalizar(p.name);
    // Dos productos con el mismo nombre: no se elige uno a ciegas.
    porNombre.set(k, porNombre.has(k) ? null : p);
  }

  const lineas = new Map<string, { producto: P; cantidad: number; precio: number }>();
  const faltantes: PlanDePresupuesto<P>["faltantes"] = [];
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
    if ((variantesPorProducto[producto.id]?.length ?? 0) > 0) {
      faltantes.push({ descripcion, motivo: "tiene variantes: elegila en la caja" });
      continue;
    }
    const precio = Math.max(0, Number(item.unitPrice) || 0);
    const previa = lineas.get(producto.id);
    if (previa) previa.cantidad += cantidad;
    else lineas.set(producto.id, { producto, cantidad, precio });
  }
  return { lineas: [...lineas.values()], faltantes };
}
