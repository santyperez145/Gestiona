import { extraerXml } from "./wsaaRespuesta.ts";

function bloquesXml(xml: string, tag: string): string[] {
  const pattern = new RegExp(
    `<(?:[^:>\\s]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[^:>\\s]+:)?${tag}>`,
    "gi",
  );
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Errores de negocio de WSFE. Un HTTP 200 no implica que la operación haya
 * sido aceptada: ARCA informa varios rechazos dentro de `<Errors><Err>`.
 */
export function erroresWsfe(xml: string): string[] {
  const fault = extraerXml(xml, "faultstring");
  if (fault) return [fault];

  return bloquesXml(xml, "Err").slice(0, 5).map((bloque) => {
    const code = extraerXml(bloque, "Code");
    const message = extraerXml(bloque, "Msg");
    if (code && message) return `${message} (código ${code})`;
    return message || (code ? `ARCA respondió con el código ${code}` : "ARCA rechazó la consulta");
  });
}

/**
 * Lee FECompUltimoAutorizado sin convertir una respuesta incompleta o un
 * rechazo embebido en un falso número cero. Cero sólo es válido cuando ARCA
 * envió explícitamente `<CbteNro>0</CbteNro>`.
 */
export function leerUltimoAutorizadoWsfe(xml: string): number {
  const errors = erroresWsfe(xml);
  if (errors.length) throw new Error(`ARCA rechazó la consulta: ${errors.join(" · ")}`);

  const raw = extraerXml(xml, "CbteNro");
  if (raw === null || !/^\d+$/.test(raw)) {
    throw new Error("ARCA respondió sin un número de comprobante autorizado válido");
  }
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("ARCA devolvió un número de comprobante fuera de rango");
  }
  return number;
}
