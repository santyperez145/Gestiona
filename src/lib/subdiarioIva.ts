/**
 * Subdiario de IVA en Excel para el contador (2026-10-22).
 *
 * Los TXT del Libro IVA Digital sirven para importar en ARCA; el estudio
 * contable además trabaja con un subdiario: una fila por comprobante y una
 * columna de neto e IVA por alícuota, con totales. Las notas de crédito van en
 * negativo (así suman bien), al revés que en el TXT de ARCA.
 *
 * Las filas salen del mismo desglose que el libro (`invoiceIvaGroups` para
 * ventas, las alícuotas guardadas para compras): el Excel y los TXT no pueden
 * diferir.
 */
import { invoiceIvaGroups } from "../../supabase/functions/_shared/invoiceIva";
import type { ComprobanteVenta } from "@/lib/libroIvaVentas";
import { esNotaDeCredito, TIPOS_DE_COMPRA, type ComprobanteCompra } from "@/lib/libroIvaCompras";

export type Celda = string | number;
const TASAS = [21, 10.5, 27, 5, 2.5];
const NC_VENTA = new Set([3, 8, 13]);
const NOMBRES: Record<number, string> = {
  ...Object.fromEntries(TIPOS_DE_COMPRA.map(t => [t.codigo, t.nombre])),
};

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const tasaTexto = (t: number) => `${String(t).replace(".", ",")}%`;
const fechaAr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const numero = (pv: number | null, n: number | null) => `${String(pv ?? 0).padStart(5, "0")}-${String(n ?? 0).padStart(8, "0")}`;

function encabezadoAlicuotas(): string[] {
  return TASAS.flatMap(t => [`Neto ${tasaTexto(t)}`, `IVA ${tasaTexto(t)}`]);
}

function totales(filas: Celda[][], desde: number): Celda[] {
  const ancho = filas[0]?.length ?? 0;
  return Array.from({ length: ancho }, (_, i) => {
    if (i === 0) return "Totales";
    if (i < desde) return "";
    return redondear(filas.reduce((s, f) => s + (typeof f[i] === "number" ? (f[i] as number) : 0), 0));
  });
}

export function subdiarioVentas(comprobantes: ComprobanteVenta[]): { filas: Celda[][]; revisar: Celda[][] } {
  const encabezado = ["Fecha", "Comprobante", "Número", "Cliente", "CUIT / DNI", ...encabezadoAlicuotas(), "No gravado / exento", "Total"];
  const cuerpo: Celda[][] = [];
  const revisar: Celda[][] = [];
  const ordenados = [...comprobantes].sort((a, b) => a.issue_date.localeCompare(b.issue_date) || Number(a.numero_afip) - Number(b.numero_afip));
  for (const c of ordenados) {
    const tipo = Number(c.tipo_comprobante);
    let grupos: ReturnType<typeof invoiceIvaGroups>;
    try {
      grupos = invoiceIvaGroups({ ...c, tipo_comprobante: tipo, invoice_items: c.invoice_items ?? [] });
    } catch (e) {
      revisar.push([fechaAr(c.issue_date), numero(c.punto_venta, c.numero_afip), e instanceof Error ? e.message : "No se pudo desglosar"]);
      continue;
    }
    const signo = NC_VENTA.has(tipo) ? -1 : 1;
    const porTasa = new Map(grupos.map(g => [g.rate, g]));
    const alicuotas = TASAS.flatMap(t => [signo * (porTasa.get(t)?.base ?? 0), signo * (porTasa.get(t)?.amount ?? 0)]);
    const gravadoMasIva = grupos.filter(g => g.rate > 0).reduce((s, g) => s + g.base + g.amount, 0);
    const resto = redondear(signo * (Number(c.total) - gravadoMasIva));
    cuerpo.push([
      fechaAr(c.issue_date), NOMBRES[tipo] ?? `Tipo ${tipo}`, numero(c.punto_venta, c.numero_afip),
      c.customer_name?.trim() || "Consumidor final", String(c.customer_tax_id ?? "").replace(/\D/g, "") || "—",
      ...alicuotas.map(redondear), resto, redondear(signo * Number(c.total)),
    ]);
  }
  const filas = [encabezado, ...cuerpo];
  if (cuerpo.length) filas.push(totales(cuerpo, 5));
  return { filas, revisar };
}

