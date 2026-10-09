export interface AfipAssociatedVoucher {
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero_afip: number | null;
}

/** Notas de crédito (3/8/13) y de débito (2/7/12) asocian la factura de su clase. */
const SOURCE_TYPE_BY_NOTE: Record<number, number> = {
  2: 1,
  3: 1,
  7: 6,
  8: 6,
  12: 11,
  13: 11,
};

export const CREDIT_NOTE_TYPES = [3, 8, 13];
export const DEBIT_NOTE_TYPES = [2, 7, 12];

export function associatedVoucherXml(
  creditNoteType: number,
  source: AfipAssociatedVoucher | null,
): string {
  const expectedType = SOURCE_TYPE_BY_NOTE[creditNoteType];
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

  return `<ar:CbtesAsoc><ar:CbteAsoc>` +
    `<ar:Tipo>${source.tipo_comprobante}</ar:Tipo>` +
    `<ar:PtoVta>${source.punto_venta}</ar:PtoVta>` +
    `<ar:Nro>${source.numero_afip}</ar:Nro>` +
    `</ar:CbteAsoc></ar:CbtesAsoc>`;
}
