/**
 * Identidad fiscal de un cliente: espejo de las restricciones de
 * `20261009000200_customer_fiscal_identity` para avisar antes de guardar.
 * La base sigue siendo la autoridad (normaliza y valida con `cuit_valido`).
 */
import { CONDICIONES_IVA, esCondicionIva, formatearCuit, tipoDeComprobante, validarCuit, validarDni, type CondicionIva } from "@/lib/fiscalIdentity";

export type IdentidadFiscalCliente = {
  vat_condition: CondicionIva;
  tax_id: string;
  legal_name: string;
  fiscal_address: string;
};

export const IDENTIDAD_FISCAL_VACIA: IdentidadFiscalCliente = {
  vat_condition: "consumidor_final", tax_id: "", legal_name: "", fiscal_address: "",
};

export function identidadFiscalDesde(c: Partial<Record<keyof IdentidadFiscalCliente, string | null>> | null | undefined): IdentidadFiscalCliente {
  return {
    vat_condition: esCondicionIva(c?.vat_condition) ? c.vat_condition : "consumidor_final",
    tax_id: c?.tax_id ? (c.tax_id.length === 11 ? formatearCuit(c.tax_id) : c.tax_id) : "",
    legal_name: c?.legal_name ?? "",
    fiscal_address: c?.fiscal_address ?? "",
  };
}

/** Mensaje de error para mostrar junto al documento; `null` si es válido. */
export function errorIdentidadFiscal(i: IdentidadFiscalCliente): string | null {
  const doc = i.tax_id.replace(/[^0-9]/g, "");
  if (i.vat_condition !== "consumidor_final") {
    if (!doc) return `${CONDICIONES_IVA[i.vat_condition].label} se identifica con CUIT.`;
    if (!validarCuit(doc)) return "El CUIT no es válido: revisá los 11 dígitos (el último es verificador).";
    return null;
  }
  if (!doc) return null;
  if (doc.length === 11) return validarCuit(doc) ? null : "El CUIT no es válido: revisá los 11 dígitos (el último es verificador).";
  return validarDni(doc) ? null : "Ingresá un CUIT de 11 dígitos o un DNI de 7 u 8.";
}

/** Columnas para insert/update; el documento viaja sólo con dígitos. */
export function columnasIdentidadFiscal(i: IdentidadFiscalCliente) {
  const doc = i.tax_id.replace(/[^0-9]/g, "");
  return {
    vat_condition: i.vat_condition,
    tax_id: doc || null,
    tax_id_type: doc ? (doc.length === 11 ? "CUIT" : "DNI") : null,
    legal_name: i.legal_name.trim() || null,
    fiscal_address: i.fiscal_address.trim() || null,
  };
}

/** Qué comprobante recibiría este cliente con el emisor dado, para anticiparlo en el POS. */
export function letraParaCliente(emisor: string | null | undefined, condicion: string | null | undefined): "A" | "B" | "C" {
  return tipoDeComprobante(emisor, esCondicionIva(condicion) ? condicion : "consumidor_final").letra;
}
