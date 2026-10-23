/**
 * Lote de percepciones de Ingresos Brutos para ARBA (2026-10-23): las
 * percepciones de las facturas autorizadas del período, para «Agentes de
 * Recaudación» (ARWeb) › carga por lote, actividad 7 método devengado.
 *
 * Diseño oficial («Anexo Nuevos Diseño de registros de lotes de
 * importación», ARBA), 1.1 Percepciones, 71 posiciones:
 *   1–13 CUIT del percibido (99-99999999-9) · 14–23 fecha (dd/mm/aaaa) ·
 *   24 tipo de comprobante (F factura, C nota de crédito, D nota de débito,
 *   E/H/I sus versiones de crédito electrónica) · 25 letra (A, B, C o blanco) ·
 *   26–30 sucursal · 31–38 número · 39–52 monto imponible (99999999999.99) ·
 *   53–57 alícuota (99.99) · 58–70 importe (9999999999.99) · 71 tipo de
 *   operación (A alta).
 * En las notas de crédito, base e importe van negativos con el signo en la
 * primera posición. Los largos de importes cuentan el separador decimal.
 *
 * Nombre: AR-CUIT-AAAAMMQ-D7-LOTE1 para el .txt, y el .zip que lo contiene
 * lleva además el MD5 del .zip (lo que hace el GenHash de ARBA):
 * AR-CUIT-AAAAMMQ-D7-LOTE1_<md5>.zip.
 */
import { md5Hex } from "@/lib/md5";

export const LARGO_PERCEPCION_ARBA = 71;
export const ACTIVIDAD_PERCEPCIONES_DEVENGADO = "D7";

export interface PercepcionArba {
  cuit: string;
  fecha: string; // aaaa-mm-dd
  tipoArca: number;
  puntoVenta: number;
  numero: number;
  base: number;
  alicuota: number;
  importe: number;
}

const CODIGO: Record<number, { tipo: string; letra: string; nc: boolean }> = {
  1: { tipo: "F", letra: "A", nc: false }, 6: { tipo: "F", letra: "B", nc: false }, 11: { tipo: "F", letra: "C", nc: false },
  2: { tipo: "D", letra: "A", nc: false }, 7: { tipo: "D", letra: "B", nc: false }, 12: { tipo: "D", letra: "C", nc: false },
  3: { tipo: "C", letra: "A", nc: true }, 8: { tipo: "C", letra: "B", nc: true }, 13: { tipo: "C", letra: "C", nc: true },
  201: { tipo: "E", letra: "A", nc: false }, 206: { tipo: "E", letra: "B", nc: false }, 211: { tipo: "E", letra: "C", nc: false },
  202: { tipo: "I", letra: "A", nc: false }, 207: { tipo: "I", letra: "B", nc: false }, 212: { tipo: "I", letra: "C", nc: false },
  203: { tipo: "H", letra: "A", nc: true }, 208: { tipo: "H", letra: "B", nc: true }, 213: { tipo: "H", letra: "C", nc: true },
};

const conSigno = (n: number, negativo: boolean, largo: number, campo: string) => {
  const t = (Math.round(Math.abs(n) * 100) / 100).toFixed(2);
  const cuerpo = negativo ? "-" + t.padStart(largo - 1, "0") : t.padStart(largo, "0");
  if (cuerpo.length > largo) throw new Error(`${campo}: ${t} no entra en ${largo} posiciones.`);
  return cuerpo;
};

export function registroPercepcionArba(p: PercepcionArba): string {
  const c = CODIGO[p.tipoArca];
  if (!c) throw new Error(`El comprobante ${p.puntoVenta}-${p.numero} es de un tipo que ARBA no admite en percepciones.`);
  const cuit = p.cuit.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw new Error(`El comprobante ${p.puntoVenta}-${p.numero} no tiene la CUIT del cliente.`);
  if (!(p.base > 0 && p.importe > 0)) throw new Error(`El comprobante ${p.puntoVenta}-${p.numero} no tiene base o importe de percepción.`);
  if (!(p.alicuota > 0 && p.alicuota < 100)) throw new Error(`El comprobante ${p.puntoVenta}-${p.numero} tiene una alícuota fuera de rango.`);
  if (!(p.puntoVenta > 0 && p.puntoVenta <= 99999 && p.numero > 0 && p.numero <= 99999999)) throw new Error(`Número de comprobante inválido: ${p.puntoVenta}-${p.numero}.`);
  const linea = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
    + p.fecha.slice(0, 10).split("-").reverse().join("/") + c.tipo + c.letra
    + String(p.puntoVenta).padStart(5, "0") + String(p.numero).padStart(8, "0")
    + conSigno(p.base, c.nc, 14, "Monto imponible") + (Math.round(p.alicuota * 100) / 100).toFixed(2).padStart(5, "0")
    + conSigno(p.importe, c.nc, 13, "Importe de percepción") + "A";
  if (linea.length !== LARGO_PERCEPCION_ARBA) throw new Error("El registro no tiene el largo del diseño de ARBA.");
  return linea;
}

export function nombreLotePercepcionesArba(cuitAgente: string, periodo: string, lote = 1): string {
  const cuit = cuitAgente.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) throw new Error("Falta el CUIT del comercio en Datos fiscales.");
  return `AR-${cuit}-${periodo}-${ACTIVIDAD_PERCEPCIONES_DEVENGADO}-LOTE${lote}`;
}

/** El .txt (ordenado por fecha, CRLF), empaquetado en .zip y nombrado con su MD5. */
export async function zipLotePercepcionesArba(nombre: string, percepciones: PercepcionArba[]): Promise<{ archivo: string; zip: Blob }> {
  const texto = [...percepciones].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(registroPercepcionArba).join("\r\n");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  // Fecha fija: el mismo lote da siempre el mismo .zip y el mismo MD5.
  zip.file(`${nombre}.txt`, texto, { date: new Date(Date.UTC(2026, 0, 1)) });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { archivo: `${nombre}_${md5Hex(bytes)}.zip`, zip: new Blob([bytes], { type: "application/zip" }) };
}

const NOMBRES: Record<"ARBA" | "AGIP", RegExp> = { ARBA: /ARBA|Buenos Aires/i, AGIP: /AGIP|CABA|Ciudad/i };

/**
 * Las percepciones de IIBB (tributo 7) de una jurisdicción en los tributos de
 * una factura: las que la nombran, o las que no nombran a la otra si el padrón
 * del agente es el de esa jurisdicción (una percepción cargada a mano puede
 * decir sólo «Percepción IIBB»).
 */
export function percepcionesDeJurisdiccion(tributos: unknown, jurisdiccion: "ARBA" | "AGIP", padronDelAgente: string | null): { base: number; alicuota: number; importe: number }[] {
  if (!Array.isArray(tributos)) return [];
  const otra = jurisdiccion === "ARBA" ? "AGIP" : "ARBA";
  return tributos
    .filter((t): t is { tipo: number; descripcion?: string; base: number; alicuota: number; importe: number } => !!t && typeof t === "object" && Number((t as { tipo?: unknown }).tipo) === 7)
    .filter(t => NOMBRES[jurisdiccion].test(t.descripcion ?? "") || (padronDelAgente === jurisdiccion && !NOMBRES[otra].test(t.descripcion ?? "")))
    .map(t => ({ base: Number(t.base), alicuota: Number(t.alicuota), importe: Number(t.importe) }))
    .filter(t => t.importe > 0 && t.base > 0);
}