export function subdiarioCompras(comprobantes: ComprobanteCompra[]): Celda[][] {
  const encabezado = ["Fecha", "Comprobante", "Número", "Proveedor", "CUIT", ...encabezadoAlicuotas(),
    "No gravado", "Exento", "Percepción IVA", "Percepción IIBB", "Otros tributos", "Total"];
  const cuerpo: Celda[][] = [...comprobantes]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero)
    .map(c => {
      const signo = esNotaDeCredito(c.tipo_comprobante) ? -1 : 1;
      const porTasa = new Map(c.alicuotas.map(a => [a.tasa, a]));
      const otros = Number(c.percepcion_nacionales) + Number(c.percepcion_municipal) + Number(c.impuestos_internos) + Number(c.otros_tributos);
      return [
        fechaAr(c.fecha), NOMBRES[c.tipo_comprobante] ?? `Tipo ${c.tipo_comprobante}`, numero(c.punto_venta, c.numero),
        c.razon_social_emisor, c.cuit_emisor,
        ...TASAS.flatMap(t => [signo * Number(porTasa.get(t)?.neto ?? 0), signo * Number(porTasa.get(t)?.iva ?? 0)]).map(redondear),
        redondear(signo * (Number(c.no_gravado) + Number(porTasa.get(0)?.neto ?? 0))), redondear(signo * Number(c.exento)),
        redondear(signo * Number(c.percepcion_iva)), redondear(signo * Number(c.percepcion_iibb)), redondear(signo * otros),
        redondear(signo * Number(c.total)),
      ];
    });
  const filas = [encabezado, ...cuerpo];
  if (cuerpo.length) filas.push(totales(cuerpo, 5));
  return filas;
}

export function hojaPosicion(p: { debitoFiscal: number; creditoFiscal: number; percepcionesIva: number; retencionesIva?: number; saldo: number }): Celda[][] {
  return [
    ["Concepto", "Importe"],
    ["Débito fiscal (ventas)", p.debitoFiscal],
    ["Crédito fiscal (compras)", -p.creditoFiscal],
    ["Percepciones de IVA sufridas", -p.percepcionesIva],
    ["Retenciones de IVA sufridas", -(p.retencionesIva ?? 0)],
    [p.saldo >= 0 ? "Saldo a pagar" : "Saldo técnico a favor", Math.abs(p.saldo)],
    [],
    ["Referencia del mes: no incluye saldos de períodos anteriores."],
  ];
}

export interface RetencionSufrida {
  id: string;
  fecha: string;
  impuesto: "iva" | "ganancias" | "iibb" | "suss";
  agente_cuit: string;
  agente_nombre: string;
  numero_certificado: string;
  jurisdiccion: string | null;
  importe: number;
}

export const NOMBRE_IMPUESTO: Record<RetencionSufrida["impuesto"], string> = {
  iva: "IVA", ganancias: "Ganancias", iibb: "Ingresos Brutos", suss: "SUSS",
};

/** Total por impuesto, en pesos con centavos. */
export function totalesDeRetenciones(retenciones: RetencionSufrida[]): Record<RetencionSufrida["impuesto"], number> {
  const t = { iva: 0, ganancias: 0, iibb: 0, suss: 0 };
  for (const r of retenciones) t[r.impuesto] = redondear(t[r.impuesto] + Number(r.importe));
  return t;
}

export function hojaRetenciones(retenciones: RetencionSufrida[]): Celda[][] {
  const filas: Celda[][] = [["Fecha", "Impuesto", "Agente", "CUIT", "Certificado", "Jurisdicción", "Importe"],
    ...[...retenciones].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(r => [
      fechaAr(r.fecha), NOMBRE_IMPUESTO[r.impuesto], r.agente_nombre, r.agente_cuit, r.numero_certificado, r.jurisdiccion ?? "", Number(r.importe),
    ])];
  if (retenciones.length) filas.push(["Totales", "", "", "", "", "", redondear(retenciones.reduce((s, r) => s + Number(r.importe), 0))]);
  return filas;
}
