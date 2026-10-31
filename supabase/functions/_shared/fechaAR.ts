/**
 * El día en Argentina para las funciones del servidor (2026-10-30). Espejo de
 * src/lib/fechaAR.ts: Deno no importa `@/`.
 *
 * Las funciones calculaban «hoy» con el día en UTC (ISO, diez caracteres): de
 * 21 a 24 h en Argentina ya es mañana. Desde 20261030001800 la base también
 * trabaja con el día argentino, así que las dos puntas coinciden.
 */

const ZONA = "America/Argentina/Buenos_Aires";
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });

/** AAAA-MM-DD en Argentina para un instante (por defecto, ahora). */
export function diaAR(instante: Date | number = new Date()): string {
  const d = instante instanceof Date ? instante : new Date(instante);
  return Number.isNaN(d.getTime()) ? "" : DIA.format(d);
}

/** Hoy en Argentina, AAAA-MM-DD. */
export function hoyAR(): string {
  return diaAR(new Date());
}

/** El día argentino de hace (o dentro de) `dias` días, AAAA-MM-DD. */
export function diaARMas(dias: number, desde: Date | number = Date.now()): string {
  const base = desde instanceof Date ? desde.getTime() : desde;
  return diaAR(base + dias * 86_400_000);
}
