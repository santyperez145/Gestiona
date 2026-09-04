/**
 * Representación fiscal de una factura electrónica argentina.
 *
 * Los datos autorizados vienen del snapshot que guarda PostgreSQL. Esta capa
 * sólo valida y representa: nunca vuelve a consultar Ajustes para reescribir
 * un documento histórico.
 */

export const ARCA_QR_BASE_URL = "https://www.arca.gob.ar/fe/qr/";

export type ArcaQrPayload = {
  ver: 1;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;
  ctz: number;
  tipoDocRec?: number;
  nroDocRec?: number;
  tipoCodAut: "A" | "E";
  codAut: number;
};

export type ArcaInvoiceSnapshot = {
  issue_date?: string | null;
  total?: number | null;
  currency?: string | null;
  customer_tax_id?: string | null;
  tipo_comprobante?: number | null;
  numero_afip?: number | null;
  cae?: string | null;
  emisor_cuit?: string | null;
  punto_venta?: number | null;
  receptor_tipo_documento?: number | null;
  moneda_cotizacion?: number | null;
  codigo_autorizacion_tipo?: string | null;
  arca_qr_payload?: unknown;
};

const fechaArca = /^\d{4}-\d{2}-\d{2}$/;

function enteroSeguro(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function numeroFinito(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function payloadValido(value: unknown): ArcaQrPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const fecha = typeof v.fecha === "string" && fechaArca.test(v.fecha) ? v.fecha : null;
  const cuit = enteroSeguro(v.cuit);
  const ptoVta = enteroSeguro(v.ptoVta);
  const tipoCmp = enteroSeguro(v.tipoCmp);
  const nroCmp = enteroSeguro(v.nroCmp);
  const importe = numeroFinito(v.importe);
  const ctz = numeroFinito(v.ctz);
  const codAut = enteroSeguro(v.codAut);
  const moneda = typeof v.moneda === "string" ? v.moneda.trim().toUpperCase() : "";
  const tipoCodAut = v.tipoCodAut === "A" || v.tipoCodAut === "E" ? v.tipoCodAut : null;

  if (
    v.ver !== 1 || !fecha || cuit === null || String(cuit).length !== 11 ||
    ptoVta === null || ptoVta < 1 || ptoVta > 99999 ||
    tipoCmp === null || tipoCmp < 1 || nroCmp === null || nroCmp < 1 ||
    importe === null || !/^[A-Z]{3}$/.test(moneda) || ctz === null || ctz <= 0 ||
    !tipoCodAut || codAut === null || String(codAut).length !== 14
  ) return null;

  const tipoDocRec = v.tipoDocRec == null ? null : enteroSeguro(v.tipoDocRec);
  const nroDocRec = v.nroDocRec == null ? null : enteroSeguro(v.nroDocRec);
  if ((tipoDocRec === null) !== (nroDocRec === null)) return null;

  return {
    ver: 1,
    fecha,
    cuit,
    ptoVta,
    tipoCmp,
    nroCmp,
    importe,
    moneda,
    ctz,
    ...(tipoDocRec !== null && nroDocRec !== null ? { tipoDocRec, nroDocRec } : {}),
    tipoCodAut,
    codAut,
  };
}

/**
 * Usa primero el JSON congelado por el servidor. El fallback sólo permite
 * representar comprobantes históricos anteriores al snapshot.
 */
export function arcaQrPayload(invoice: ArcaInvoiceSnapshot): ArcaQrPayload | null {
  const stored = payloadValido(invoice.arca_qr_payload);
  if (stored) return stored;

  const fecha = String(invoice.issue_date ?? "");
  const cuitText = String(invoice.emisor_cuit ?? "").replace(/\D/g, "");
  const cuit = enteroSeguro(cuitText);
  const ptoVta = enteroSeguro(invoice.punto_venta);
  const tipoCmp = enteroSeguro(invoice.tipo_comprobante);
  const nroCmp = enteroSeguro(invoice.numero_afip);
  const importe = numeroFinito(invoice.total);
  const codAut = enteroSeguro(String(invoice.cae ?? "").replace(/\D/g, ""));
  const ctz = numeroFinito(invoice.moneda_cotizacion ?? (invoice.currency === "ARS" ? 1 : null));
  if (
    !fechaArca.test(fecha) || cuit === null || cuitText.length !== 11 ||
    ptoVta === null || tipoCmp === null || nroCmp === null || importe === null ||
    codAut === null || String(codAut).length !== 14 || ctz === null || ctz <= 0
  ) return null;

  const doc = String(invoice.customer_tax_id ?? "").replace(/\D/g, "");
  const tipoDoc = enteroSeguro(invoice.receptor_tipo_documento);
  const nroDoc = enteroSeguro(doc);
  const moneda = invoice.currency === "ARS"
    ? "PES"
    : String(invoice.currency ?? "").trim().toUpperCase();

  return payloadValido({
    ver: 1,
    fecha,
    cuit,
    ptoVta,
    tipoCmp,
    nroCmp,
    importe,
    moneda,
    ctz,
    ...(tipoDoc && tipoDoc !== 99 && nroDoc ? { tipoDocRec: tipoDoc, nroDocRec: nroDoc } : {}),
    tipoCodAut: invoice.codigo_autorizacion_tipo === "A" ? "A" : "E",
    codAut,
  });
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function arcaQrUrl(invoice: ArcaInvoiceSnapshot): string | null {
  const payload = arcaQrPayload(invoice);
  return payload ? `${ARCA_QR_BASE_URL}?p=${base64Utf8(JSON.stringify(payload))}` : null;
}

export function numeroFiscal(puntoVenta: number | null | undefined, numero: number | null | undefined): string | null {
  if (!puntoVenta || !numero) return null;
  return `${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

export function condicionIvaLabel(value: string | number | null | undefined): string {
  const labels: Record<string, string> = {
    responsable_inscripto: "IVA Responsable Inscripto",
    monotributo: "Responsable Monotributo",
    exento: "IVA Sujeto Exento",
    "1": "IVA Responsable Inscripto",
    "4": "IVA Sujeto Exento",
    "5": "Consumidor Final",
    "6": "Responsable Monotributo",
  };
  return labels[String(value ?? "")] ?? "Condición IVA no informada";
}

/** Evita que una fecha SQL (`YYYY-MM-DD`) retroceda un día por el huso horario. */
export function fechaFiscalArgentina(value: string | null | undefined): string {
  const raw = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}
