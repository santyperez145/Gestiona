/**
 * El día y el mes en Argentina (2026-10-15).
 *
 * 85 lugares en 42 archivos calculaban «hoy» con el día en UTC (ISO, diez
 * caracteres): de 21 a 24 h en Argentina ya es mañana. A esa hora el
 * inicio mostraba $0 vendidos hoy, los vencimientos de hoy figuraban vencidos
 * y un gasto cargado a la noche quedaba con fecha de mañana.
 */

const ZONA = "America/Argentina/Buenos_Aires";
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * AAAA-MM-DD en Argentina. Una fecha sin hora («2026-10-15») ya es un día y se
 * devuelve tal cual: convertirla la correría al día anterior.
 */
export function diaAR(fecha: Date | string | number | null | undefined = new Date()): string {
  if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const d = fecha instanceof Date ? fecha : new Date(fecha ?? "");
  return Number.isNaN(d.getTime()) ? "" : DIA.format(d);
}

/** Hoy en Argentina, AAAA-MM-DD. */
export function hoyAR(): string {
  return diaAR(new Date());
}

/** Este mes en Argentina, AAAA-MM. */
export function mesAR(): string {
  return hoyAR().slice(0, 7);
}
