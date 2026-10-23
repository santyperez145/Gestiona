/**
 * Archivos de importación de e-ARCIBA (AGIP) para el agente de recaudación de
 * Ingresos Brutos de la Ciudad (2026-10-23): retenciones y percepciones del
 * mes, y las notas de crédito que las reducen.
 *
 * Diseños oficiales de AGIP («Diseño de Registro de Importación de
 * Retenciones/Percepciones» y «… de Notas de Crédito», vigentes desde el
 * período enero de 2022): campos de largo fijo, los números alineados a la
 * derecha con ceros, los textos a la izquierda con blancos, importes con dos
 * decimales y coma, ordenado por fecha y guardado en UTF-8.
 *
 * Retenciones/percepciones (226 posiciones):
 *   1 tipo de operación (1 retención, 2 percepción) · 2–4 código de norma ·
 *   5–14 fecha · 15–16 tipo de comprobante origen · 17 letra ·
 *   18–33 número de comprobante · 34–43 fecha del comprobante ·
 *   44–59 monto del comprobante · 60–75 certificado propio (texto) ·
 *   76 tipo de documento (3 CUIT) · 77–87 CUIT · 88 situación IB (1 local,
 *   2 Convenio Multilateral, 4 no inscripto) · 89–99 inscripción IB ·
 *   100 situación IVA (1 RI, 3 exento, 4 monotributo) · 101–130 razón social ·
 *   131–146 otros conceptos · 147–162 IVA · 163–178 monto sujeto ·
 *   179–183 alícuota · 184–199 retención/percepción practicada ·
 *   200–215 monto total retenido/percibido · 216 aceptación (FCE) ·
 *   217–226 fecha de aceptación expresa.
 * Notas de crédito (119 posiciones):
 *   1 tipo de operación · 2–13 número de la nota · 14–23 fecha de la nota ·
 *   24–39 monto (el sujeto a percepción) · 40–55 certificado propio ·
 *   56–57 tipo de comprobante origen · 58 letra · 59–74 número del origen ·
 *   75–85 CUIT · 86–88 código de norma · 89–98 fecha de la percepción
 *   original · 99–114 percepción a deducir · 115–119 alícuota.
 */

import { percepcionesDeJurisdiccion } from "@/lib/lotePercepcionesArba";

export const LARGO_EARCIBA = 226;
export const LARGO_EARCIBA_NC = 119;
/** Régimen general por padrón (Res. 939/AGIP/2013), para retenciones y percepciones. */
export const NORMA_REGIMEN_GENERAL = "029";

export type SituacionIb = 1 | 2 | 4;
export type SituacionIva = 1 | 3 | 4;

export const SITUACIONES_IB: Record<SituacionIb, string> = {
  1: "Inscripto local (CABA)",
  2: "Convenio Multilateral",
  4: "No inscripto",
};

/** Lo que hace falta del retenido o percibido. */
export interface SujetoEarciba {
  cuit: string;
  razonSocial: string;
  situacionIb: SituacionIb | null;
  inscripcionIb: string | null;
  situacionIva: SituacionIva | null;
}

export interface OperacionEarciba {
  tipo: 1 | 2;
  norma: string;
  fecha: string; // aaaa-mm-dd
  comprobanteTipo: string; // "01", "03", "09", "10", "13"
  letra: "A" | "B" | "C" | "M" | " ";
  comprobanteNumero: number;
  comprobanteFecha: string;
  montoComprobante: number;
  iva: number;
  base: number;
  alicuota: number;
  importe: number;
  certificado: string | null;
  sujeto: SujetoEarciba;
}

export interface NotaDeCreditoEarciba {
  norma: string;
  numero: number;
  fecha: string;
  base: number;
  importe: number;
  alicuota: number;
  origenTipo: string;
  origenLetra: "A" | "B" | "C" | "M" | " ";
  origenNumero: number;
  origenFecha: string;
  cuit: string;
}

