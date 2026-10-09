/**
 * Presentaciones (caja, bulto, pack): un código de barras propio que equivale
 * a N unidades del producto. El stock y el precio siguen siendo por unidad.
 */
export type ProductPresentation = {
  id: string;
  product_id: string;
  name: string;
  factor: number;
  barcode: string | null;
};

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
