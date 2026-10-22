/**
 * WSFEXv1: Factura de exportación «E» (19), nota de débito (20) y nota de
 * crédito (21) por operaciones con el exterior.
 *
 * Contrato tomado del manual oficial «WSFEX – Manual para el desarrollador
 * V 3.1.1» de ARCA (agosto 2025):
 *   - homologación https://wswhomo.afip.gov.ar/wsfexv1/service.asmx
 *   - producción   https://servicios1.afip.gov.ar/wsfexv1/service.asmx
 *   - espacio de nombres http://ar.gov.afip.dif.fexv1/, servicio WSAA «wsfex».
 *   - El punto de venta es de tipo «Comprobantes de Exportación – Web
 *     Services» (FEEWS), distinto del de WSFE.
 *
 * ⚠️ El `Id` del pedido es la protección contra duplicados: si la respuesta se
 * pierde, se reenvía el MISMO `Id` y ARCA devuelve el CAE ya otorgado
 * (`Reproceso = S`) en vez de emitir otro comprobante. Por eso se guarda en la
 * factura antes de llamar y nunca se cambia mientras no haya respuesta.
 */
// @ts-ignore Deno resuelve npm:; Vitest enlaza la misma versión instalada.
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@5.11.2";
import { monedaWsfe } from "./wsfeComprobante.ts";
import { erroresExportacion, TIPOS_EXPORTACION, UMED_UNIDADES, type DatosExportacion } from "./wsfexDatos.ts";
export { erroresExportacion, TIPO_EXPO, TIPOS_EXPORTACION, UMED_UNIDADES } from "./wsfexDatos.ts";
export type { DatosExportacion, PermisoEmbarque } from "./wsfexDatos.ts";

export const WSFEX_URL = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfexv1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfexv1/service.asmx",
} as const;
export const WSFEX_SERVICIO = "wsfex";
const NS = "http://ar.gov.afip.dif.fexv1/";

export interface ComprobanteExportacion {
  issue_date: string;
  customer_name: string;
  currency?: string | null;
  moneda_cotizacion?: number | null;
  cancela_misma_moneda?: boolean | null;
  total: number;
  notes?: string | null;
  invoice_items: { description: string; quantity: number; unit_price: number; total: number }[];
}

export interface AsociadoExportacion { tipo: number; puntoVenta: number; numero: number; cuit: string }

const xmlTexto = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fecha8 = (iso: string, campo: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`${campo}: la fecha no es válida.`);
  return `${m[1]}${m[2]}${m[3]}`;
};
const importe = (n: number) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const decimal6 = (n: number) => String(Math.round(Number(n) * 1e6) / 1e6);

