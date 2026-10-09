/**
 * Unidad de medida de un producto (`products.unidad_medida`).
 *
 * Un producto por unidad se vende y stockea en enteros. Uno por medida (kg,
 * metro, litro, m²) admite hasta tres decimales; la base lo exige en
 * `record_stock_movement` (20261009000800). Esta capa sólo ayuda a cargar y
 * mostrar la cantidad.
 */

export type UnidadMedida = "unidad" | "kg" | "metro" | "litro" | "m2";

export const UNIDADES_MEDIDA: { value: UnidadMedida; label: string; corta: string }[] = [
  { value: "unidad", label: "Por unidad", corta: "u." },
  { value: "kg", label: "Por kilo", corta: "kg" },
  { value: "metro", label: "Por metro", corta: "m" },
  { value: "litro", label: "Por litro", corta: "l" },
  { value: "m2", label: "Por metro cuadrado", corta: "m²" },
];

export function esUnidadMedida(value: unknown): value is UnidadMedida {
  return UNIDADES_MEDIDA.some(u => u.value === value);
}

export function etiquetaUnidad(value: string | null | undefined): string {
  return UNIDADES_MEDIDA.find(u => u.value === value)?.corta ?? "u.";
}

/** "12,75" o "12.75" → 12.75; `null` si no es una cantidad positiva con hasta 3 decimales. */
export function cantidadMedida(raw: string | number): number | null {
  const texto = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(texto)) return null;
  const valor = Number(texto);
  return valor > 0 ? valor : null;
}

/** Cantidad para mostrar con su unidad: 12.75 metro → "12,75 m"; 3 unidad → "3 u.". */
export function formatoCantidad(cantidad: number, unidad: string | null | undefined): string {
  const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(cantidad);
  return `${numero} ${etiquetaUnidad(unidad)}`;
}

/** Unidad del controlador fiscal Epson para una unidad de medida del producto. */
export function unidadControlador(value: string | null | undefined): "unidad" | "kg" | "metro" | "litro" | "metro2" {
  return value === "kg" ? "kg" : value === "metro" ? "metro" : value === "litro" ? "litro" : value === "m2" ? "metro2" : "unidad";
}

/** Stock o movimiento con hasta tres decimales; la base decide si el producto admite fracciones. */
export function cantidadStockValida(valor: number, { permitirCero = true } = {}): boolean {
  return Number.isFinite(valor) && Math.round(valor * 1000) / 1000 === valor && (permitirCero ? valor >= 0 : valor !== 0);
}
