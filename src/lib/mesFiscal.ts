/**
 * El mes fiscal de un negocio, calculado una sola vez (2026-10-30).
 *
 * Lo usan la pantalla de ARCA del comercio (LibroIvaDigital) y el portal del
 * contador: los dos le pasan los mismos datos —ventas autorizadas, compras,
 * retenciones, inscripciones de IIBB, cierres Z y Tique-Factura A— y obtienen
 * el mismo libro, el mismo Excel y el mismo paquete. Así lo que ve el
 * comercio y lo que descarga su contador no pueden diferir.
 */
import { libroIvaVentas, type ComprobanteVenta, type LibroIvaVentas } from "@/lib/libroIvaVentas";
import { libroIvaCompras, posicionIva, type ComprobanteCompra, type LibroIvaCompras, type PosicionIva } from "@/lib/libroIvaCompras";
import { hojaPosicion, hojaRetenciones, subdiarioCompras, subdiarioVentas, totalesDeRetenciones, type RetencionSufrida } from "@/lib/subdiarioIva";
import { hojaIibb, liquidacionIibb, type InscripcionIibb, type LiquidacionIibb } from "@/lib/liquidacionIibb";
import { libroIvaDesdeZ, libroIvaTiquesA, NOMBRE_TIPO_Z, type CierreZ, type LibroIvaZ, type TiqueA } from "@/lib/cierreZ";
import { leameDelMes, nombresDelPaquete } from "@/lib/paqueteContador";

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo del controlador: el resumen de cada Z y los Tique-Factura A uno por uno. */
export function libroDelControlador(cierres: CierreZ[], tiquesA: TiqueA[], diaDe: (iso: string) => string): LibroIvaZ {
  const resumen = libroIvaDesdeZ(cierres);
  const tiques = libroIvaTiquesA(tiquesA, cierres, diaDe);
  const porTasa = new Map<number, { tasa: number; neto: number; iva: number }>();
  for (const a of [...resumen.resumen.porAlicuota, ...tiques.resumen.porAlicuota]) {
    const r = porTasa.get(a.tasa) ?? { tasa: a.tasa, neto: 0, iva: 0 };
    porTasa.set(a.tasa, { tasa: a.tasa, neto: r.neto + a.neto, iva: r.iva + a.iva });
  }
  return {
    cbte: [...resumen.cbte, ...tiques.cbte],
    alicuotas: [...resumen.alicuotas, ...tiques.alicuotas],
    avisos: [...resumen.avisos, ...tiques.avisos],
    resumen: {
      total: redondear(resumen.resumen.total + tiques.resumen.total),
      debitoFiscal: redondear(resumen.resumen.debitoFiscal + tiques.resumen.debitoFiscal),
      porAlicuota: [...porTasa.values()],
    },
  };
}

/** El Libro IVA Ventas del mes: las facturas autorizadas más lo del controlador. */
export function ventasDelMes(comprobantes: ComprobanteVenta[], controlador: LibroIvaZ): LibroIvaVentas {
  const base = libroIvaVentas(comprobantes);
  if (controlador.cbte.length === 0) return base;
  const porTasa = new Map(base.resumen.porAlicuota.map(a => [a.tasa, { ...a }]));
  for (const a of controlador.resumen.porAlicuota) {
    const r = porTasa.get(a.tasa) ?? { tasa: a.tasa, neto: 0, iva: 0 };
    porTasa.set(a.tasa, { tasa: a.tasa, neto: redondear(r.neto + a.neto), iva: redondear(r.iva + a.iva) });
  }
  return {
    ...base,
    cbte: base.cbte + controlador.cbte.join(""),
    alicuotas: base.alicuotas + controlador.alicuotas.join(""),
    incluidos: base.incluidos + controlador.cbte.length,
    resumen: {
      ...base.resumen,
      total: redondear(base.resumen.total + controlador.resumen.total),
      debitoFiscal: redondear(base.resumen.debitoFiscal + controlador.resumen.debitoFiscal),
      porAlicuota: [...porTasa.values()].sort((a, b) => a.tasa - b.tasa),
    },
  };
}

export interface DatosDelMes {
  periodo: string;
  monotributo: boolean;
  /** Ventas autorizadas con CAE, sin las de homologación. */
  comprobantes: ComprobanteVenta[];
  homologacion: number;
  compras: ComprobanteCompra[];
  /** false si el registro de compras todavía no está activo: no hay posición de IVA. */
  comprasActivas?: boolean;
  retenciones: RetencionSufrida[];
  inscripciones: InscripcionIibb[] | null;
  /** Cierres Z confirmados del controlador. */
  cierres: CierreZ[];
  borradoresZ: number;
  tiquesA: TiqueA[];
  diaDe: (iso: string) => string;
  razonSocial?: string | null;
  cuit?: string | null;
}

export interface MesCalculado {
  controlador: LibroIvaZ;
  ventas: LibroIvaVentas;
  compras: LibroIvaCompras | null;
  posicion: PosicionIva | null;
  iibb: LiquidacionIibb | null;
  pendientes: string[];
}

