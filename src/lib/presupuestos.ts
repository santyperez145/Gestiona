/**
 * Presupuestos (rearmado 2026-10-14): renglones atados al catálogo, con la
 * misma cuenta que hace la base en `guardar_presupuesto` (20261014001000).
 * La base recalcula y es la que manda; esto es para mostrar lo mismo antes de
 * guardar.
 */

export interface RenglonPresupuesto {
  /** Clave estable en pantalla (no se guarda). */
  clave: string;
  productId: string | null;
  variantId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  sku?: string | null;
  /** «unidad», «kg», «metro»…: las medidas aceptan decimales. */
  unidad?: string | null;
}

/** Lo que guarda `quotes.items` (claves que leen PDF, link de pago y caja). */
export interface ItemGuardado {
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
  discountPct?: number;
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  unidad?: string | null;
}

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function nuevaClave(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Math.random().toString(36).slice(2)}`;
}

export function totalDeRenglon(r: Pick<RenglonPresupuesto, "qty" | "unitPrice" | "discountPct">): number {
  const qty = Math.max(0, Number(r.qty) || 0);
  const precio = Math.max(0, Number(r.unitPrice) || 0);
  const pct = Math.min(100, Math.max(0, Number(r.discountPct) || 0));
  return centavos(qty * precio * (1 - pct / 100));
}

export function totalesDePresupuesto(renglones: RenglonPresupuesto[], descuentoGeneral: number) {
  const subtotal = centavos(renglones.reduce((s, r) => s + totalDeRenglon(r), 0));
  const descuento = centavos(Math.min(Math.max(0, Number(descuentoGeneral) || 0), subtotal));
  return { subtotal, descuento, total: centavos(subtotal - descuento) };
}

/** Lo que hay que corregir antes de guardar, en castellano; vacío = se puede guardar. */
export function problemasDelPresupuesto(cliente: string, renglones: RenglonPresupuesto[], descuentoGeneral: number): string[] {
  const out: string[] = [];
  if (!cliente.trim()) out.push("Elegí o escribí el cliente.");
  const conContenido = renglones.filter(r => r.productId || r.description.trim());
  if (conContenido.length === 0) out.push("Agregá al menos un ítem.");
  conContenido.forEach((r, i) => {
    const nombre = r.description.trim() || `Ítem ${i + 1}`;
    if (!(Number(r.qty) > 0)) out.push(`${nombre}: la cantidad tiene que ser mayor a cero.`);
    if (!(Number(r.unitPrice) >= 0)) out.push(`${nombre}: revisá el precio.`);
    if (Number(r.discountPct) < 0 || Number(r.discountPct) > 100) out.push(`${nombre}: el descuento va de 0 a 100 %.`);
    if (!r.productId && !r.description.trim()) out.push(`Ítem ${i + 1}: falta la descripción.`);
  });
  const { subtotal } = totalesDePresupuesto(conContenido, 0);
  if (Number(descuentoGeneral) > subtotal) out.push("El descuento general supera el subtotal.");
  return out;
}

export function aItemsGuardados(renglones: RenglonPresupuesto[]): ItemGuardado[] {
  return renglones
    .filter(r => r.productId || r.description.trim())
    .map(r => ({
      description: r.description.trim(),
      qty: Number(r.qty),
      unitPrice: centavos(Number(r.unitPrice) || 0),
      discountPct: Number(r.discountPct) || 0,
      total: totalDeRenglon(r),
      productId: r.productId,
      variantId: r.variantId,
    }));
}

export function deItemsGuardados(items: Array<Partial<ItemGuardado>> | null | undefined): RenglonPresupuesto[] {
  return (items ?? []).map(it => ({
    clave: nuevaClave(),
    productId: it.productId ?? null,
    variantId: it.variantId ?? null,
    description: it.description ?? "",
    qty: Number(it.qty) || 1,
    unitPrice: Number(it.unitPrice) || 0,
    discountPct: Number(it.discountPct) || 0,
    sku: it.sku ?? null,
    unidad: it.unidad ?? null,
  }));
}

/** El producto cuyo código (barras, SKU o alternativo) es exactamente éste. */
export function productoPorCodigo<P extends { sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null }>(
  productos: P[], codigo: string,
): P | null {
  const c = codigo.trim().toLowerCase();
  if (!c) return null;
  return productos.find(p =>
    (p.barcode ?? "").trim().toLowerCase() === c
    || (p.sku ?? "").trim().toLowerCase() === c
    || (p.barcode_aliases ?? []).some(a => (a ?? "").trim().toLowerCase() === c),
  ) ?? null;
}

/** «Stock: 3 metros» cuando lo presupuestado supera lo que hay (sólo si maneja stock). */
export function avisoDeStock(qty: number, stock: number | null | undefined, manejaStock: boolean | null | undefined, unidad?: string | null): string | null {
  if (manejaStock === false || stock === null || stock === undefined) return null;
  if (Number(qty) <= Number(stock)) return null;
  const u = unidad && unidad !== "unidad" ? ` ${unidad}` : "";
  return Number(stock) <= 0 ? "Sin stock ahora" : `Hay ${Number(stock).toLocaleString("es-AR")}${u}`;
}

/** Las medidas (kg, metro, litro, m²) aceptan tres decimales; las unidades, enteros. */
export function pasoParaCantidad(unidad?: string | null): string {
  return unidad && unidad !== "unidad" ? "0.001" : "1";
}
