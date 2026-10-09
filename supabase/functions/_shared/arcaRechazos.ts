/**
 * Traducción de errores y observaciones de WSFEv1 (FECAESolicitar) a una
 * explicación accionable para el comercio.
 *
 * Fuente: manual del desarrollador WSFEv1 v4.7 (RG 4291), tablas de
 * "errores internos de infraestructura", validaciones de FECAESolicitar y
 * códigos de observación. Revisado el 2026-10-09. Sólo se traducen códigos
 * leídos en el manual; un código desconocido conserva el texto oficial de ARCA.
 *
 * Esta capa no decide importes ni impuestos: explica y clasifica. Corregir un
 * dato fiscal sigue siendo una acción revisada del comercio.
 */

export type MensajeArca = { code: number; msg: string };

/** Qué debe hacer el comercio. La UI lo usa para orientar, nunca para corregir sola. */
export type AccionFiscal =
  | "corregir_cliente"
  | "corregir_importes"
  | "revisar_comprobante_asociado"
  | "revisar_fecha_numeracion"
  | "revisar_punto_venta"
  | "revisar_conexion_arca"
  | "consultar_contador"
  | "reintentar";

/**
 * - `rechazo`: ARCA no autorizó; el número no se consumió.
 * - `conexion`: falla de autorización del servicio (token/delegación).
 * - `transitorio`: error interno de ARCA; el resultado puede ser incierto y se
 *   concilia antes de volver a emitir.
 * - `advertencia`: observación no excluyente; acompaña un CAE otorgado.
 */
export type ClaseMensajeArca = "rechazo" | "conexion" | "transitorio" | "advertencia";

export type ExplicacionArca = {
  code: number;
  titulo: string;
  queHacer: string;
  accion: AccionFiscal;
  clase: ClaseMensajeArca;
};

type Entrada = Omit<ExplicacionArca, "code">;

const rechazo = (accion: AccionFiscal, titulo: string, queHacer: string): Entrada =>
  ({ accion, titulo, queHacer, clase: "rechazo" });

