/**
 * Controlador fiscal Epson TM-T900FA — Protocolo Extendido por HTTP(S).
 *
 * Fuente: "Protocolo de Comunicación — Impresora Fiscal Argentina Estándar",
 * Epson Argentina, rev. F (09/03/2021, firmware 1.03 "Neptuno"):
 * - §4.3.1  POST /ext con {"command","command_extension","fields"}; HTTP
 *           puerto 80 (desde 1.02 "Jano"), HTTPS puerto 8443 (desde Neptuno).
 * - §4.3.3  POST /ext/batch: comandos en orden; se detiene ante un error.
 * - §4.3.4  POST /config/ws/headers: encabezados CORS para apps web.
 * - §4.4    Tipo numérico (N) sólo admite dígitos: los decimales de un campo
 *           "e,d" van implícitos (valor × 10^d).
 * - §6.9    Tique-Factura A/B/C (0B): Abrir 0B01, Item 0B02, Pagos 0B05,
 *           Cerrar 0B06, Cancelar 0B07.
 * Strings: sólo ASCII de 7 bits, sin caracteres de control.
 *
 * ⚠️ Verificado contra el manual, no contra un equipo: la certificación se
 * hace en Modo Entrenamiento del controlador antes de facturar en serio.
 */
import type { CondicionIva } from "@/lib/fiscalIdentity";

export type EpsonCommand = {
  command: string;
  command_extension: string;
  fields?: string[];
  "ignore error"?: boolean;
};

export type EpsonResponse = {
  "return code": string;
  "fiscal status"?: string;
  "printer status"?: string;
  fields?: string[];
};

export type UnidadMedida = "unidad" | "kg" | "metro" | "litro" | "metro2" | "gramo";

export type ItemControlador = {
  descripcion: string;
  cantidad: number;
  /** Precio unitario final, con IVA incluido (como cobra el POS). */
  precioUnitario: number;
  /** Alícuota de IVA (21, 10.5, 27, 0…). Se ignora si el emisor no discrimina IVA. */
  tasaIva: number;
  /** Código interno del producto (SKU o id); el protocolo exige uno. */
  codigo: string;
  unidad?: UnidadMedida;
};

export type PagoControlador = {
  medio: "efectivo" | "debito" | "credito" | "transferencia" | "qr" | "cuenta_corriente" | "otro";
  monto: number;
  cuotas?: number;
};

export type CompradorControlador = {
  nombre: string;
  domicilio?: string | null;
  documentoTipo?: "CUIT" | "DNI" | null;
  documentoNumero?: string | null;
  condicion: CondicionIva;
};

export type DocumentoControlador = {
  comprador?: CompradorControlador | null;
  items: ItemControlador[];
  pagos: PagoControlador[];
  /** Emisor monotributista o exento: tasa 0 y condición "no corresponde". */
  emisorSinIva: boolean;
};

const UNIDADES: Record<UnidadMedida, string> = { unidad: "7", kg: "1", metro: "2", metro2: "3", litro: "5", gramo: "14" };
const MEDIOS: Record<PagoControlador["medio"], string> = {
  efectivo: "8", debito: "21", credito: "20", transferencia: "23", qr: "24", cuenta_corriente: "6", otro: "99",
};
const RESPONSABILIDAD: Record<CondicionIva, string> = {
  responsable_inscripto: "I", monotributo: "M", exento: "E", consumidor_final: "F",
};

