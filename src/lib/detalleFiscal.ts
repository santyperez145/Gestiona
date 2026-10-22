/**
 * El detalle fiscal de una factura manual (concepto, servicio, moneda,
 * tributos y Factura de Crédito Electrónica MiPyME) y lo que se manda a
 * `crear_factura_manual`. Lo usa `DetalleFiscalFactura`.
 */
import type { Json } from "@/integrations/supabase/types";
import type { TributoManual } from "@/lib/manualInvoiceTax";
import { cbuValido } from "../../supabase/functions/_shared/wsfeComprobante";
import { erroresExportacion, type DatosExportacion } from "../../supabase/functions/_shared/wsfexDatos";

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
  /** Factura de exportación E (WSFEX); null si no es una exportación. */
  exportacion: ExportacionForm | null;
}

/** Lo que se carga en el formulario de la factura E (todo como texto). */
export interface ExportacionForm {
  tipoExpo: "1" | "2" | "4";
  paisDestino: string;
  domicilio: string;
  idImpositivo: string;
  cuitPais: string;
  idioma: "1" | "2" | "3";
  formaPago: string;
  incoterms: string;
  incotermsDs: string;
  permisoExistente: "S" | "N";
  permisos: { id: string; destino: string }[];
  fechaPago: string;
  observaciones: string;
}

export const exportacionInicial = (): ExportacionForm => ({
  tipoExpo: "1", paisDestino: "", domicilio: "", idImpositivo: "", cuitPais: "", idioma: "1", formaPago: "",
  incoterms: "FOB", incotermsDs: "", permisoExistente: "N", permisos: [], fechaPago: "", observaciones: "",
});

/** El formulario en el formato de `invoices.exportacion` (y de `erroresExportacion`). */
export function exportacionParaEnviar(e: ExportacionForm): DatosExportacion {
  const bienes = e.tipoExpo === "1";
  return {
    tipo_expo: Number(e.tipoExpo), pais_destino: Number(e.paisDestino) || 0, domicilio_cliente: e.domicilio.trim(),
    id_impositivo: e.idImpositivo.trim() || null, cuit_pais: e.cuitPais.replace(/\D/g, "") || null, idioma: Number(e.idioma),
    forma_pago: e.formaPago.trim() || null, incoterms: e.incoterms.trim().toUpperCase() || null, incoterms_ds: e.incotermsDs.trim() || null,
    permiso_existente: bienes ? e.permisoExistente : null,
    permisos: bienes && e.permisoExistente === "S" ? e.permisos.map(p => ({ id: p.id.trim().toUpperCase(), destino: Number(p.destino) || 0 })) : null,
    fecha_pago: bienes ? null : e.fechaPago || null,
    obs_comerciales: e.observaciones.trim() || null,
  };
}

export const detalleFiscalInicial = (concepto: 1 | 2 | 3 = 1): DetalleFiscal => ({
  concepto, servicioDesde: "", servicioHasta: "", moneda: "ARS", cotizacion: "", mismaMoneda: false, tributos: [],
  fce: false, fceCbu: "", fceAlias: "", fceTransferencia: "SCA", exportacion: null,
});

/** Lo que recibe `crear_factura_manual` en `p_fiscal` además de lo de siempre. */
export function detalleFiscalParaEnviar(d: DetalleFiscal) {
  return {
    concepto: d.concepto,
    ...(d.concepto !== 1 ? { servicio_desde: d.servicioDesde, servicio_hasta: d.servicioHasta } : {}),
    moneda: d.moneda,
    ...(d.moneda !== "ARS" && d.cotizacion.trim() ? { cotizacion: d.cotizacion.replace(",", ".") } : {}),
    cancela_misma_moneda: d.moneda !== "ARS" && d.mismaMoneda,
    tributos: d.exportacion ? [] : d.tributos.map(t => ({ tipo: t.tipo, descripcion: t.descripcion || null, base: t.base, alicuota: t.alicuota, importe: t.importe ?? 0 })),
    ...(d.exportacion ? { exportacion: exportacionParaEnviar(d.exportacion) as unknown as Json } : {}),
    ...(d.fce && !d.exportacion ? {
      fce: true,
      fce_cbu: d.fceCbu.replace(/\D/g, "") || null,
      fce_alias: d.fceAlias.trim() || null,
      fce_transferencia: d.fceTransferencia,
    } : {}),
  };
}

export function erroresDelDetalleFiscal(d: DetalleFiscal, contexto: { vencimiento?: string; cuitCliente?: string; hoy?: string } = {}): string[] {
  const errores: string[] = [];
  if (d.concepto !== 1) {
    if (!d.servicioDesde || !d.servicioHasta) errores.push("Indicá el período del servicio (desde y hasta).");
    else if (d.servicioDesde > d.servicioHasta) errores.push("El período del servicio empieza después de terminar.");
  }
  if (d.moneda !== "ARS" && d.cotizacion.trim() && !(Number(d.cotizacion.replace(",", ".")) > 0)) errores.push("La cotización tiene que ser un número mayor a cero.");
  if (d.exportacion) {
    if (d.tributos.length) errores.push("La factura de exportación no lleva percepciones ni otros tributos: quitalos.");
    errores.push(...erroresExportacion(exportacionParaEnviar(d.exportacion), 19, contexto.hoy));
    return errores;
  }
  if (d.fce) {
    if (String(contexto.cuitCliente ?? "").replace(/\D/g, "").length !== 11) errores.push("La factura de crédito MiPyME es para una empresa con CUIT.");
    if (!contexto.vencimiento) errores.push("La factura de crédito MiPyME necesita el vencimiento del pago.");
    if (!cbuValido(d.fceCbu)) errores.push("Cargá un CBU válido del comercio (22 números) para la factura de crédito.");
  }
  return errores;
}
