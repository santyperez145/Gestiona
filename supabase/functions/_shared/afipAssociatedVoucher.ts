import { FACTURA_DE_LA_NOTA, FCE, NOTAS_DE_CREDITO, NOTAS_DE_DEBITO } from "./comprobantesArca.ts";

export interface AfipAssociatedVoucher {
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero_afip: number | null;
  /** CUIT del emisor y fecha de la factura: ARCA los pide en las notas de una FCE. */
  emisor_cuit?: string | null;
  issue_date?: string | null;
}

export const CREDIT_NOTE_TYPES = [...NOTAS_DE_CREDITO];
export const DEBIT_NOTE_TYPES = [...NOTAS_DE_DEBITO];

/**
 * Notas de crédito y de débito asocian la factura de su clase (una nota de
 * FCE, la FCE de su clase). Las de FCE suman el CUIT del emisor y la fecha de
 * la factura (RG 4367): sin ellos ARCA rechaza.
 */
export function associatedVoucherXml(
  creditNoteType: number,
  source: AfipAssociatedVoucher | null,
): string {
  const expectedType = FACTURA_DE_LA_NOTA[creditNoteType];
  if (!expectedType) {
    if (source) throw new Error("Solo una nota de credito o de debito puede asociar una factura");
    return "";
  }
  if (!source || source.tipo_comprobante !== expectedType ||
      typeof source.punto_venta !== "number" || !Number.isSafeInteger(source.punto_venta) || source.punto_venta <= 0 ||
      typeof source.numero_afip !== "number" || !Number.isSafeInteger(source.numero_afip) || source.numero_afip <= 0) {
    throw new Error(CREDIT_NOTE_TYPES.includes(creditNoteType)
      ? "La nota de credito necesita una factura original autorizada y numerada"
      : "La nota de debito necesita una factura original autorizada y numerada");
  }

  let fce = "";
  if (FCE.has(creditNoteType)) {
    const cuit = String(source.emisor_cuit ?? "").replace(/\D/g, "");
    const fecha = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(source.issue_date ?? ""));
    if (cuit.length !== 11 || !fecha) {
      throw new Error("La nota de una factura de credito MiPyME necesita el CUIT del emisor y la fecha de la factura original");
    }
    fce = `<ar:Cuit>${cuit}</ar:Cuit><ar:CbteFch>${fecha[1]}${fecha[2]}${fecha[3]}</ar:CbteFch>`;
  }

  return `<ar:CbtesAsoc><ar:CbteAsoc>` +
    `<ar:Tipo>${source.tipo_comprobante}</ar:Tipo>` +
    `<ar:PtoVta>${source.punto_venta}</ar:PtoVta>` +
    `<ar:Nro>${source.numero_afip}</ar:Nro>` +
    fce +
    `</ar:CbteAsoc></ar:CbtesAsoc>`;
}