const num = (n: number | string, largo: number, campo: string) => {
  const t = String(n);
  if (!/^\d+$/.test(t) || t.length > largo) throw new Error(`${campo}: «${t}» no entra en ${largo} dígitos.`);
  return t.padStart(largo, "0");
};
const importe = (n: number, largo: number, campo: string) => {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${campo}: el importe no puede ser negativo.`);
  const t = (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
  if (t.length > largo) throw new Error(`${campo}: ${t} no entra en ${largo} posiciones.`);
  return t.padStart(largo, "0");
};
const texto = (t: string | null | undefined, largo: number) =>
  String(t ?? "").normalize("NFC").replace(/[\r\n;]/g, " ").slice(0, largo).padEnd(largo, " ");
const fecha = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) throw new Error(`Fecha inválida: «${iso}».`);
  return iso.slice(0, 10).split("-").reverse().join("/");
};
const norma = (n: string) => {
  if (!/^\d{1,3}$/.test(n.trim())) throw new Error("El código de norma tiene hasta 3 dígitos.");
  return n.trim().padStart(3, "0");
};

/** Por qué un sujeto no puede ir al archivo (null si está completo). */
export function faltanDatos(s: SujetoEarciba): string | null {
  const cuit = s.cuit.replace(/\D/g, "");
  if (cuit.length !== 11) return "no tiene CUIT";
  if (!s.situacionIb) return "falta su situación en Ingresos Brutos";
  if (s.situacionIb === 1 && !/^\d{10}$/.test(s.inscripcionIb ?? "")) return "falta su número de inscripción local (10 dígitos)";
  if (!s.situacionIva) return "falta su condición frente al IVA (inscripto, exento o monotributo)";
  if (!s.razonSocial.trim()) return "falta su razón social";
  return null;
}

/** El número de inscripción que pide AGIP según la situación. */
export function inscripcionParaAgip(s: SujetoEarciba): string {
  if (s.situacionIb === 4) return "00000000000";
  if (s.situacionIb === 2) return s.cuit.replace(/\D/g, "");
  return (s.inscripcionIb ?? "").padStart(11, "0");
}

export function registroEarciba(o: OperacionEarciba): string {
  const falta = faltanDatos(o.sujeto);
  if (falta) throw new Error(`${o.sujeto.razonSocial || o.sujeto.cuit}: ${falta}.`);
  if (!(o.alicuota >= 0 && o.alicuota < 100)) throw new Error("Alícuota fuera de rango.");
  // La letra va sólo en facturas, certificados de obra, recibos y FCE; si no, un blanco.
  const letra = ["01", "06", "07", "10"].includes(o.comprobanteTipo) ? o.letra : " ";
  const otros = Math.round((o.montoComprobante - o.iva - o.base) * 100) / 100;
  if (otros < 0) throw new Error(`Comprobante ${o.comprobanteNumero}: la base supera el monto del comprobante.`);
  const linea =
    String(o.tipo) + norma(o.norma) + fecha(o.fecha) + num(o.comprobanteTipo, 2, "Tipo de comprobante") + letra
    + num(o.comprobanteNumero, 16, "Número de comprobante") + fecha(o.comprobanteFecha) + importe(o.montoComprobante, 16, "Monto del comprobante")
    + texto(o.tipo === 1 ? o.certificado : "", 16) + "3" + num(o.sujeto.cuit.replace(/\D/g, ""), 11, "CUIT")
    + String(o.sujeto.situacionIb) + num(inscripcionParaAgip(o.sujeto), 11, "Inscripción IB") + String(o.sujeto.situacionIva)
    + texto(o.sujeto.razonSocial, 30) + importe(otros, 16, "Otros conceptos") + importe(o.iva, 16, "IVA")
    + importe(o.base, 16, "Monto sujeto") + importe(o.alicuota, 5, "Alícuota") + importe(o.importe, 16, "Importe")
    + importe(o.importe, 16, "Monto total") + " " + " ".repeat(10);
  if (linea.length !== LARGO_EARCIBA) throw new Error("El registro no tiene el largo del diseño de AGIP.");
  return linea;
}

export function registroNotaDeCreditoEarciba(n: NotaDeCreditoEarciba): string {
  const linea =
    "2" + num(n.numero, 12, "Número de la nota de crédito") + fecha(n.fecha) + importe(n.base, 16, "Monto de la nota")
    + texto("", 16) + num(n.origenTipo, 2, "Tipo de comprobante origen") + n.origenLetra
    + num(n.origenNumero, 16, "Número de comprobante origen") + num(n.cuit.replace(/\D/g, ""), 11, "CUIT")
    + norma(n.norma) + fecha(n.origenFecha) + importe(n.importe, 16, "Percepción a deducir") + importe(n.alicuota, 5, "Alícuota");
  if (linea.length !== LARGO_EARCIBA_NC) throw new Error("El registro de la nota de crédito no tiene el largo del diseño de AGIP.");
  return linea;
}

/** El archivo: ordenado por fecha (AGIP lo exige) y con CRLF. */
export function archivoEarciba<T>(filas: T[], fechaDe: (f: T) => string, registro: (f: T) => string): string {
  return [...filas].sort((a, b) => fechaDe(a).localeCompare(fechaDe(b))).map(registro).join("\r\n");
}

/** La condición frente al IVA (clave de Nerqia o código de ARCA) en el código de AGIP. */
export function situacionIvaAgip(condicion: string | number | null | undefined): SituacionIva | null {
  if (condicion === "responsable_inscripto" || condicion === 1) return 1;
  if (condicion === "exento" || condicion === 4) return 3;
  if (condicion === "monotributo" || condicion === 6 || condicion === 13) return 4;
  return null;
}

/** Número de comprobante de ARCA (punto de venta y número) en un solo número. */
export const numeroDeComprobante = (puntoVenta: number, numero: number) => puntoVenta * 100_000_000 + numero;

/** Tipo de comprobante de ARCA → tipo de comprobante origen de e-ARCIBA para una percepción. */
export function tipoOrigenPercepcion(tipoArca: number): "01" | "09" | "10" | "13" | null {
  if ([1, 6, 11].includes(tipoArca)) return "01";
  if ([2, 7, 12].includes(tipoArca)) return "09";
  if ([201, 206, 211].includes(tipoArca)) return "10";
  if ([202, 207, 212].includes(tipoArca)) return "13";
  return null;
}

// ── Armado del período ──────────────────────────────────────────────────────

export interface FichaIb { id: string; tabla: "suppliers" | "customers"; nombre: string; cuit: string; situacionIb: SituacionIb | null; inscripcionIb: string | null; condicionIva: string | null }
export interface RetencionLeida { certificado: number; cuit: string; nombre: string; fecha: string; alicuota: number; base: number; importe: number; orden: { numero: number; fecha: string; total: number } | null }
export interface FacturaLeida {
  id: string; fecha: string; tipo: number; puntoVenta: number; numero: number; total: number; iva: number;
  cuit: string; nombre: string; condicionReceptor: number | null; notaCreditoDe: string | null;
  percepciones: { base: number; alicuota: number; importe: number }[];
}

export interface Periodo {
  operaciones: OperacionEarciba[];
  notas: NotaDeCreditoEarciba[];
  /** Fichas a completar antes de descargar, con el motivo. */
  incompletos: { ficha: FichaIb | null; cuit: string; nombre: string; motivo: string }[];
  /** Lo que no entra en el diseño (por ejemplo, una factura de exportación). */
  omitidos: string[];
}

const soloDigitos = (t: string | null | undefined) => String(t ?? "").replace(/\D/g, "");
const situacionValida = (n: number | null | undefined): SituacionIb | null => (n === 1 || n === 2 || n === 4 ? n : null);

/** Junta retenciones, percepciones y notas de crédito del mes con los datos de cada sujeto. */
export function armarPeriodoEarciba(a: {
  norma: string;
  retenciones: RetencionLeida[];
  facturas: FacturaLeida[];
  /** Las facturas que anulan las notas de crédito (por id). */
  originales: Map<string, FacturaLeida>;
  proveedores: FichaIb[];
  clientes: FichaIb[];
}): Periodo {
  const periodo: Periodo = { operaciones: [], notas: [], incompletos: [], omitidos: [] };
  const vistos = new Set<string>();
  const porCuit = (fichas: FichaIb[]) => new Map(fichas.map(f => [soloDigitos(f.cuit), f]));
  const proveedores = porCuit(a.proveedores);
  const clientes = porCuit(a.clientes);
  const sujeto = (cuit: string, nombre: string, ficha: FichaIb | undefined, ivaDeLaFactura?: number | null): SujetoEarciba | null => {
    const s: SujetoEarciba = {
      cuit, razonSocial: ficha?.nombre || nombre,
      situacionIb: situacionValida(ficha?.situacionIb), inscripcionIb: ficha?.inscripcionIb ?? null,
      // La de la factura manda; si ahí figura como consumidor final, vale la de la ficha.
      situacionIva: situacionIvaAgip(ivaDeLaFactura ?? null) ?? situacionIvaAgip(ficha?.condicionIva ?? null),
    };
    const falta = faltanDatos(s);
    if (!falta) return s;
    const clave = `${ficha?.tabla ?? "x"}:${cuit}`;
    if (!vistos.has(clave)) { vistos.add(clave); periodo.incompletos.push({ ficha: ficha ?? null, cuit, nombre: s.razonSocial, motivo: falta }); }
    return null;
  };

  for (const r of a.retenciones) {
    const cuit = soloDigitos(r.cuit);
    const s = sujeto(cuit, r.nombre, proveedores.get(cuit));
    if (!r.orden) { periodo.omitidos.push(`Retención ${r.certificado}: no se encontró su orden de pago.`); continue; }
    if (!s) continue;
    periodo.operaciones.push({
      tipo: 1, norma: a.norma, fecha: r.fecha, comprobanteTipo: "03", letra: " ",
      comprobanteNumero: r.orden.numero, comprobanteFecha: r.orden.fecha, montoComprobante: Math.max(r.orden.total, r.base),
      iva: 0, base: r.base, alicuota: r.alicuota, importe: r.importe, certificado: String(r.certificado).padStart(8, "0"), sujeto: s,
    });
  }

  for (const f of a.facturas) {
    const cuit = soloDigitos(f.cuit);
    const nc = [3, 8, 13, 203, 208, 213].includes(f.tipo);
    for (const p of f.percepciones) {
      if (nc) {
        const o = f.notaCreditoDe ? a.originales.get(f.notaCreditoDe) : undefined;
        const tipo = o ? tipoOrigenPercepcion(o.tipo) : null;
        if (!o || !tipo) { periodo.omitidos.push(`Nota de crédito ${f.puntoVenta}-${f.numero}: no se encontró la factura que anula.`); continue; }
        periodo.notas.push({
          norma: a.norma, numero: numeroDeComprobante(f.puntoVenta, f.numero), fecha: f.fecha, base: p.base, importe: p.importe, alicuota: p.alicuota,
          origenTipo: tipo, origenLetra: letraArca(o.tipo), origenNumero: numeroDeComprobante(o.puntoVenta, o.numero), origenFecha: o.fecha, cuit,
        });
        continue;
      }
      const tipo = tipoOrigenPercepcion(f.tipo);
      if (!tipo) { periodo.omitidos.push(`Comprobante ${f.puntoVenta}-${f.numero}: ese tipo no admite percepción de AGIP.`); continue; }
      const s = sujeto(cuit, f.nombre, clientes.get(cuit), f.condicionReceptor);
      if (!s) continue;
      const letra = letraArca(f.tipo);
      // El IVA va aparte sólo de inscripto a inscripto con factura A; a un monotributista forma parte de la base.
      const iva = letra === "A" && s.situacionIva === 1 ? f.iva : 0;
      periodo.operaciones.push({
        tipo: 2, norma: a.norma, fecha: f.fecha, comprobanteTipo: tipo, letra,
        comprobanteNumero: numeroDeComprobante(f.puntoVenta, f.numero), comprobanteFecha: f.fecha,
        montoComprobante: f.total, iva, base: p.base, alicuota: p.alicuota, importe: p.importe, certificado: null, sujeto: s,
      });
    }
  }
  return periodo;
}

function letraArca(tipo: number): "A" | "B" | "C" | " " {
  if ([1, 2, 3, 201, 202, 203].includes(tipo)) return "A";
  if ([6, 7, 8, 206, 207, 208].includes(tipo)) return "B";
  if ([11, 12, 13, 211, 212, 213].includes(tipo)) return "C";
  return " ";
}

/** Las percepciones de AGIP de una factura. */
export const percepcionesAgip = (tributos: unknown, padronDelAgente: string | null) => percepcionesDeJurisdiccion(tributos, "AGIP", padronDelAgente);