/** Texto ASCII imprimible: sin tildes ni caracteres de control, acotado. */
export function textoEpson(valor: string | null | undefined, max = 40): string {
  return String(valor ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n").replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\|/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Campo numérico "e,d" con decimales implícitos: 12.5 con d=4 → "125000". */
export function numeroEpson(valor: number, enteros: number, decimales: number): string {
  if (!Number.isFinite(valor) || valor < 0) throw new Error("Importe inválido para el controlador fiscal");
  const escalado = Math.round(valor * 10 ** decimales);
  if (String(escalado).length > enteros + decimales) throw new Error("Importe demasiado grande para el controlador fiscal");
  return String(escalado);
}

const hex4 = (bits: number) => bits.toString(16).toUpperCase().padStart(4, "0");

export function loteFacturaEpson(doc: DocumentoControlador): EpsonCommand[] {
  if (!doc.items.length) throw new Error("El ticket no tiene productos");
  const comprador = doc.comprador;
  const condicion = comprador?.condicion ?? "consumidor_final";
  const documento = String(comprador?.documentoNumero ?? "").replace(/[^0-9]/g, "");
  if (condicion !== "consumidor_final" && (comprador?.documentoTipo !== "CUIT" || documento.length !== 11)) {
    throw new Error("Un comprador que no es consumidor final necesita CUIT");
  }
  const tipoDoc = documento ? (comprador?.documentoTipo === "CUIT" ? "T" : "D") : "";
  const nombre = textoEpson(comprador?.nombre || (condicion === "consumidor_final" ? "Consumidor Final" : ""));

  const abrir: EpsonCommand = {
    command: "0B01",
    command_extension: "0000",
    fields: [nombre, "", textoEpson(comprador?.domicilio), "", "", tipoDoc, tipoDoc ? documento : "", RESPONSABILIDAD[condicion], "", "", "", ""],
  };

  // Bit 14: los importes son brutos (IVA incluido), que es lo que cobra el POS.
  const items: EpsonCommand[] = doc.items.map(item => {
    if (!(item.cantidad > 0)) throw new Error(`Cantidad inválida en «${item.descripcion}»`);
    const tasa = doc.emisorSinIva ? 0 : item.tasaIva;
    return {
      command: "0B02",
      command_extension: hex4(1 << 14),
      fields: [
        "", "", "", "",
        textoEpson(item.descripcion) || "Producto",
        numeroEpson(item.cantidad, 5, 4),
        numeroEpson(item.precioUnitario, 7, 4),
        numeroEpson(tasa, 2, 2),
        "", "", "", "",
        textoEpson(item.codigo, 50) || "S/C",
        UNIDADES[item.unidad ?? "unidad"],
        doc.emisorSinIva ? "0" : "7",
      ],
    };
  });

  const pagos: EpsonCommand[] = doc.pagos.filter(p => p.monto > 0).map(p => ({
    command: "0B05",
    command_extension: "0000",
    fields: ["", "", p.cuotas && p.cuotas > 1 ? String(p.cuotas) : "", "", "", MEDIOS[p.medio], numeroEpson(p.monto, 10, 2)],
  }));

  // Bit 0: cortar papel. Bit 1: devolver número, tipo y totales.
  const cerrar: EpsonCommand = { command: "0B06", command_extension: hex4(0b11), fields: ["", "", "", "", "", ""] };
  return [abrir, ...items, ...pagos, cerrar];
}

/** Cancela un tique-factura que quedó abierto por un error a mitad del lote. */
export const CANCELAR_FACTURA_EPSON: EpsonCommand = { command: "0B07", command_extension: "0000" };
export const ESTADO_EPSON: EpsonCommand = { command: "0001", command_extension: "0000" };
export const INFORMACION_EPSON: EpsonCommand = { command: "020A", command_extension: "0000" };
export const ABRIR_CAJON_EPSON: EpsonCommand = { command: "0707", command_extension: "0000" };
export const CIERRE_Z_EPSON: EpsonCommand = { command: "0801", command_extension: "0000" };

const MENSAJES: Record<string, string> = {
  "0001": "Error interno del controlador fiscal.",
  "0101": "El controlador no acepta esa operación ahora (puede haber un comprobante abierto).",
  "0102": "Operación inválida para el comprobante abierto.",
  "0205": "Falta un dato obligatorio del comprobante.",
  "0208": "Un importe o cantidad no tiene el formato que espera el controlador.",
  "0210": "Un dato supera el largo permitido.",
  "0211": "El controlador no reconoce una opción del comando: revisá el firmware.",
  "0301": "Error de hardware en el controlador fiscal.",
  "0302": "El controlador fiscal está fuera de línea.",
  "0303": "Error de impresión.",
  "0304": "Revisá el papel del controlador fiscal.",
  "0305": "Queda poco papel.",
  "0B01": "Tipo de documento del comprador inválido.",
  "0B02": "Se superó el importe máximo aceptado.",
  "0B03": "CUIT/CUIL del comprador inválido.",
  "0B0D": "Número de documento del comprador inválido.",
};

export function mensajeRetornoEpson(codigo: string): string {
  return MENSAJES[codigo.toUpperCase()] ?? `El controlador fiscal respondió el código ${codigo.toUpperCase()}.`;
}

export type ResultadoFacturaEpson =
  | { ok: true; numero: string; tipo: string; total: string; iva: string }
  | { ok: false; error: string; codigo: string; documentoAbierto: boolean };

/**
 * Interpreta la respuesta del lote. El equipo frena en el primer error: si
 * la apertura salió bien y algo posterior falló, el comprobante quedó abierto
 * y hay que cancelarlo antes de reintentar.
 */
export function interpretarLoteFactura(respuestas: unknown, lote: EpsonCommand[]): ResultadoFacturaEpson {
  const lista = (Array.isArray(respuestas) ? respuestas : []).flat() as EpsonResponse[];
  if (!lista.length) return { ok: false, error: "El controlador fiscal no respondió.", codigo: "", documentoAbierto: false };
  const fallo = lista.findIndex(r => String(r?.["return code"] ?? "") !== "0000");
  if (fallo >= 0) {
    const codigo = String(lista[fallo]?.["return code"] ?? "");
    return { ok: false, error: mensajeRetornoEpson(codigo), codigo, documentoAbierto: fallo > 0 };
  }
  if (lista.length < lote.length) {
    return { ok: false, error: "El controlador no ejecutó todo el comprobante.", codigo: "", documentoAbierto: true };
  }
  const [numero = "", tipo = "", total = "", iva = ""] = lista[lista.length - 1]?.fields ?? [];
  return { ok: true, numero, tipo, total, iva };
}