const CATALOGO: Record<number, Entrada> = {
  // Infraestructura (Errors).
  500: { clase: "transitorio", accion: "reintentar", titulo: "ARCA tuvo un error interno de aplicación", queHacer: "Nerqia verifica si el comprobante quedó autorizado antes de volver a intentarlo." },
  501: { clase: "transitorio", accion: "reintentar", titulo: "ARCA tuvo un error interno de base de datos", queHacer: "Nerqia verifica si el comprobante quedó autorizado antes de volver a intentarlo." },
  502: { clase: "transitorio", accion: "reintentar", titulo: "ARCA tenía otra autorización en curso", queHacer: "Nerqia verifica si el comprobante quedó autorizado antes de volver a intentarlo." },
  600: { clase: "conexion", accion: "revisar_conexion_arca", titulo: "ARCA no aceptó la autorización del servicio", queHacer: "Revisá la conexión con ARCA en Facturación electrónica y volvé a verificarla." },
  601: { clase: "conexion", accion: "revisar_conexion_arca", titulo: "El CUIT no está autorizado para este servicio", queHacer: "Confirmá en ARCA la delegación de Factura electrónica (wsfe) y volvé a verificar la conexión." },

  // Receptor.
  10013: rechazo("corregir_cliente", "La factura A necesita el CUIT del cliente", "Cargá el CUIT del cliente o emití el comprobante como factura B."),
  10015: rechazo("corregir_cliente", "El documento del cliente no es válido para este comprobante", "Revisá tipo y número de documento del cliente. Por encima del monto de la RG 4444 hay que identificarlo."),
  10017: rechazo("corregir_cliente", "El CUIT del cliente no figura activo en el padrón de ARCA", "Verificá el CUIT del cliente. Si es correcto y no está activo, emití factura B."),
  10063: rechazo("corregir_cliente", "La factura A requiere un cliente inscripto en IVA o monotributista activo", "Revisá la condición fiscal del cliente o emití factura B."),
  10069: rechazo("corregir_cliente", "El documento del cliente es el mismo que el del emisor", "Corregí el documento del cliente."),
  10195: rechazo("consultar_contador", "El CUIT del cliente está inactivo por facturas apócrifas", "No emitas a este CUIT sin revisarlo con tu contador."),
  10238: rechazo("corregir_cliente", "El CUIT del cliente no existe", "Corregí el CUIT del cliente."),
  10242: rechazo("corregir_cliente", "La condición frente al IVA del cliente no es válida", "Revisá la condición frente al IVA cargada en el cliente."),
  10243: rechazo("corregir_cliente", "La condición frente al IVA del cliente no corresponde a esta clase de comprobante", "Revisá la condición del cliente o la clase de comprobante (A, B o C)."),
  10245: rechazo("corregir_cliente", "Falta la condición frente al IVA del cliente", "Cargá la condición frente al IVA del cliente (RG 5616)."),
  10246: rechazo("corregir_cliente", "Falta la condición frente al IVA del cliente", "Cargá la condición frente al IVA del cliente (RG 5616)."),
  10247: rechazo("corregir_cliente", "El CUIT del cliente está inactivo o es inválido", "Verificá el CUIT con el cliente antes de volver a emitir."),
  10248: rechazo("consultar_contador", "El CUIT del cliente está limitado por ARCA", "ARCA lo caracteriza como sujeto no confiable en seguridad social. Revisalo con tu contador."),
  10249: rechazo("corregir_cliente", "El documento del cliente corresponde a una persona fallecida", "Verificá el documento del cliente."),

  // Numeración y fecha.
  10016: rechazo("revisar_fecha_numeracion", "El número o la fecha no son los que ARCA espera", "Reintentá: Nerqia vuelve a consultar el último número. Para productos la fecha debe estar dentro de ±5 días, en el mes, y no ser anterior al último comprobante."),

  // Importes.
  10018: rechazo("corregir_importes", "Falta el detalle de IVA por alícuota", "Revisá los renglones y sus alícuotas. Si el error se repite, avisá a soporte con el número de factura."),
  10023: rechazo("corregir_importes", "El IVA por alícuota no suma el IVA total", "Revisá los renglones y sus alícuotas. Si el error se repite, avisá a soporte con el número de factura."),
  10048: rechazo("corregir_importes", "El total no coincide con la suma de neto, IVA y tributos", "Revisá descuentos y renglones. Si el error se repite, avisá a soporte con el número de factura."),
  10061: rechazo("corregir_importes", "Las bases imponibles no suman el neto gravado", "Revisá los renglones y sus alícuotas. Si el error se repite, avisá a soporte con el número de factura."),
  10070: rechazo("corregir_importes", "Falta el detalle de IVA para un neto gravado", "Revisá los renglones y sus alícuotas. Si el error se repite, avisá a soporte con el número de factura."),
  10071: rechazo("consultar_contador", "Un comprobante C no puede informar IVA", "Revisá tu condición fiscal en Facturación electrónica: puede no coincidir con la registrada en ARCA."),

  // Comprobantes asociados (NC/ND).
  10040: rechazo("revisar_comprobante_asociado", "El comprobante asociado no es compatible con esta nota", "Asociá una factura de la misma clase (A con A, B con B, C con C)."),
  10041: rechazo("revisar_comprobante_asociado", "ARCA no encuentra el comprobante asociado", "Revisá que la factura original esté autorizada en el mismo punto de venta y tipo."),
  10197: rechazo("revisar_comprobante_asociado", "La nota necesita un comprobante asociado", "Asociá la factura original antes de autorizar la nota."),
  10237: { clase: "advertencia", accion: "revisar_comprobante_asociado", titulo: "La nota de crédito supera el comprobante que ajusta", queHacer: "Revisá los importes. Si fue un error, corresponde un ajuste o anulación." },

  // Emisor.
  10096: rechazo("revisar_punto_venta", "Un emisor exento necesita un punto de venta “Exento en IVA – Web Services”", "Creá o elegí ese tipo de punto de venta en ARCA y actualizalo en Facturación electrónica."),
  10188: rechazo("consultar_contador", "Correspondería una Factura de Crédito Electrónica MiPyME", "Nerqia todavía no emite FCE MiPyME. Revisá la operación con tu contador."),
  10192: rechazo("consultar_contador", "Correspondería una Factura de Crédito Electrónica MiPyME", "Nerqia todavía no emite FCE MiPyME. Revisá la operación con tu contador."),
  10234: rechazo("consultar_contador", "Falta la habilitación para emitir comprobantes A", "Presentá en ARCA el formulario de habilitación de comprobantes A o emití B."),
  10235: { clase: "advertencia", accion: "consultar_contador", titulo: "El comprobante supera el tope de la categoría máxima de Monotributo", queHacer: "Revisalo con tu contador: puede corresponder la exclusión del régimen." },
  10236: { clase: "advertencia", accion: "consultar_contador", titulo: "El comprobante supera el tope de tu categoría de Monotributo", queHacer: "Tenelo en cuenta para la próxima recategorización." },
};

