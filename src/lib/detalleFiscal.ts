/**
 * El detalle fiscal de una factura manual (concepto, servicio, moneda,
 * tributos y Factura de Crédito Electrónica MiPyME) y lo que se manda a
 * `crear_factura_manual`. Lo usa `DetalleFiscalFactura`.
 */
import type { TributoManual } from "@/lib/manualInvoiceTax";
import { cbuValido } from "../../supabase/functions/_shared/wsfeComprobante";

export interface DetalleFiscal {
  concepto: 1 | 2 | 3;
  servicioDesde: string;
  servicioHasta: string;
  moneda: "ARS" | "USD" | "EUR";
  cotizacion: string;
  mismaMoneda: boolean;
  tributos: TributoManual[];
  /** Factura de Crédito Electrónica MiPyME (RG 4367). */
  fce: boolean;
  fceCbu: string;
  fceAlias: string;
  fceTransferencia: "SCA" | "ADC";
}

export const detalleFiscalInicial = (concepto: 1 | 2 | 3 = 1): DetalleFiscal => ({
  concepto, servicioDesde: "", servicioHasta: "", moneda: "ARS", cotizacion: "", mismaMoneda: false, tributos: [],
  fce: false, fceCbu: "", fceAlias: "", fceTransferencia: "SCA",
});

/** Lo que recibe `crear_factura_manual` en `p_fiscal` además de lo de siempre. */
export function detalleFiscalParaEnviar(d: DetalleFiscal) {
  return {
    concepto: d.concepto,
    ...(d.concepto !== 1 ? { servicio_desde: d.servicioDesde, servicio_hasta: d.servicioHasta } : {}),
    moneda: d.moneda,
    ...(d.moneda !== "ARS" && d.cotizacion.trim() ? { cotizacion: d.cotizacion.replace(",", ".") } : {}),
    cancela_misma_moneda: d.moneda !== "ARS" && d.mismaMoneda,
    tributos: d.tributos.map(t => ({ tipo: t.tipo, descripcion: t.descripcion || null, base: t.base, alicuota: t.alicuota, importe: t.importe ?? 0 })),
    ...(d.fce ? {
      fce: true,
      fce_cbu: d.fceCbu.replace(/\D/g, "") || null,
      fce_alias: d.fceAlias.trim() || null,
      fce_transferencia: d.fceTransferencia,
    } : {}),
  };
}

export function erroresDelDetalleFiscal(d: DetalleFiscal, contexto: { vencimiento?: string; cuitCliente?: string } = {}): string[] {
  const errores: string[] = [];
  if (d.concepto !== 1) {
    if (!d.servicioDesde || !d.servicioHasta) errores.push("Indicá el período del servicio (desde y hasta).");
    else if (d.servicioDesde > d.servicioHasta) errores.push("El período del servicio empieza después de terminar.");
  }
  if (d.moneda !== "ARS" && d.cotizacion.trim() && !(Number(d.cotizacion.replace(",", ".")) > 0)) errores.push("La cotización tiene que ser un número mayor a cero.");
  if (d.fce) {
    if (String(contexto.cuitCliente ?? "").replace(/\D/g, "").length !== 11) errores.push("La factura de crédito MiPyME es para una empresa con CUIT.");
    if (!contexto.vencimiento) errores.push("La factura de crédito MiPyME necesita el vencimiento del pago.");
    if (!cbuValido(d.fceCbu)) errores.push("Cargá un CBU válido del comercio (22 números) para la factura de crédito.");
  }
  return errores;
}
