/**
 * Reglas del certificado de ARCA que no dependen de criptografía: se comparten
 * entre el certificado de la plataforma (`afip-platform-cert`) y el de cada
 * comercio (`afip-credentials`), y se prueban sin Deno.
 */

export type AmbienteArca = "homologacion" | "produccion";

/**
 * Alias del computador fiscal en ARCA. Al renovar, el certificado nuevo se
 * agrega al mismo alias y la asociación a Facturación Electrónica se conserva.
 */
export const ALIAS_ARCA = "nerqia";

export const esAmbienteArca = (v: unknown): v is AmbienteArca => v === "produccion" || v === "homologacion";

export const wsaaUrl = (ambiente: AmbienteArca | string) => ambiente === "produccion"
  ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
  : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

/** ARCA firma los certificados de prueba como «Computadores Test». */
export const esEmisorDeHomologacion = (emisor: string | null | undefined) => /test/i.test(emisor ?? "");

/**
 * Qué significa un rechazo de WSAA para quien está conectando su certificado.
 * Se lee del mensaje de `motivoDeWsaa`, que incluye el código de ARCA.
 *   · no_asociado: el certificado es válido pero no está asociado a
 *     Facturación Electrónica (el comercio tiene que hacer ese paso).
 *   · no_confiable: no lo emitió ARCA o es de otro ambiente.
 *   · vencido.
 *   · ticket_vigente: ARCA ya dio un ticket para este certificado; no es un
 *     problema del certificado.
 */
export type RechazoWsaa = "no_asociado" | "no_confiable" | "vencido" | "ticket_vigente" | "no_disponible" | "otro";

export function clasificarRechazoWsaa(mensaje: string): RechazoWsaa {
  const m = mensaje.toLowerCase();
  if (m.includes("coe.notauthorized") || m.includes("no tiene autorizado el servicio")) return "no_asociado";
  if (m.includes("cms.cert.untrusted")) return "no_confiable";
  if (m.includes("cms.cert.expired")) return "vencido";
  if (m.includes("coe.alreadyauthenticated")) return "ticket_vigente";
  if (m.includes("wsaa.unavailable") || m.includes("wsaa.internalerror") || m.includes("fetch") || m.includes("timed out")) return "no_disponible";
  return "otro";
}

/** Mensaje para el comercio según el rechazo, con el paso que lo resuelve. */
export function explicarRechazoWsaa(tipo: RechazoWsaa, ambiente: AmbienteArca | string): string {
  switch (tipo) {
    case "no_asociado":
      return "El certificado es válido, pero en ARCA todavía no está asociado a Facturación Electrónica. "
        + `Hacé el paso «Asociar a Facturación Electrónica» con el alias ${ALIAS_ARCA} y probá de nuevo.`;
    case "no_confiable":
      return ambiente === "produccion"
        ? "ARCA no reconoce este certificado para facturar de verdad: puede ser de homologación (pruebas). Generá el pedido de producción."
        : "ARCA no reconoce este certificado en homologación: puede ser de producción. Generá el pedido de homologación.";
    case "vencido":
      return "El certificado venció. Generá un pedido nuevo y renovalo en ARCA.";
    case "ticket_vigente":
      return "ARCA ya tiene una sesión abierta con este certificado. Esperá unos minutos y probá de nuevo.";
    case "no_disponible":
      return "ARCA no respondió. Tu certificado quedó guardado; probá de nuevo en unos minutos.";
    default:
      return "ARCA rechazó el certificado.";
  }
}

/** Días enteros hasta el vencimiento (negativo si ya venció). */
export function diasParaVencer(expiresAt: string | null | undefined, ahora = new Date()): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - ahora.getTime()) / 86_400_000);
}

/** Razón social apta para el subject del pedido: ASCII, sin caracteres de control. */
export function organizacionParaSubject(razonSocial: string | null | undefined): string {
  return String(razonSocial || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,&-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64) || "Comercio";
}