export function calcularMes(d: DatosDelMes): MesCalculado {
  const controlador = libroDelControlador(d.cierres, d.tiquesA, d.diaDe);
  const ventas = ventasDelMes(d.comprobantes, controlador);
  const compras = d.monotributo ? null : libroIvaCompras(d.compras);
  const retencionesIva = totalesDeRetenciones(d.retenciones).iva;
  const posicion = compras && d.comprasActivas !== false ? posicionIva(ventas.resumen.debitoFiscal, compras.resumen, retencionesIva) : null;
  const iibb = d.inscripciones ? liquidacionIibb({
    comprobantes: d.comprobantes, inscripciones: d.inscripciones, retenciones: d.retenciones,
    percepcionesDeCompras: d.compras.reduce((s, c) => s + Number(c.percepcion_iibb || 0), 0),
  }) : null;
  const pendientes = [
    ...ventas.problemas.map(p => `${p.comprobante}: ${p.motivo}`),
    ...controlador.avisos,
    ...(d.borradoresZ ? [`Hay ${d.borradoresZ} cierre(s) Z en borrador: confirmalos contra el ticket para que entren al libro.`] : []),
    ...(iibb?.avisos ?? []),
    ...(iibb?.problemas ?? []).map(p => `${p.comprobante}: ${p.motivo}`),
  ];
  return { controlador, ventas, compras, posicion, iibb, pendientes };
}

type Xlsx = typeof import("xlsx");

/** El Excel del contador: subdiarios, posición, retenciones, cierres Z e IIBB. */
export function libroExcelDelMes(XLSX: Xlsx, d: DatosDelMes, m: MesCalculado) {
  const wb = XLSX.utils.book_new();
  const ventas = subdiarioVentas(d.comprobantes);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ventas.filas), "Ventas");
  if (!d.monotributo) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subdiarioCompras(d.compras)), "Compras");
    if (m.posicion) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaPosicion(m.posicion)), "Posición");
    if (d.retenciones.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaRetenciones(d.retenciones)), "Retenciones");
    if (d.cierres.length) {
      const filas: (string | number)[][] = [["Fecha", "Punto de venta", "Z", "Comprobante", "Desde", "Hasta", "Cantidad", "Total", "Neto 21%", "IVA 21%", "Neto 10,5%", "IVA 10,5%", "Otras alícuotas (neto + IVA)", "Exento", "No gravado", "Internos y otros"]];
      for (const z of d.cierres) for (const c of z.comprobantes) {
        const al = (t: number) => c.alicuotas.find(a => Number(a.tasa) === t);
        const otras = c.alicuotas.filter(a => ![21, 10.5].includes(Number(a.tasa))).reduce((s, a) => s + Number(a.neto) + Number(a.iva), 0);
        filas.push([z.fecha, z.punto_venta, z.numero, NOMBRE_TIPO_Z[c.tipo] ?? String(c.tipo), c.desde, c.hasta, c.cantidad, Number(c.total),
          Number(al(21)?.neto ?? 0), Number(al(21)?.iva ?? 0), Number(al(10.5)?.neto ?? 0), Number(al(10.5)?.iva ?? 0), otras,
          Number(c.exento ?? 0), Number(c.no_gravado ?? 0), Number(c.internos ?? 0) + Number(c.otros_tributos ?? 0)]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Cierres Z");
    }
    if (m.iibb?.renglones.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaIibb(m.iibb)), "Ingresos Brutos");
  }
  if (ventas.revisar.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fecha", "Comprobante", "Motivo"], ...ventas.revisar]), "A revisar");
  }
  return wb;
}

type ZipCtor = new () => { file(nombre: string, contenido: string | Uint8Array | ArrayBuffer): unknown; generateAsync(o: { type: "blob" }): Promise<Blob> };

/** El .zip del mes: los dos libros, el Excel y el LEAME con lo pendiente. */
export async function paqueteDelMes(XLSX: Xlsx, JSZip: ZipCtor, d: DatosDelMes, m: MesCalculado = calcularMes(d)): Promise<{ nombre: string; blob: Blob; pendientes: string[] }> {
  const nombres = nombresDelPaquete(d.periodo);
  const zip = new JSZip();
  zip.file(nombres.ventasCbte, m.ventas.cbte);
  zip.file(nombres.ventasAlicuotas, m.ventas.alicuotas);
  if (m.compras) {
    zip.file(nombres.comprasCbte, m.compras.cbte);
    zip.file(nombres.comprasAlicuotas, m.compras.alicuotas);
  }
  zip.file(nombres.excel, XLSX.write(libroExcelDelMes(XLSX, d, m), { type: "array", bookType: "xlsx" }));
  zip.file(nombres.leame, leameDelMes({
    periodo: d.periodo, monotributo: d.monotributo, razonSocial: d.razonSocial, cuit: d.cuit,
    ventas: { ...m.ventas.resumen, incluidos: m.ventas.incluidos },
    compras: m.compras ? { incluidos: m.compras.incluidos, creditoFiscal: m.compras.resumen.creditoFiscal, percepcionesIva: m.compras.resumen.percepcionesIva } : null,
    posicion: m.posicion,
    iibb: m.iibb?.renglones ?? null,
    cierresZ: d.cierres.length,
    homologacion: d.homologacion,
    pendientes: m.pendientes,
  }));
  return { nombre: nombres.zip, blob: await zip.generateAsync({ type: "blob" }), pendientes: m.pendientes };
}

export function descargarBlob(nombre: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
