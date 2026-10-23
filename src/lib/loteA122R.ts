/**
 * Lote de importación A-122R de ARBA (2026-10-22): las retenciones de
 * Ingresos Brutos practicadas en el período, para «Emisión Comprobante de
 * Retención» › «Carga por lote». Desde el 1/12/2025 (RN ARBA 22/2025) el
 * comprobante de la retención lo genera ARBA (A-122R) con estos datos; el
 * agente ya no emite el suyo.
 *
 * Diseño oficial («Diseño de registros de lotes de importación A-122R», en
 * arba.gov.ar, vigente desde el 1/3/2026), Alta de retenciones:
 *   Nro. transacción agente  num 20   1–20   (único por actividad y período)
 *   CUIT del retenido        num 11  21–31
 *   Sucursal                 num  5  32–36   (> 0, ceros a la izquierda)
 *   Fecha de operación       fecha 10 37–46  (dd/mm/aaaa, dentro del período)
 *   Alícuota                 num  5  47–51   (99.99, > 0)
 *   Base imponible           num 16  52–67   (9999999999999.99, > 0)
 * Las longitudes de importes cuentan el separador decimal. El lote es un .zip
 * (sin hash) con un .txt adentro, ambos con el nombre
 * ER-CUIT-PERIODO-ACTIVIDAD-LOTEXXXXX; el período es aaaammq (q = 0 mensual,
 * 1 y 2 quincenas).
 */

export const LARGO_REGISTRO_A122R = 67;
/** Retenciones del régimen general. */
export const ACTIVIDAD_RETENCIONES = "6";

export interface RetencionParaLote {
  transaccion: number;
  cuit: string;
  fecha: string; // aaaa-mm-dd
  alicuota: number;
  base: number;
  sucursal?: number;
}

export type Quincena = 0 | 1 | 2;

const ceros = (n: number | string, largo: number) => String(n).padStart(largo, "0");
const decimal = (n: number, largo: number) => {
  const t = (Math.round(n * 100) / 100).toFixed(2);
  if (t.length > largo) throw new Error(`El importe ${t} no entra en ${largo} posiciones.`);
  return t.padStart(largo, "0");
};
const fechaArba = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Una línea de alta, o el motivo por el que no puede ir en el lote. */
export function registroA122R(r: RetencionParaLote): string {
  const cuit = r.cuit.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw new Error(`La retención ${r.transaccion} no tiene un CUIT válido.`);
  if (!Number.isInteger(r.transaccion) || r.transaccion <= 0) throw new Error("Falta el número de transacción.");
  if (!(r.alicuota > 0 && r.alicuota < 100)) throw new Error(`La retención ${r.transaccion} tiene una alícuota fuera de rango.`);
  if (!(r.base > 0)) throw new Error(`La retención ${r.transaccion} no tiene base imponible.`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(r.fecha)) throw new Error(`La retención ${r.transaccion} no tiene fecha.`);
  const linea = ceros(r.transaccion, 20) + cuit + ceros(r.sucursal ?? 1, 5) + fechaArba(r.fecha) + decimal(r.alicuota, 5) + decimal(r.base, 16);
  if (linea.length !== LARGO_REGISTRO_A122R) throw new Error("El registro no tiene el largo del diseño de ARBA.");
  return linea;
}

/** El período del lote y las fechas que abarca. */
export function periodoA122R(anio: number, mes: number, quincena: Quincena) {
  const mm = String(mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${anio}-${mm}-${quincena === 2 ? "16" : "01"}`;
  const hasta = `${anio}-${mm}-${quincena === 1 ? "15" : String(ultimo).padStart(2, "0")}`;
  return { codigo: `${anio}${mm}${quincena}`, desde, hasta };
}

export function nombreLoteA122R(cuitAgente: string, periodo: string, lote = 1, actividad = ACTIVIDAD_RETENCIONES): string {
  const cuit = cuitAgente.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw new Error("Falta el CUIT del comercio en Datos fiscales.");
  return `ER-${cuit}-${periodo}-${actividad}-LOTE${ceros(lote, 5)}`;
}

/** El texto del lote, ordenado por fecha y transacción, con fin de línea CRLF. */
export function textoLoteA122R(retenciones: RetencionParaLote[]): string {
  return [...retenciones]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.transaccion - b.transaccion)
    .map(registroA122R)
    .join("\r\n");
}

/** El .zip listo para subir: un .txt con el mismo nombre que el lote. */
export async function zipLoteA122R(nombre: string, texto: string): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(`${nombre}.txt`, texto);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
