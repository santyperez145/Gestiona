// @ts-ignore Deno resuelve npm:; Vitest enlaza la misma versión instalada.
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@5.11.2";

export class ArcaReadError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function parseBody(xml: string): Record<string, unknown> | undefined {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new ArcaReadError("invalid_response", "ARCA devolvió una respuesta que no pudimos validar. Reintentá la consulta.");
  }
  const parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml);
  return parsed?.Envelope?.Body;
}

function result(xml: string, operation: string): Record<string, unknown> {
  const body = parseBody(xml) as Record<string, any> | undefined;
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

export type MensajeWsfe = { code: number; msg: string };

export type SolicitudCaeWsfe = {
  /** Resultado del comprobante; `null` si ARCA no lo informó. */
  resultado: "A" | "R" | "P" | null;
  cae: string | null;
  /** `YYYY-MM-DD`, sólo si ARCA devolvió una fecha válida. */
  caeVencimiento: string | null;
  errores: MensajeWsfe[];
  observaciones: MensajeWsfe[];
};

function lista(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function mensajes(value: unknown): MensajeWsfe[] {
  return lista(value).flatMap(item => {
    const code = Number(item.Code);
    if (!Number.isSafeInteger(code)) return [];
    return [{ code, msg: typeof item.Msg === "string" ? item.Msg : "" }];
  });
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lee la respuesta de FECAESolicitar para un único comprobante.
 *
 * El manual v4.7 describe el detalle como `FEDetResponse > Obs > Observaciones`
 * en el esquema y como `FECAEDetResponse > Observaciones > Obs` en su ejemplo;
 * se aceptan ambas formas. `Events` son avisos generales de ARCA y nunca
 * explican un rechazo. Una respuesta inválida o un Fault no prueba que el
 * comprobante no se haya autorizado: el llamador debe conciliar.
 */
export function leerSolicitudCaeWsfe(xml: string): SolicitudCaeWsfe {
  const body = parseBody(xml) as Record<string, any> | undefined;
  const value = body?.FECAESolicitarResponse?.FECAESolicitarResult;
  if (body?.Fault || !value || typeof value !== "object") {
    throw new ArcaReadError("invalid_response", "ARCA no confirmó la autorización. Nerqia la verifica antes de volver a emitir.");
  }
  const errores = mensajes(value.Errors?.Err);
  const detalles = lista(value.FeDetResp?.FECAEDetResponse ?? value.FeDetResp?.FEDetResponse);
  if (detalles.length > 1) {
    throw new ArcaReadError("invalid_response", "ARCA devolvió más de un comprobante para una solicitud individual.");
  }
  const detalle = detalles[0] ?? {};
  const obs = detalle.Observaciones as Record<string, unknown> | undefined;
  const obsAlternativa = detalle.Obs as Record<string, unknown> | undefined;
  const observaciones = mensajes(obs?.Obs ?? obsAlternativa?.Observaciones);

  const resultadoTexto = texto(detalle.Resultado) || texto(value.FeCabResp?.Resultado);
  const resultado = resultadoTexto === "A" || resultadoTexto === "R" || resultadoTexto === "P" ? resultadoTexto : null;
  const cae = texto(detalle.CAE);
  const vto = texto(detalle.CAEFchVto);
  return {
    resultado,
    cae: /^\d{14}$/.test(cae) ? cae : null,
    caeVencimiento: /^\d{8}$/.test(vto) ? `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}` : null,
    errores,
    observaciones,
  };
}
