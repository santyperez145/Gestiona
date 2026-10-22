/**
 * Las clases de comprobante de ARCA, en un solo lugar (2026-10-22).
 *
 * Las listas `[3, 8, 13]` («es nota de crédito») y `[11, 12, 13]` («es C»)
 * estaban repetidas en ocho archivos. Con la Factura de Crédito Electrónica
 * MiPyME (201 a 213) cada una tenía que crecer igual en todos lados; con una
 * sola fuente no se puede olvidar ninguna.
 */

/** Facturas: A, B, C, sus equivalentes de crédito MiPyME y la de exportación E (19). */
export const FACTURAS = new Set([1, 6, 11, 201, 206, 211, 19]);
export const NOTAS_DE_DEBITO = new Set([2, 7, 12, 202, 207, 212, 20]);
export const NOTAS_DE_CREDITO = new Set([3, 8, 13, 203, 208, 213, 21]);

/** Exportación (WSFEX): factura E, nota de débito y nota de crédito. */
export const EXPORTACION = new Set([19, 20, 21]);

/** Clase A: discrimina IVA y exige el CUIT del receptor. */
export const CLASE_A = new Set([1, 2, 3, 201, 202, 203]);
/** Clase C: no discrimina IVA ni separa exento o no gravado. */
export const CLASE_C = new Set([11, 12, 13, 211, 212, 213]);

/** Factura de Crédito Electrónica MiPyME (RG 4367). */
export const FCE = new Set([201, 202, 203, 206, 207, 208, 211, 212, 213]);
export const FCE_FACTURAS = new Set([201, 206, 211]);

export const esNotaDeCredito = (tipo: unknown) => NOTAS_DE_CREDITO.has(Number(tipo));
export const esNotaDeDebito = (tipo: unknown) => NOTAS_DE_DEBITO.has(Number(tipo));
export const esClaseA = (tipo: unknown) => CLASE_A.has(Number(tipo));
export const esClaseC = (tipo: unknown) => CLASE_C.has(Number(tipo));
export const esFce = (tipo: unknown) => FCE.has(Number(tipo));

/** La factura de la que sale cada nota (misma clase; FCE con FCE). */
export const FACTURA_DE_LA_NOTA: Record<number, number> = {
  2: 1, 3: 1, 7: 6, 8: 6, 12: 11, 13: 11,
  202: 201, 203: 201, 207: 206, 208: 206, 212: 211, 213: 211,
  20: 19, 21: 19,
};

export const NOMBRE_DE_COMPROBANTE: Record<number, string> = {
  1: "Factura A", 2: "Nota de débito A", 3: "Nota de crédito A",
  6: "Factura B", 7: "Nota de débito B", 8: "Nota de crédito B",
  11: "Factura C", 12: "Nota de débito C", 13: "Nota de crédito C",
  201: "Factura de Crédito Electrónica MiPyME A", 202: "Nota de débito electrónica MiPyME A", 203: "Nota de crédito electrónica MiPyME A",
  206: "Factura de Crédito Electrónica MiPyME B", 207: "Nota de débito electrónica MiPyME B", 208: "Nota de crédito electrónica MiPyME B",
  211: "Factura de Crédito Electrónica MiPyME C", 212: "Nota de débito electrónica MiPyME C", 213: "Nota de crédito electrónica MiPyME C",
  19: "Factura de exportación E", 20: "Nota de débito de exportación E", 21: "Nota de crédito de exportación E",
};

/** Letra del comprobante: A, B o C (la FCE conserva la de su clase). */
export function letraDeComprobante(tipo: unknown): "A" | "B" | "C" | null {
  const t = Number(tipo);
  if (CLASE_A.has(t)) return "A";
  if (CLASE_C.has(t)) return "C";
  if ([6, 7, 8, 206, 207, 208].includes(t)) return "B";
  return null;
}
