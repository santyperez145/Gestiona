/**
 * Celda de CSV, escapada y sin fórmulas.
 *
 * Vivía adentro de `identityExport.ts` y la usaba una sola pantalla. Se saca
 * acá porque la regla del repo —toda exportación de datos operativos escapa el
 * contenido y neutraliza lo que Excel leería como fórmula— no es de un módulo:
 * es de cualquier archivo que el comercio abra después.
 *
 * El caso que la hace necesaria dejó de ser hipotético el 2026-08-25: desde que
 * las categorías son texto que escribe el comercio, un nombre con coma parte la
 * fila en dos columnas y corre el resto del renglón.
 */
export function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  // Excel and Sheets interpret values beginning with these characters as
  // formulas. An internal export must remain data when someone opens it.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