export function explicarCodigoArca(code: number): ExplicacionArca | null {
  const entrada = CATALOGO[code];
  return entrada ? { code, ...entrada } : null;
}

const MAX_TEXTO_OFICIAL = 240;

/** El texto de ARCA se muestra tal cual, sin marcado ni longitud ilimitada. */
function textoOficial(msg: string): string {
  const limpio = msg.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > MAX_TEXTO_OFICIAL ? `${limpio.slice(0, MAX_TEXTO_OFICIAL - 1)}…` : limpio;
}

export type ResumenRechazoArca = {
  /** Estado de autorización equivalente al resto de afip-authorize. */
  estado: "rejected" | "config_error" | "network_error";
  mensaje: string;
  codigos: number[];
  accion: AccionFiscal;
};

const PRIORIDAD: Record<ClaseMensajeArca, number> = { transitorio: 0, conexion: 1, rechazo: 2, advertencia: 3 };

/**
 * Resume un comprobante no autorizado. Errors y Observaciones pueden explicar
 * el rechazo; las advertencias sólo acompañan. Un error de infraestructura
 * domina: el resultado es incierto y se concilia antes de reintentar.
 */
export function resumirRechazoArca(errores: MensajeArca[], observaciones: MensajeArca[]): ResumenRechazoArca {
  const mensajes = [...errores, ...observaciones].filter(m => Number.isSafeInteger(m.code));
  const codigos = [...new Set(mensajes.map(m => m.code))];
  const candidatos = mensajes
    .map(m => ({ mensaje: m, explicacion: explicarCodigoArca(m.code) }))
    .sort((a, b) =>
      PRIORIDAD[a.explicacion?.clase ?? "rechazo"] - PRIORIDAD[b.explicacion?.clase ?? "rechazo"]);
  const principal = candidatos.find(c => c.explicacion?.clase !== "advertencia") ?? candidatos[0];

  if (!principal) {
    return {
      estado: "rejected",
      mensaje: "ARCA rechazó el comprobante sin informar el motivo. Reintentá; si se repite, avisá a soporte con el número de factura.",
      codigos,
      accion: "reintentar",
    };
  }

  const { mensaje, explicacion } = principal;
  const otros = codigos.filter(code => code !== mensaje.code);
  const sufijoOtros = otros.length ? ` Otros códigos: ${otros.join(", ")}.` : "";
  if (!explicacion) {
    const oficial = textoOficial(mensaje.msg);
    return {
      estado: "rejected",
      mensaje: `ARCA rechazó el comprobante (código ARCA ${mensaje.code})${oficial ? `: ${oficial}` : "."}${sufijoOtros}`,
      codigos,
      accion: "consultar_contador",
    };
  }

  const estado = explicacion.clase === "transitorio" ? "network_error"
    : explicacion.clase === "conexion" ? "config_error"
    : "rejected";
  return {
    estado,
    mensaje: `${explicacion.titulo}. ${explicacion.queHacer} (código ARCA ${mensaje.code})${sufijoOtros}`,
    codigos,
    accion: explicacion.accion,
  };
}

/** Advertencias que ARCA adjunta a un CAE otorgado; no invalidan la autorización. */
export function advertenciasArca(observaciones: MensajeArca[]): ExplicacionArca[] {
  return observaciones
    .map(o => explicarCodigoArca(o.code))
    .filter((e): e is ExplicacionArca => e?.clase === "advertencia");
}

/** Recupera las explicaciones desde un mensaje ya persistido en `invoices.afip_error`. */
export function explicacionesDesdeMensaje(mensaje: string | null | undefined): ExplicacionArca[] {
  if (!mensaje) return [];
  const codigos = new Set<number>();
  const principal = /código ARCA (\d{3,5})/.exec(mensaje);
  if (principal) codigos.add(Number(principal[1]));
  const otros = /Otros códigos: ([\d, ]+)\./.exec(mensaje);
  otros?.[1].split(",").forEach(c => { const n = Number(c.trim()); if (n) codigos.add(n); });
  return [...codigos].map(explicarCodigoArca).filter((e): e is ExplicacionArca => e !== null);
}

/**
 * Error que `solicitarCAE` usa para que afip-authorize persista el estado sin
 * clasificar por subcadenas del mensaje.
 */
export class ArcaAutorizacionError extends Error {
  constructor(
    public estado: "rejected" | "config_error" | "network_error",
    message: string,
    public codigos: number[] = [],
  ) {
    super(message);
  }
}
