import { redondearMoneda } from "@/lib/rounding";

/**
 * Presentaciones (caja, bulto, pack): un código de barras propio que equivale
 * a N unidades del producto. El stock sigue siendo por unidad.
 *
 * Desde 20261009001500 una presentación puede tener precio propio
 * (`price_ars`, la caja completa). Quien decide si se cobra es la base
 * (`precio_presentacion_autoritativo`); estas funciones son su espejo para
 * mostrar en pantalla el mismo número que se va a cobrar.
 */
export type ProductPresentation = {
  id: string;
  product_id: string;
  name: string;
  factor: number;
  barcode: string | null;
  /** Precio de la caja completa. null/undefined = sin precio propio (o migración sin aplicar). */
  price_ars?: number | null;
};

/** Precio por unidad dentro de la caja, redondeado como la base (ARS, 2 decimales). */
export function precioUnitarioDeCaja(p: Pick<ProductPresentation, "factor" | "price_ars">): number | null {
  const precio = Number(p.price_ars);
  const factor = Number(p.factor);
  if (!(precio > 0) || !(factor > 0)) return null;
  return redondearMoneda(precio / factor, "ARS");
}

/**
 * El precio por unidad que la base va a cobrar por esta caja, o null si no
 * aplica. Mismas reglas que la base: hay que llevarse al menos una caja, y la
 * caja sólo puede mejorar el precio del suelto.
 */
export function precioDeCajaQueAplica(
  p: Pick<ProductPresentation, "factor" | "price_ars">,
  cantidad: number,
  precioSuelto: number,
): number | null {
  const unitario = precioUnitarioDeCaja(p);
  if (unitario === null) return null;
  if (cantidad + 0.0005 < Number(p.factor)) return null;
  return unitario < precioSuelto ? unitario : null;
}

/** Busca la presentación cuyo código coincide con lo escaneado. */
export function presentacionPorCodigo<T extends Pick<ProductPresentation, "barcode">>(
  presentaciones: T[],
  codigo: string,
): T | null {
  const limpio = codigo.trim();
  if (!limpio) return null;
  return presentaciones.find(p => p.barcode === limpio) ?? null;
}

/** "Caja x12", "Horma 4,5 kg": factor con la unidad del producto. */
export function etiquetaPresentacion(p: Pick<ProductPresentation, "name" | "factor">, unidad = "unidad"): string {
  const factor = Number(p.factor).toLocaleString("es-AR", { maximumFractionDigits: 3 });
  const sufijo = unidad === "unidad" ? `${factor} u.` : `${factor} ${unidad}`;
  return `${p.name} (${sufijo})`;
}

/** Error de carga o null. */
export function errorPresentacion(nombre: string, factor: number, unidad: string): string | null {
  if (!nombre.trim()) return "Poné un nombre (ej. Caja x12)";
  if (!Number.isFinite(factor) || factor <= 0) return "La cantidad debe ser mayor a cero";
  if (unidad === "unidad" && !Number.isInteger(factor)) return "Este producto se vende por unidad: la presentación lleva unidades enteras";
  if (Math.round(factor * 1000) !== factor * 1000) return "Hasta tres decimales";
  return null;
}

/** Error del precio de la caja, o null. Vacío es válido: sin precio propio. */
export function errorPrecioPresentacion(precio: string): string | null {
  const limpio = precio.trim().replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return "El precio de la caja tiene que ser mayor a cero";
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return "Hasta dos decimales";
  return null;
}