/** El `<ar:Cmp>` de FEXAuthorize, en el orden del WSDL. */
export function cmpFex(c: ComprobanteExportacion, d: DatosExportacion, args: {
  id: number; tipoCbte: number; puntoVenta: number; numero: number; asociado: AsociadoExportacion | null; cotizacion?: number | null;
}): string {
  const { tipoCbte } = args;
  if (!TIPOS_EXPORTACION.has(tipoCbte)) throw new Error("El comprobante no es de exportación.");
  if (!(args.id > 0) || String(Math.trunc(args.id)).length > 15) throw new Error("El identificador del pedido no es válido.");
  const errores = erroresExportacion(d, tipoCbte, c.issue_date);
  if (errores.length) throw new Error(errores[0]);
  const cliente = String(c.customer_name ?? "").trim();
  if (!cliente) throw new Error("El nombre del cliente es obligatorio.");
  if (cliente.length > 200) throw new Error("El nombre del cliente admite hasta 200 caracteres.");
  if (!c.invoice_items?.length) throw new Error("La factura necesita al menos un ítem.");

  const items = c.invoice_items.map(it => {
    const qty = Number(it.quantity), precio = Number(it.unit_price), total = Number(it.total);
    if (!(qty > 0) || precio < 0) throw new Error("Cada ítem necesita cantidad y precio.");
    if (Math.abs(qty * precio - total) > 0.01) throw new Error("El total de un ítem no es cantidad por precio.");
    return `<ar:Item><ar:Pro_ds>${xmlTexto(String(it.description).slice(0, 4000))}</ar:Pro_ds><ar:Pro_qty>${decimal6(qty)}</ar:Pro_qty>` +
      `<ar:Pro_umed>${UMED_UNIDADES}</ar:Pro_umed><ar:Pro_precio_uni>${decimal6(precio)}</ar:Pro_precio_uni>` +
      `<ar:Pro_bonificacion>0</ar:Pro_bonificacion><ar:Pro_total_item>${importe(total)}</ar:Pro_total_item></ar:Item>`;
  });
  const suma = c.invoice_items.reduce((s, it) => s + Math.round(Number(it.total) * 100), 0) / 100;
  if (Math.abs(suma - Number(c.total)) > 0.01) throw new Error("El total de la factura no es la suma de sus ítems.");

  const moneda = monedaWsfe(c.currency);
  const cotizacion = moneda === "PES" ? 1 : Number(c.moneda_cotizacion ?? args.cotizacion ?? 0);
  if (!(cotizacion > 0)) throw new Error("Para facturar en moneda extranjera hace falta la cotización.");

  const factura = tipoCbte === 19;
  const bienes = Number(d.tipo_expo) === 1;
  const permisoExistente = factura && bienes ? d.permiso_existente ?? "" : "";
  const permisos = factura && bienes && d.permiso_existente === "S"
    ? `<ar:Permisos>${(d.permisos ?? []).map(p =>
      `<ar:Permiso><ar:Id_permiso>${xmlTexto(p.id.toUpperCase())}</ar:Id_permiso><ar:Dst_merc>${Number(p.destino)}</ar:Dst_merc></ar:Permiso>`).join("")}</ar:Permisos>`
    : "";
  const cuitPais = String(d.cuit_pais ?? "").replace(/\D/g, "");
  const idImpositivo = String(d.id_impositivo ?? "").trim();
  let asociados = "";
  if (!factura) {
    const a = args.asociado;
    if (!a) throw new Error("La nota de exportación necesita la factura que corrige.");
    asociados = `<ar:Cmps_asoc><ar:Cmp_asoc><ar:Cbte_tipo>${a.tipo}</ar:Cbte_tipo><ar:Cbte_punto_vta>${a.puntoVenta}</ar:Cbte_punto_vta>` +
      `<ar:Cbte_nro>${a.numero}</ar:Cbte_nro><ar:Cbte_cuit>${a.cuit.replace(/\D/g, "")}</ar:Cbte_cuit></ar:Cmp_asoc></ar:Cmps_asoc>`;
  }
  const incoterms = String(d.incoterms ?? "").trim().toUpperCase();
  const obs = String(c.notes ?? "").trim().slice(0, 1000);

  return `<ar:Cmp>` +
    `<ar:Id>${Math.trunc(args.id)}</ar:Id>` +
    `<ar:Fecha_cbte>${fecha8(c.issue_date, "Fecha del comprobante")}</ar:Fecha_cbte>` +
    `<ar:Cbte_Tipo>${tipoCbte}</ar:Cbte_Tipo>` +
    `<ar:Punto_vta>${args.puntoVenta}</ar:Punto_vta>` +
    `<ar:Cbte_nro>${args.numero}</ar:Cbte_nro>` +
    `<ar:Tipo_expo>${Number(d.tipo_expo)}</ar:Tipo_expo>` +
    `<ar:Permiso_existente>${permisoExistente}</ar:Permiso_existente>` +
    permisos +
    `<ar:Dst_cmp>${Number(d.pais_destino)}</ar:Dst_cmp>` +
    `<ar:Cliente>${xmlTexto(cliente)}</ar:Cliente>` +
    (cuitPais ? `<ar:Cuit_pais_cliente>${cuitPais}</ar:Cuit_pais_cliente>` : "") +
    `<ar:Domicilio_cliente>${xmlTexto(String(d.domicilio_cliente).trim())}</ar:Domicilio_cliente>` +
    (idImpositivo ? `<ar:Id_impositivo>${xmlTexto(idImpositivo)}</ar:Id_impositivo>` : "") +
    `<ar:Moneda_Id>${moneda}</ar:Moneda_Id>` +
    `<ar:Moneda_ctz>${decimal6(cotizacion)}</ar:Moneda_ctz>` +
    (factura && moneda !== "PES" ? `<ar:CanMisMonExt>${c.cancela_misma_moneda ? "S" : "N"}</ar:CanMisMonExt>` : "") +
    (String(d.obs_comerciales ?? "").trim() ? `<ar:Obs_comerciales>${xmlTexto(String(d.obs_comerciales).trim())}</ar:Obs_comerciales>` : "") +
    `<ar:Imp_total>${importe(c.total)}</ar:Imp_total>` +
    (obs ? `<ar:Obs>${xmlTexto(obs)}</ar:Obs>` : "") +
    asociados +
    (String(d.forma_pago ?? "").trim() ? `<ar:Forma_pago>${xmlTexto(String(d.forma_pago).trim())}</ar:Forma_pago>` : "") +
    (incoterms ? `<ar:Incoterms>${incoterms}</ar:Incoterms>` : "") +
    (incoterms && String(d.incoterms_ds ?? "").trim() ? `<ar:Incoterms_Ds>${xmlTexto(String(d.incoterms_ds).trim())}</ar:Incoterms_Ds>` : "") +
    `<ar:Idioma_cbte>${Number(d.idioma)}</ar:Idioma_cbte>` +
    `<ar:Items>${items.join("")}</ar:Items>` +
    (factura && d.fecha_pago ? `<ar:Fecha_pago>${fecha8(d.fecha_pago, "Fecha de pago")}</ar:Fecha_pago>` : "") +
    `</ar:Cmp>`;
}

