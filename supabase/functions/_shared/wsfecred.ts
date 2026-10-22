/**
 * WSFECRED: ¿el cliente está obligado a recibir Factura de Crédito
 * Electrónica MiPyME, y desde qué monto? (`consultarMontoObligadoRecepcion`).
 *
 * Contrato tomado del WSDL oficial (2026-10-22):
 *   - homologación https://fwshomo.afip.gov.ar/wsfecred/FECredService
 *   - producción   https://serviciosjava.afip.gob.ar/wsfecred/FECredService
 * El elemento raíz va calificado (espacio de nombres del servicio) y los hijos
 * sin calificar (el esquema no declara `elementFormDefault`).
 */
// @ts-ignore Deno resuelve npm:; Vitest enlaza la misma versión instalada.
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@5.11.2";

export const WSFECRED_URL = {
  homologacion: "https://fwshomo.afip.gov.ar/wsfecred/FECredService",
  produccion: "https://serviciosjava.afip.gob.ar/wsfecred/FECredService",
} as const;
export const WSFECRED_SERVICIO = "wsfecred";
const NS = "http://ar.gob.afip.wsfecred/FECredService/";

const xmlTexto = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function soapObligadoRecepcion(a: { token: string; sign: string; cuitRepresentada: string; cuitConsultada: string; fecha: string }): string {
  const cuitRep = a.cuitRepresentada.replace(/\D/g, "");
  const cuitCon = a.cuitConsultada.replace(/\D/g, "");
  if (cuitRep.length !== 11 || cuitCon.length !== 11) throw new Error("Los CUIT tienen que tener 11 dígitos.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) throw new Error("La fecha de emisión no es válida.");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fec="${NS}">` +
    `<soapenv:Header/><soapenv:Body><fec:consultarMontoObligadoRecepcionRequest>` +
    `<authRequest><token>${xmlTexto(a.token)}</token><sign>${xmlTexto(a.sign)}</sign><cuitRepresentada>${cuitRep}</cuitRepresentada></authRequest>` +
    `<cuitConsultada>${cuitCon}</cuitConsultada><fechaEmision>${a.fecha}</fechaEmision>` +
    `</fec:consultarMontoObligadoRecepcionRequest></soapenv:Body></soapenv:Envelope>`;
}

export interface ObligadoRecepcion {
  obligado: boolean;
  montoDesde: number | null;
  observaciones: string[];
}

export class WsfecredError extends Error {
  constructor(public codigos: number[], message: string) { super(message); }
}

const comoLista = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function leerObligadoRecepcion(xml: string): ObligadoRecepcion {
  if (xml.length > 500_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new WsfecredError([], "ARCA devolvió una respuesta que no pudimos leer. Probá de nuevo.");
  }
  const body = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml)?.Envelope?.Body;
  if (body?.Fault) {
    throw new WsfecredError([], `ARCA rechazó la consulta: ${String(body.Fault.faultstring ?? "sin detalle")}`);
  }
  const r = body?.consultarMontoObligadoRecepcionResponse?.consultarMontoObligadoRecepcionReturn;
  if (!r || typeof r !== "object") throw new WsfecredError([], "ARCA no devolvió el resultado de la consulta.");
  const errores = [
    ...comoLista(r.arrayErrores?.codigoDescripcion),
    ...comoLista(r.arrayErroresFormato?.codigoDescripcionString),
  ] as { codigo?: string; descripcion?: string }[];
  if (errores.length) {
    throw new WsfecredError(errores.map(e => Number(e.codigo)).filter(Number.isFinite),
      `ARCA: ${errores.map(e => String(e.descripcion ?? e.codigo ?? "").trim()).filter(Boolean).join(" · ")}`);
  }
  if (r.obligado !== "S" && r.obligado !== "N") throw new WsfecredError([], "ARCA no dijo si el cliente está obligado.");
  const monto = Number(r.montoDesde);
  return {
    obligado: r.obligado === "S",
    montoDesde: r.montoDesde != null && Number.isFinite(monto) ? monto : null,
    observaciones: comoLista(r.arrayObservacion?.codigoDescripcion as { descripcion?: string } | undefined)
      .map(o => String(o?.descripcion ?? "").trim()).filter(Boolean),
  };
}
