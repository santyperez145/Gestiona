// Lectura del archivo de clientes: Excel (.xlsx/.xls) o CSV.
//
// La importación de clientes aceptaba sólo CSV, y con un parser que partía por
// comas: un CSV exportado por Excel en Argentina usa punto y coma, y una
// comilla escapada («""») rompía la fila. Además, el comercio tiene sus
// clientes en una planilla de Excel, no en un CSV.
//
// Este módulo sólo convierte el archivo en encabezados + filas de texto. El
// mapeo, la validación, el matching por email/teléfono y la escritura siguen
// en la base (`stage_customer_import` → `apply_customer_import`).

export const CUSTOMER_IMPORT_MAX_ROWS = 20_000;
export const CUSTOMER_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export type FormatoClientes = "csv" | "xlsx" | "xls";

export interface ArchivoDeClientes {
  formato: FormatoClientes;
  hoja: string | null;
  encabezados: string[];
  filas: string[][];
}

export function formatoDeArchivo(nombre: string): FormatoClientes | null {
  const ext = nombre.toLowerCase().split(".").pop();
  return ext === "csv" || ext === "xlsx" || ext === "xls" ? ext : null;
}

/** Separador más probable de la primera línea: `;` (Excel AR), `,` o tab. */
export function detectarSeparador(primeraLinea: string): string {
  const fuera = primeraLinea.replace(/"[^"]*"/g, "");
  const cuenta = (c: string) => fuera.split(c).length - 1;
  const opciones = [";", ",", "\t"].map(c => ({ c, n: cuenta(c) })).sort((a, b) => b.n - a.n);
  return opciones[0].n > 0 ? opciones[0].c : ",";
}

/** CSV según RFC 4180: comillas, comillas escapadas y saltos dentro de comillas. */
export function parsearCsv(texto: string, separador = detectarSeparador(texto.split(/\r?\n/, 1)[0] ?? "")): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') comillas = true;
    else if (ch === separador) { fila.push(campo.trim()); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo.trim()); filas.push(fila); fila = []; campo = "";
    } else campo += ch;
  }
  if (campo !== "" || fila.length > 0) { fila.push(campo.trim()); filas.push(fila); }
  return filas.filter(f => f.some(c => c !== ""));
}

/** Fecha de Excel o texto → YYYY-MM-DD cuando se puede; si no, el texto tal cual. */
function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  if (typeof valor === "number") {
    // Teléfonos y documentos: sin notación científica ni decimales espurios.
    return Number.isInteger(valor) ? valor.toFixed(0) : String(valor);
  }
  return String(valor).trim();
}

/** Lee la primera hoja con datos de un Excel, sin ejecutar fórmulas ni macros. */
export async function leerExcelDeClientes(buffer: ArrayBuffer, formato: "xlsx" | "xls"): Promise<ArchivoDeClientes> {
  if (!buffer.byteLength || buffer.byteLength > CUSTOMER_IMPORT_MAX_BYTES) {
    throw new Error("El archivo debe pesar hasta 20 MB.");
  }
  // Carga diferida: la librería de Excel sólo se baja cuando alguien importa.
  const XLSX = await import("xlsx");
  const libro = XLSX.read(buffer, {
    type: "array", dense: true, cellDates: true, cellFormula: false,
    sheetRows: CUSTOMER_IMPORT_MAX_ROWS + 2,
  });
  for (const hoja of libro.SheetNames) {
    const sheet = libro.Sheets[hoja];
    if (!sheet?.["!ref"]) continue;
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false })
      .map(fila => fila.map(celdaATexto))
      .filter(fila => fila.some(c => c !== ""));
    if (matriz.length < 2) continue;
    return { formato, hoja, encabezados: matriz[0], filas: matriz.slice(1, CUSTOMER_IMPORT_MAX_ROWS + 1) };
  }
  throw new Error("El Excel no tiene una hoja con encabezados y al menos un cliente.");
}

export function leerCsvDeClientes(texto: string): ArchivoDeClientes {
  const matriz = parsearCsv(texto);
  if (matriz.length < 2) throw new Error("El CSV está vacío o no tiene filas debajo de los encabezados.");
  return { formato: "csv", hoja: null, encabezados: matriz[0], filas: matriz.slice(1, CUSTOMER_IMPORT_MAX_ROWS + 1) };
}

export async function leerArchivoDeClientes(archivo: File): Promise<ArchivoDeClientes> {
  const formato = formatoDeArchivo(archivo.name);
  if (!formato) throw new Error("Subí un Excel (.xlsx o .xls) o un CSV.");
  if (archivo.size > CUSTOMER_IMPORT_MAX_BYTES) throw new Error("El archivo debe pesar hasta 20 MB.");
  if (formato === "csv") return leerCsvDeClientes(await archivo.text());
  return leerExcelDeClientes(await archivo.arrayBuffer(), formato);
}