/** El sobre SOAP. `extraAuth` es para FEXGetLast_CMP, que lleva punto y tipo dentro de Auth. */
export function soapFex(operacion: string, cuerpo: string, auth: { token: string; sign: string; cuit: string }, extraAuth = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soap:Body>` +
    `<ar:${operacion}><ar:Auth><ar:Token>${xmlTexto(auth.token)}</ar:Token><ar:Sign>${xmlTexto(auth.sign)}</ar:Sign>` +
    `<ar:Cuit>${auth.cuit.replace(/\D/g, "")}</ar:Cuit>${extraAuth}</ar:Auth>${cuerpo}</ar:${operacion}>` +
    `</soap:Body></soap:Envelope>`;
}

export const soapActionFex = (operacion: string) => `${NS}${operacion}`;

// ── Respuestas ───────────────────────────────────────────────────────────────

export class WsfexError extends Error {
  constructor(public codigo: number, message: string) { super(message); }
}

// deno-lint-ignore no-explicit-any
function resultado(xml: string, operacion: string): Record<string, any> {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new WsfexError(-1, "ARCA devolvió una respuesta que no pudimos leer.");
  }
  const body = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml)?.Envelope?.Body;
  if (body?.Fault) throw new WsfexError(-1, `ARCA no procesó el pedido: ${String(body.Fault.faultstring ?? "").slice(0, 200)}`);
  const r = body?.[`${operacion}Response`]?.[`${operacion}Result`];
  if (!r || typeof r !== "object") throw new WsfexError(-1, "ARCA no confirmó la respuesta.");
  return r;
}

const texto = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const iso = (v: unknown) => { const t = texto(v); return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null; };

// deno-lint-ignore no-explicit-any
function errorFex(r: Record<string, any>): { codigo: number; mensaje: string } | null {
  const err = r.FEXErr;
  const codigo = Number(texto(err?.ErrCode) || 0);
  if (!codigo) return null;
  return { codigo, mensaje: texto(err?.ErrMsg ?? err?.Errmsg) || "Error de ARCA" };
}

export interface AutorizacionFex {
  resultado: "A" | "R" | null;
  cae: string | null;
  vencimiento: string | null;
  numero: number | null;
  puntoVenta: number | null;
  tipo: number | null;
  reproceso: boolean;
  observaciones: string;
  error: { codigo: number; mensaje: string } | null;
}

export function leerAutorizacionFex(xml: string): AutorizacionFex {
  const r = resultado(xml, "FEXAuthorize");
  const a = r.FEXResultAuth ?? {};
  const res = texto(a.Resultado);
  const cae = texto(a.Cae);
  return {
    resultado: res === "A" || res === "R" ? res : null,
    cae: /^\d{14}$/.test(cae) ? cae : null,
    vencimiento: iso(a.Fch_venc_Cae),
    numero: Number(texto(a.Cbte_nro)) || null,
    puntoVenta: Number(texto(a.Punto_vta)) || null,
    tipo: Number(texto(a.Cbte_Tipo)) || null,
    reproceso: texto(a.Reproceso) === "S",
    observaciones: texto(a.Motivos_Obs),
    error: errorFex(r),
  };
}

export function leerUltimoFex(xml: string): number {
  const r = resultado(xml, "FEXGetLast_CMP");
  const e = errorFex(r);
  if (e) throw new WsfexError(e.codigo, e.mensaje);
  const n = Number(texto(r.FEXResult_LastCMP?.Cbte_nro));
  if (!Number.isInteger(n) || n < 0) throw new WsfexError(-1, "ARCA no devolvió el último comprobante autorizado.");
  return n;
}

export function leerCotizacionFex(xml: string): { cotizacion: number; fecha: string | null } {
  const r = resultado(xml, "FEXGetPARAM_Ctz");
  const e = errorFex(r);
  if (e) throw new WsfexError(e.codigo, e.mensaje);
  const cotizacion = Number(texto(r.FEXResultGet?.Mon_ctz));
  if (!(cotizacion > 0)) throw new WsfexError(-1, "ARCA no devolvió la cotización.");
  return { cotizacion, fecha: iso(r.FEXResultGet?.Mon_fecha) };
}

/** Cada método de parámetros devuelve su lista con nombres propios: este es el mapa. */
export const PARAMETROS_FEX = {
  paises: { op: "FEXGetPARAM_DST_pais", fila: "ClsFEXResponse_DST_pais", codigo: "DST_Codigo", ds: "DST_Ds" },
  cuit_paises: { op: "FEXGetPARAM_DST_CUIT", fila: "ClsFEXResponse_DST_cuit", codigo: "DST_CUIT", ds: "DST_Ds" },
  incoterms: { op: "FEXGetPARAM_Incoterms", fila: "ClsFEXResponse_Inc", codigo: "Inc_Id", ds: "Inc_Ds" },
  monedas: { op: "FEXGetPARAM_MON", fila: "ClsFEXResponse_Mon", codigo: "Mon_Id", ds: "Mon_Ds" },
  puntos_venta: { op: "FEXGetPARAM_PtoVenta", fila: "ClsFEXResponse_PtoVenta", codigo: "Pve_Nro", ds: "Pve_Bloqueado" },
} as const;
export type ParametroFex = keyof typeof PARAMETROS_FEX;

export function leerParametroFex(xml: string, tipo: ParametroFex): { codigo: string; descripcion: string }[] {
  const p = PARAMETROS_FEX[tipo];
  const r = resultado(xml, p.op);
  const e = errorFex(r);
  if (e) throw new WsfexError(e.codigo, e.mensaje);
  const filas = r.FEXResultGet?.[p.fila];
  const lista = Array.isArray(filas) ? filas : filas ? [filas] : [];
  // deno-lint-ignore no-explicit-any
  return lista.map((f: any) => ({ codigo: texto(f?.[p.codigo]), descripcion: texto(f?.[p.ds]) })).filter((f: { codigo: string }) => f.codigo);
}
