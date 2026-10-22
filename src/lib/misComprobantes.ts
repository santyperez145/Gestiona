/**
 * Importar «Mis Comprobantes – Recibidos» de ARCA al Libro IVA Compras
 * (2026-10-22).
 *
 * El comercio descarga de ARCA las facturas que le emitieron sus proveedores
 * (Excel o CSV) y las sube acá, en vez de tipear cada una. ARCA no documenta el
 * formato y cambió con los años: hay exportaciones con el IVA total y otras con
 * columnas por alícuota, títulos con y sin tildes, montos con coma decimal,
 * fechas ISO o dd/mm/aaaa, y el tipo de comprobante como código o como texto.
 * Por eso las columnas se reconocen por nombre normalizado, y una fila que no
 * se puede interpretar con seguridad vuelve con el motivo: no se inventa un
 * importe ni una alícuota.
 */
import { discriminaIva, erroresDeComprobante, type AlicuotaCompra, type ComprobanteCompra } from "@/lib/libroIvaCompras";

export interface FilaImportada {
  /** Número de fila en la planilla (1 = primera). */
  fila: number;
  comprobante: Omit<ComprobanteCompra, "id"> | null;
  problemas: string[];
}

export interface LecturaMisComprobantes {
  filas: FilaImportada[];
  error: string | null;
}

const TASAS = [21, 10.5, 27, 5, 2.5, 0];

/** «Imp. Neto Gravado» → «imp neto gravado». */
export function normalizar(texto: unknown): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.:]/g, " ").replace(/\s+/g, " ").trim();
}

