/**
 * Interpreta una fecha de negocio sin desplazar `YYYY-MM-DD` a UTC.
 *
 * PostgreSQL entrega columnas `date` sin zona horaria. `new Date('2026-09-06')`
 * las trata como UTC y en Argentina cae durante el día anterior; usar mediodía
 * local conserva el día civil y sigue aceptando timestamps completos.
 */
export function businessDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00`
    : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Rango civil inclusivo; sin filtro acepta cualquier fecha, incluso vacía. */
export function businessDateInRange(
  value: string | Date | null | undefined,
  from?: Date,
  to?: Date,
): boolean {
  if (!from && !to) return true;
  const date = businessDate(value);
  if (!date) return false;
  if (from) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    if (date < start) return false;
  }
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
}
