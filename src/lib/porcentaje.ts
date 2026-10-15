/**
 * Un porcentaje como se escribe en Argentina: «30,2 %» → «30,2%» (2026-10-15).
 * 127 lugares lo mostraban con `toFixed(1)` y punto decimal («30.2%»), al lado
 * de montos con coma decimal.
 */
export function fmtPct(n: number, decimales = 1): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;
}
