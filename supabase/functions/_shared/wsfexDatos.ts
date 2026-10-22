/**
 * Los datos de la factura de exportación «E» y lo que ARCA rechazaría de
 * ellos, sin dependencias: lo usan el navegador (formulario de la factura)
 * y `wsfex.ts` (el pedido a WSFEX). Ver el manual WSFEX V 3.1.1.
 */

export const TIPOS_EXPORTACION = new Set([19, 20, 21]);
export const TIPO_EXPO = { bienes: 1, servicios: 2, otros: 4 } as const;
/** Unidad de medida «unidades» (FEXGetPARAM_UMed); 99 es bonificación. */
export const UMED_UNIDADES = 7;

export interface PermisoEmbarque { id: string; destino: number }

/** Lo que la factura E agrega a una factura común (columna `invoices.exportacion`). */
export interface DatosExportacion {
  tipo_expo: number;
  pais_destino: number;
  domicilio_cliente: string;
  id_impositivo?: string | null;
  cuit_pais?: string | null;
  incoterms?: string | null;
  incoterms_ds?: string | null;
  idioma: number;
  forma_pago?: string | null;
  fecha_pago?: string | null;
  permiso_existente?: "S" | "N" | null;
  permisos?: PermisoEmbarque[] | null;
  obs_comerciales?: string | null;
}

/**
 * Los errores que ARCA rechazaría, en castellano, antes de pedir nada. Los
 * usa la pantalla para el formulario y la función para no mandar un pedido
 * que vuelve rechazado.
 */
export function erroresExportacion(d: DatosExportacion | null | undefined, tipoCbte: number, fechaCbte?: string): string[] {
  const e: string[] = [];
  if (!d) return ["Faltan los datos de exportación."];
  const factura = tipoCbte === 19;
  if (![1, 2, 4].includes(Number(d.tipo_expo))) e.push("Elegí si exportás bienes, servicios u otros.");
  if (!(Number(d.pais_destino) > 0) || Number(d.pais_destino) > 999) e.push("Elegí el país de destino.");
  if (!String(d.domicilio_cliente ?? "").trim()) e.push("El domicilio del cliente del exterior es obligatorio.");
  else if (String(d.domicilio_cliente).length > 300) e.push("El domicilio del cliente admite hasta 300 caracteres.");
  const cuitPais = String(d.cuit_pais ?? "").replace(/\D/g, "");
  if (!String(d.id_impositivo ?? "").trim() && !cuitPais) e.push("Cargá la identificación tributaria del cliente o la CUIT del país.");
  if (cuitPais && cuitPais.length !== 11) e.push("La CUIT del país tiene 11 dígitos.");
  if (String(d.id_impositivo ?? "").length > 50) e.push("La identificación tributaria admite hasta 50 caracteres.");
  if (![1, 2, 3].includes(Number(d.idioma))) e.push("Elegí el idioma del comprobante.");
  if (factura && !String(d.forma_pago ?? "").trim()) e.push("La forma de pago es obligatoria en la factura de exportación.");
  if (String(d.forma_pago ?? "").length > 50) e.push("La forma de pago admite hasta 50 caracteres.");
  const incoterms = String(d.incoterms ?? "").trim();
  if (factura && Number(d.tipo_expo) === 1 && !incoterms) e.push("En una exportación de bienes el Incoterm es obligatorio.");
  if (incoterms && !/^[A-Z]{3}$/.test(incoterms)) e.push("El Incoterm tiene 3 letras (por ejemplo FOB).");
  if (String(d.incoterms_ds ?? "").trim() && !incoterms) e.push("Si describís el Incoterm, elegí también cuál es.");
  if (String(d.incoterms_ds ?? "").length > 20) e.push("La descripción del Incoterm admite hasta 20 caracteres.");
  if (String(d.obs_comerciales ?? "").length > 4000) e.push("Las observaciones comerciales admiten hasta 4000 caracteres.");
  const bienes = Number(d.tipo_expo) === 1;
  if (factura && bienes && d.permiso_existente !== "S" && d.permiso_existente !== "N") e.push("Indicá si ya tenés el permiso de embarque.");
  const permisos = d.permisos ?? [];
  if (factura && bienes && d.permiso_existente === "S" && permisos.length === 0) e.push("Cargá el permiso de embarque y el país de destino de la mercadería.");
  if (permisos.length && !(factura && bienes && d.permiso_existente === "S")) e.push("Los permisos de embarque sólo van en una factura de bienes con permiso.");
  for (const p of permisos) {
    if (!/^\d{5}[A-Z]{2}[A-Z0-9]{2}\d{6}[A-Z]$/.test(String(p.id ?? "").toUpperCase())) e.push(`El permiso ${p.id || "(vacío)"} no tiene el formato de ARCA (99999AAXX999999A).`);
    if (!(Number(p.destino) > 0)) e.push("Cada permiso de embarque necesita el país de destino de la mercadería.");
  }
  if (factura && !bienes) {
    if (!d.fecha_pago) e.push("En servicios y otros la fecha de pago es obligatoria.");
    else if (fechaCbte && d.fecha_pago < fechaCbte) e.push("La fecha de pago no puede ser anterior a la fecha del comprobante.");
  }
  return e;
}