/** Monto de la planilla: número, «4687,20», «1.234,56» o «1234.56». */
export function monto(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const t = String(valor ?? "").trim().replace(/[\s$]/g, "");
  if (!t) return 0;
  const conMiles = t.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(conMiles ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
}

/** Fecha ISO (AAAA-MM-DD) desde Date, «2026-09-05», «05/09/2026» o serial de Excel. */
export function fechaIso(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, "0")}-${String(valor.getDate()).padStart(2, "0")}`;
  }
  if (typeof valor === "number" && valor > 20000 && valor < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + valor * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const t = String(valor ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const TIPOS_POR_NOMBRE: [RegExp, number][] = [
  [/credito electronica.*\ba\b|fce.*\ba\b/, 201], [/credito electronica.*\bb\b|fce.*\bb\b/, 206], [/credito electronica.*\bc\b|fce.*\bc\b/, 211],
  [/^factura a\b/, 1], [/^nota de debito a\b/, 2], [/^nota de credito a\b/, 3],
  [/^factura b\b/, 6], [/^nota de debito b\b/, 7], [/^nota de credito b\b/, 8],
  [/^factura c\b/, 11], [/^nota de debito c\b/, 12], [/^nota de credito c\b/, 13],
  [/^factura m\b/, 51], [/^nota de debito m\b/, 52], [/^nota de credito m\b/, 53],
];

/** «1 - Factura A», «Factura A» o 1 → 1. */
export function tipoDeComprobante(valor: unknown): number | null {
  const t = normalizar(valor);
  const n = t.match(/^(\d{1,3})\b/);
  if (n) return Number(n[1]);
  for (const [patron, codigo] of TIPOS_POR_NOMBRE) if (patron.test(t)) return codigo;
  return null;
}

type Columnas = Record<string, number>;

function ubicarColumnas(encabezado: unknown[]): Columnas {
  const col: Columnas = {};
  encabezado.forEach((h, i) => {
    const n = normalizar(h);
    const asignar = (clave: string) => { if (col[clave] === undefined) col[clave] = i; };
    if (/^fecha( de emision)?$/.test(n)) asignar("fecha");
    else if (/^tipo( de comprobante)?$/.test(n)) asignar("tipo");
    else if (/^punto de venta$/.test(n)) asignar("pv");
    else if (/^numero desde$|^numero$/.test(n)) asignar("numero");
    else if (/^tipo doc emisor$/.test(n)) asignar("tipoDoc");
    else if (/^nro doc emisor$|^cuit emisor$/.test(n)) asignar("doc");
    else if (/^denominacion emisor$/.test(n)) asignar("nombre");
    else if (/receptor/.test(n)) asignar("receptor");
    else if (/^tipo( de)? cambio$/.test(n)) asignar("cambio");
    else if (/^moneda$/.test(n)) asignar("moneda");
    else if (/^(imp )?(total )?neto gravado$/.test(n)) asignar("netoGravado");
    else if (/^(imp )?(neto )?no gravado$/.test(n)) asignar("noGravado");
    else if (/^(imp )?op(eraciones)? exentas$/.test(n)) asignar("exento");
    else if (/^otros tributos$/.test(n)) asignar("otros");
    else if (/^(total )?iva$/.test(n)) asignar("iva");
    else if (/^imp(orte)? total$/.test(n)) asignar("total");
    else {
      const neto = n.match(/^(?:imp )?neto gravado iva (\d+(?:,\d+)?) ?%$/);
      if (neto) asignar(`neto_${neto[1].replace(",", ".")}`);
      const iva = n.match(/^iva (\d+(?:,\d+)?) ?%$/);
      if (iva) asignar(`iva_${iva[1].replace(",", ".")}`);
    }
  });
  return col;
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** La alícuota que explica el IVA de un neto, si hay una sola. */
export function deducirAlicuota(neto: number, iva: number): number | null {
  if (neto <= 0) return null;
  const candidatas = TASAS.filter(t => t > 0 && Math.abs(iva - neto * t / 100) <= 1);
  return candidatas.length === 1 ? candidatas[0] : null;
}

export function leerMisComprobantes(matriz: unknown[][], periodo: string): LecturaMisComprobantes {
  const inicio = matriz.slice(0, 15).findIndex(fila => {
    const c = ubicarColumnas(fila ?? []);
    return c.fecha !== undefined && c.tipo !== undefined && (c.doc !== undefined || c.nombre !== undefined || c.receptor !== undefined);
  });
  if (inicio < 0) return { filas: [], error: "No encontramos las columnas de «Mis Comprobantes» (Fecha, Tipo, Nro. Doc. Emisor…). Descargá el archivo de comprobantes recibidos desde ARCA y subilo sin modificar." };
  const col = ubicarColumnas(matriz[inicio]);
  if (col.doc === undefined && col.receptor !== undefined) {
    return { filas: [], error: "Ese archivo es de comprobantes emitidos. Para el Libro IVA Compras descargá los «Recibidos»." };
  }
  if (col.total === undefined) return { filas: [], error: "Al archivo le falta la columna del importe total." };

  const porAlicuota = TASAS.filter(t => col[`neto_${t}`] !== undefined || col[`iva_${t}`] !== undefined);
  const filas: FilaImportada[] = [];

  matriz.slice(inicio + 1).forEach((fila, i) => {
    const v = (clave: string) => (col[clave] === undefined ? undefined : fila?.[col[clave]]);
    if (!fila || fila.every(c => String(c ?? "").trim() === "")) return;
    const problemas: string[] = [];
    const numeroFila = inicio + i + 2;

    const fecha = fechaIso(v("fecha"));
    const tipo = tipoDeComprobante(v("tipo"));
    if (!fecha) problemas.push("Fecha ilegible.");
    if (!tipo) problemas.push("Tipo de comprobante ilegible.");
    const tipoDoc = v("tipoDoc");
    const cuit = String(v("doc") ?? "").replace(/\D/g, "");
    if ((tipoDoc !== undefined && String(tipoDoc).trim() && !/^80\b|cuit/i.test(String(tipoDoc))) || !/^\d{11}$/.test(cuit)) {
      problemas.push("El emisor no está identificado con CUIT.");
    }

    const moneda = normalizar(v("moneda") || "pes");
    const cambio = moneda === "pes" || moneda === "$" ? 1 : monto(v("cambio"));
    if (!(cambio > 0)) problemas.push("Comprobante en moneda extranjera sin tipo de cambio.");
    const pesos = (x: unknown) => redondear(monto(x) * (cambio > 0 ? cambio : 1));

    const total = pesos(v("total"));
    let alicuotas: AlicuotaCompra[] = [];
    if (tipo && discriminaIva(tipo)) {
      if (porAlicuota.length) {
        alicuotas = porAlicuota
          .map(t => ({ tasa: t, neto: pesos(v(`neto_${t}`)), iva: pesos(v(`iva_${t}`)) }))
          .filter(a => a.neto > 0 || a.iva > 0)
          .map(a => (a.tasa === 0 ? { ...a, iva: 0 } : a));
      } else {
        const neto = pesos(v("netoGravado"));
        const iva = pesos(v("iva"));
        if (neto > 0 || iva > 0) {
          const tasa = deducirAlicuota(neto, iva);
          if (tasa === null) problemas.push("No se pudo deducir la alícuota del IVA (puede tener varias): cargalo a mano.");
          else alicuotas = [{ tasa, neto, iva }];
        }
      }
    }

    const comprobante: Omit<ComprobanteCompra, "id"> = {
      fecha: fecha ?? "",
      tipo_comprobante: tipo ?? 0,
      punto_venta: Math.trunc(monto(v("pv"))),
      numero: Math.trunc(monto(v("numero"))),
      cuit_emisor: cuit,
      razon_social_emisor: String(v("nombre") ?? "").trim(),
      alicuotas,
      no_gravado: tipo && discriminaIva(tipo) ? pesos(v("noGravado")) : 0,
      exento: tipo && discriminaIva(tipo) ? pesos(v("exento")) : 0,
      percepcion_iva: 0, percepcion_nacionales: 0, percepcion_iibb: 0, percepcion_municipal: 0, impuestos_internos: 0,
      otros_tributos: tipo && discriminaIva(tipo) ? pesos(v("otros")) : 0,
      total,
    };
    if (fecha && fecha.slice(0, 7) > periodo) problemas.push(`Es de ${fecha.slice(5, 7)}/${fecha.slice(0, 4)}, posterior al período que estás cargando.`);
    if (problemas.length === 0) problemas.push(...erroresDeComprobante(comprobante));
    filas.push({ fila: numeroFila, comprobante: problemas.length ? null : comprobante, problemas });
  });

  return { filas, error: filas.length ? null : "El archivo no tiene comprobantes." };
}

/**
 * Lo que hay que pasarle a SheetJS. Un CSV se decodifica acá: leído como bytes,
 * SheetJS lo toma como Latin-1 y «Emisión» queda «EmisiÃ³n» (los encabezados
 * dejan de reconocerse). ARCA exporta en UTF-8 o en Windows-1252: se prueba
 * UTF-8 estricto y, si no lo es, Windows-1252. Un Excel de verdad (.xlsx es un
 * ZIP, .xls un documento OLE) va como bytes.
 */
export function entradaParaPlanilla(bytes: Uint8Array): { tipo: "array"; datos: Uint8Array } | { tipo: "string"; datos: string } {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (zip || ole) return { tipo: "array", datos: bytes };
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder("windows-1252").decode(bytes);
  }
  return { tipo: "string", datos: texto.replace(/^\uFEFF/, "") };
}

/**
 * Los bytes que hay que leer. ARCA a veces entrega un .zip con el .csv
 * adentro: se lo abre acá. Un .xlsx también es un ZIP, pero trae
 * `[Content_Types].xml` y va entero a SheetJS.
 */
export async function bytesDeArchivoArca(archivo: Blob): Promise<Uint8Array> {
  const crudo = typeof archivo.arrayBuffer === "function"
    ? await archivo.arrayBuffer()
    : await new Promise<ArrayBuffer>((ok, mal) => {
      const lector = new FileReader();
      lector.onload = () => ok(lector.result as ArrayBuffer);
      lector.onerror = () => mal(lector.error);
      lector.readAsArrayBuffer(archivo);
    });
  const bytes = new Uint8Array(crudo);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return bytes;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  if (zip.file("[Content_Types].xml")) return bytes;
  const adentro = Object.values(zip.files).find(f => !f.dir && /\.(csv|txt|xlsx?)$/i.test(f.name));
  if (!adentro) throw new Error("El .zip no trae un archivo de comprobantes.");
  return await adentro.async("uint8array");
}
