/**
 * El detalle fiscal de una factura manual (concepto, servicio, moneda y
 * tributos) y lo que se manda a `crear_factura_manual`. Lo usa
 * `DetalleFiscalFactura`.
 */
import type { TributoManual } from "@/lib/manualInvoiceTax";

export interface DetalleFiscal {
  concepto: 1 | 2 | 3;
  servicioDesde: string;
  servicioHasta: string;
  moneda: "ARS" | "USD" | "EUR";
  cotizacion: string;
  mismaMoneda: boolean;
  tributos: TributoManual[];
}

export const detalleFiscalInicial = (concepto: 1 | 2 | 3 = 1): DetalleFiscal => ({
  concepto, servicioDesde: "", servicioHasta: "", moneda: "ARS", cotizacion: "", mismaMoneda: false, tributos: [],
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
  };
}

export function erroresDelDetalleFiscal(d: DetalleFiscal): string[] {
  const errores: string[] = [];
  if (d.concepto !== 1) {
    if (!d.servicioDesde || !d.servicioHasta) errores.push("Indicá el período del servicio (desde y hasta).");
    else if (d.servicioDesde > d.servicioHasta) errores.push("El período del servicio empieza después de terminar.");
  }
  if (d.moneda !== "ARS" && d.cotizacion.trim() && !(Number(d.cotizacion.replace(",", ".")) > 0)) errores.push("La cotización tiene que ser un número mayor a cero.");
  return errores;
}
