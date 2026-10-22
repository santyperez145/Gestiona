/**
 * Contingencia CAEA en el panel (2026-10-22): cuándo se ofrece emitir una
 * factura con CAEA y cómo se lee el informe a ARCA. La emisión y los informes
 * los hace `arca-caea`; la regla dura (nunca con un CAE sin confirmar) vive en
 * `afip_caea_emitir`. Ver la migración 20261022000900.
 */

export interface EstadoContingencia {
  habilitada: boolean;
  punto_venta_caea: number | null;
  punto_venta: number | null;
  caea_vigente: CaeaGuardado | null;
  caea_proximo: CaeaGuardado | null;
  pendientes_de_informar: number;
  rechazados: number;
}

export interface CaeaGuardado {
  caea: string;
  periodo: number;
  orden: number;
  vig_desde: string;
  vig_hasta: string;
  tope_informe: string;
}

interface FacturaParaContingencia {
  cae: string | null;
  tipo_comprobante: number | null;
  afip_status: string | null;
  codigo_autorizacion_tipo?: string | null;
  caea_informado_at?: string | null;
  caea_informe_error?: string | null;
}

/** La Factura de Crédito MiPyME y sus notas no se emiten en contingencia. */
const FCE = new Set([201, 202, 203, 206, 207, 208, 211, 212, 213]);

/**
 * Se ofrece sólo cuando ARCA no respondió: con un rechazo o un error de
 * configuración, el CAEA no arregla nada y el comprobante se rechazaría al
 * informarlo.
 */
export function puedeEmitirEnContingencia(inv: FacturaParaContingencia, habilitada: boolean): boolean {
  return habilitada && !inv.cae && !!inv.tipo_comprobante && !FCE.has(inv.tipo_comprobante)
    && (inv.afip_status === "network_error" || inv.afip_status === "error");
}

export const esCaea = (inv: FacturaParaContingencia) => inv.codigo_autorizacion_tipo === "A" && !!inv.cae;

export type InformeCaea = "informado" | "pendiente" | "rechazado";

export function informeCaea(inv: FacturaParaContingencia): InformeCaea | null {
  if (!esCaea(inv)) return null;
  if (inv.caea_informado_at) return "informado";
  return inv.caea_informe_error ? "rechazado" : "pendiente";
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** 202610, 2 → «2.ª quincena de octubre de 2026». */
export function nombreQuincena(periodo: number, orden: number): string {
  const anio = Math.floor(periodo / 100), mes = periodo % 100;
  return `${orden === 1 ? "1.ª" : "2.ª"} quincena de ${MESES[mes - 1] ?? "?"} de ${anio}`;
}
