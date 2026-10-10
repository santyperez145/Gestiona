/**
 * Validación y ejemplo de los ajustes de reposición e IA. Lógica pura: la usan
 * `InventarioIASettings` y la barra de guardado de Ajustes.
 */

/** Defaults de `supabase/functions/ai-offer-recommender`: si cambian allá, acá. */
export const DEFAULTS_RECOMENDADOR = {
  stockDormidoDias: 30,
  maxSobrestock: 10,
  maxDescuentoIa: 35,
  tono: "profesional rioplatense argentino",
} as const;

export type InventarioIAForm = {
  costoPorPedido: string;
  costoAlmacenamientoPct: string;
  stockDormidoDias: string;
  maxSobrestock: string;
  maxDescuentoIa: string;
  tonoIa: string;
};

export const numero = (v: string) => Number(v.trim().replace(",", "."));
export const vacio = (v: string) => v.trim() === "";

/** Errores que bloquean el guardado. Vacío siempre es válido: es «no lo cargué». */
export function erroresInventarioIA(f: InventarioIAForm): string[] {
  const errores: string[] = [];
  const entre = (v: string, min: number, max: number, entero: boolean, nombre: string) => {
    if (vacio(v)) return;
    const n = numero(v);
    if (!Number.isFinite(n)) errores.push(`${nombre}: no es un número.`);
    else if (n < min || n > max) errores.push(`${nombre}: tiene que estar entre ${min} y ${max}.`);
    else if (entero && !Number.isInteger(n)) errores.push(`${nombre}: tiene que ser un número entero.`);
  };
  entre(f.costoPorPedido, 0, 100_000_000, false, "Costo por pedido");
  entre(f.costoAlmacenamientoPct, 0.1, 100, false, "Costo de almacenamiento");
  entre(f.stockDormidoDias, 1, 3650, true, "Días para considerar stock dormido");
  entre(f.maxSobrestock, 0, 1_000_000, true, "Unidades de sobrestock");
  entre(f.maxDescuentoIa, 0, 90, false, "Descuento máximo de la IA");
  if (f.tonoIa.trim().length > 120) errores.push("Tono de la IA: máximo 120 caracteres.");
  return errores;
}

/**
 * Lote óptimo de un producto de ejemplo con los valores cargados, con la misma
 * fórmula que `run_abc_analysis`: √(2·D·S / (C·i)). Sirve para que el número
 * que se carga tenga una consecuencia visible antes de guardar.
 */
export function loteOptimoDeEjemplo(costoPedido: number, almacenamientoPct: number, ventasMensuales = 100, costoUnitario = 1000): number | null {
  if (!(costoPedido > 0) || !(almacenamientoPct > 0)) return null;
  return Math.ceil(Math.sqrt((2 * ventasMensuales * 12 * costoPedido) / (costoUnitario * almacenamientoPct / 100)));
}
