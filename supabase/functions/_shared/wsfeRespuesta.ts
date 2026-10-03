// @ts-ignore Deno resuelve npm:; Vitest enlaza la misma versión instalada.
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@5.11.2";

export class ArcaReadError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function result(xml: string, operation: string): Record<string, unknown> {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new ArcaReadError("invalid_response", "ARCA devolvió una respuesta que no pudimos validar. Reintentá la consulta.");
  }
  const parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml);
  const body = parsed?.Envelope?.Body;
  const value = body?.[`${operation}Response`]?.[`${operation}Result`];
  if (body?.Fault || value?.Errors) {
    throw new ArcaReadError("provider_rejected", "ARCA rechazó la consulta. Revisá la delegación y el punto de venta de Web Services.");
  }
  if (!value || typeof value !== "object") throw new ArcaReadError("invalid_response", "No pudimos confirmar la respuesta de ARCA. Reintentá la consulta.");
  return value;
}

/** Cero sólo es válido cuando viene explícitamente en un resultado WSFE válido. */
export function leerUltimoAutorizadoWsfe(xml: string): number {
  const value = result(xml, "FECompUltimoAutorizado").CbteNro;
  if (typeof value !== "string" || !/^\d{1,8}$/.test(value)) {
    throw new ArcaReadError("invalid_response", "ARCA no confirmó el último número de comprobante. Reintentá la consulta.");
  }
  return Number(value);
}

export function assertEnabledPoint(xml: string, number: number): void {
  const response = result(xml, "FEParamGetPtosVenta");
  const records = (response.ResultGet as { PtoVenta?: unknown })?.PtoVenta;
  const points = Array.isArray(records) ? records : records ? [records] : [];
  const point = points.find(value => Number(value.Nro) === number);
  if (!point || point.EmisionTipo !== "CAE" || point.Bloqueado !== "N" || (point.FchBaja && point.FchBaja !== "NULL")) {
    throw new ArcaReadError("point_not_enabled", "El punto de venta no está habilitado para emitir con CAE. Revisá su alta, sistema y estado en ARCA.");
  }
}
