/**
 * Padrón de ARCA (ws_sr_constancia_inscripcion, getPersona_v2).
 *
 * Lectura pura de la respuesta SOAP, sin red: la usa la Edge `arca-padron` y
 * la prueban los tests. Devuelve sólo lo que sirve para facturar: nombre,
 * condición frente al IVA y domicilio fiscal.
 */

export type CondicionIvaPadron = "responsable_inscripto" | "monotributo" | "exento" | "consumidor_final";

export type PersonaPadron = {
  cuit: string;
  nombre: string;
  tipoPersona: "FISICA" | "JURIDICA" | null;
  condicionIva: CondicionIvaPadron;
  /** "ACTIVO" si la clave está activa; otro valor se muestra como advertencia. */
  estadoClave: string | null;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  codigoPostal: string | null;
  categoriaMonotributo: string | null;
  /** Errores de constancia que ARCA informa aunque devuelva datos. */
  avisos: string[];
};

const desescapar = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Contenido de cada `<tag>` (sin prefijo de namespace), en orden. */
export function todos(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map(m => m[1]);
}

const uno = (xml: string, tag: string): string | null => {
  const v = todos(xml, tag)[0];
  return v === undefined ? null : desescapar(v.trim()) || null;
};

/** IVA = 30, IVA exento = 32, monotributo = 20 (tabla de impuestos de ARCA). */
export function condicionIvaDesdeImpuestos(impuestos: number[], tieneMonotributo: boolean): CondicionIvaPadron {
  if (tieneMonotributo || impuestos.includes(20)) return "monotributo";
  if (impuestos.includes(30)) return "responsable_inscripto";
  if (impuestos.includes(32)) return "exento";
  return "consumidor_final";
}

/** Dígito verificador de CUIT/CUIL (módulo 11). */
export function cuitValido(cuit: string): boolean {
  const d = cuit.replace(/\D/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

export class PadronError extends Error {
  constructor(public code: "no_encontrado" | "no_autorizado" | "respuesta_invalida", message: string) {
    super(message);
  }
}

export function leerPersonaA5(xml: string, cuit: string): PersonaPadron {
  const fault = uno(xml, "faultstring");
  if (fault) {
    if (/no existe|inexistente|not found/i.test(fault)) throw new PadronError("no_encontrado", "ARCA no tiene registrado ese CUIT.");
    throw new PadronError("respuesta_invalida", `ARCA respondió: ${fault}`);
  }
  const general = todos(xml, "datosGenerales")[0];
  const errores = todos(xml, "errorConstancia").flatMap(e => todos(e, "error")).map(e => desescapar(e.trim())).filter(Boolean);
  if (!general) {
    if (errores.length) throw new PadronError("no_encontrado", errores[0]);
    throw new PadronError("respuesta_invalida", "ARCA no devolvió los datos de la persona.");
  }

  const razonSocial = uno(general, "razonSocial");
  const nombre = razonSocial ?? [uno(general, "apellido"), uno(general, "nombre")].filter(Boolean).join(" ");
  const tipo = uno(general, "tipoPersona");
  const domicilioFiscal = todos(general, "domicilioFiscal")[0] ?? "";

  const regimen = todos(xml, "datosRegimenGeneral")[0] ?? "";
  const monotributo = todos(xml, "datosMonotributo")[0] ?? "";
  const impuestos = [...todos(regimen, "impuesto"), ...todos(monotributo, "impuesto")]
    .map(i => Number(uno(i, "idImpuesto")))
    .filter(Number.isFinite);
  const categoria = uno(todos(monotributo, "categoriaMonotributo")[0] ?? "", "descripcionCategoria");

  return {
    cuit: cuit.replace(/\D/g, ""),
    nombre: nombre || "Sin nombre en el padrón",
    tipoPersona: tipo === "FISICA" || tipo === "JURIDICA" ? tipo : null,
    condicionIva: condicionIvaDesdeImpuestos(impuestos, !!monotributo.trim()),
    estadoClave: uno(general, "estadoClave"),
    domicilio: uno(domicilioFiscal, "direccion"),
    localidad: uno(domicilioFiscal, "localidad"),
    provincia: uno(domicilioFiscal, "descripcionProvincia"),
    codigoPostal: uno(domicilioFiscal, "codPostal"),
    categoriaMonotributo: categoria,
    avisos: errores,
  };
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function soapGetPersona(token: string, sign: string, cuitRepresentada: string, idPersona: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${escapar(token)}</token>
      <sign>${escapar(sign)}</sign>
      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export const PADRON_URL = {
  produccion: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5",
  homologacion: "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5",
} as const;

export const PADRON_SERVICIO = "ws_sr_constancia_inscripcion";
