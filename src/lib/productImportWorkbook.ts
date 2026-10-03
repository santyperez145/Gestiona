import * as XLSX from "xlsx";
import { detectCatalogMigrationSource, parseCatalogMigrationRows, type CatalogMigrationParseResult, type CatalogMigrationProduct } from "@/lib/catalogMigration";
import { normalizeImportHeader, parseImportNumber, PRODUCT_IMPORT_FILE_MAX_ROWS, PRODUCT_IMPORT_MAX_BYTES, type ImportMapping } from "@/lib/productImport";
export type { ImportMapping } from "@/lib/productImport";
export type WorkbookImportOptions = { mapping?: ImportMapping; costCurrency?: "ARS" | "USD"; sheetName?: string };
export type WorkbookImportResult = {
  parsed: CatalogMigrationParseResult; mapping: ImportMapping; costCurrency: "ARS" | "USD";
  profile: "hardware" | "mapped" | "platform"; sheetName: string; sheetNames: string[];
  columns: { id: string; label: string }[]; negativeStock: number; fractionalStock: number; duplicateCodes: number;
  fingerprint?: string;
};

const aliases: Record<keyof ImportMapping, string[]> = {
  name: ["nombre", "producto", "name", "titulo", "descripcion"], sku: ["sku", "codigo", "code"],
  brand: ["marca", "brand"], category: ["rubro", "categoria", "category"], cost: ["costo ars", "costo usd", "costo"],
  sale: ["precio de lista", "precio venta ars", "precio venta", "precio", "price", "venta"],
  barcode: ["codigo barra 1", "codigo de barras", "barcode", "ean"], barcode2: ["codigo barra 2"], barcode3: ["codigo barra 3"],
  stock: ["stock", "existencia", "cantidad"], description: ["descripcion larga", "descripcion adicional", "descripcion", "description"],
  classification: ["clasificacion"],
};
const identifiers = new Set<string>(["sku", "barcode", "barcode2", "barcode3"]);
const missingPlaceholder = /^\*+\s*sin datos\s*\*+$/i;

/** Read-only: never executes formulas, external links or macros; the workbook stays in the worker. */
export function readProductWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  if (!buffer.byteLength || buffer.byteLength > PRODUCT_IMPORT_MAX_BYTES) throw new Error("El archivo debe pesar hasta 50 MB.");
  return XLSX.read(buffer, { type: "array", dense: true, raw: true, sheetRows: PRODUCT_IMPORT_FILE_MAX_ROWS + 22, cellFormula: false, cellNF: true });
}

export function mapProductWorkbook(workbook: XLSX.WorkBook, filename: string, options: WorkbookImportOptions = {}): WorkbookImportResult {
  const sheetName = options.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) throw new Error("La hoja seleccionada está vacía.");
  const loadedRange = XLSX.utils.decode_range(sheet["!ref"]);
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
  if (range.e.r > loadedRange.e.r) throw new Error("La hoja supera el área de lectura segura. No se puede importar una vista truncada del archivo.");
  if (range.e.c - range.s.c > 127 || range.e.r - range.s.r > PRODUCT_IMPORT_FILE_MAX_ROWS + 20) throw new Error("La hoja supera 50.000 productos o 128 columnas.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  const knownHeaders = new Set(Object.values(aliases).flat());
  let headerIndex = matrix.findIndex((row, i) => i < 20 && row.filter(cell => knownHeaders.has(normalizeImportHeader(String(cell)))).length >= 2);
  if (headerIndex < 0) headerIndex = matrix.findIndex((row, i) => i < 20 && row.filter(cell => String(cell).trim()).length >= 2);
  if (headerIndex < 0) throw new Error("No encontramos una fila de encabezados.");
  const headers = matrix[headerIndex].map(cell => String(cell).trim());
  const counts = new Map<string, number>();
  headers.forEach(header => counts.set(header, (counts.get(header) || 0) + 1));
  const columns = headers.map((header, index) => ({ id: String(index), label: (header || "Sin título") + ((counts.get(header) || 0) > 1 ? ` · columna ${XLSX.utils.encode_col(range.s.c + index)}` : "") }));
  const mapping = options.mapping || Object.fromEntries(Object.entries(aliases).map(([field, names]) => {
    let index = -1;
    for (const name of names) { index = headers.findIndex(header => normalizeImportHeader(header) === name); if (index >= 0) break; }
    return [field, index < 0 ? "" : String(index)];
  })) as ImportMapping;
  if (!options.mapping && mapping.description === mapping.name) mapping.description = "";
  const hardware = headers.some(header => normalizeImportHeader(header) === "codigo barra 1") && headers.some(header => normalizeImportHeader(header) === "precio de lista");
  const costCurrency = options.costCurrency || (hardware || headers.some(header => normalizeImportHeader(header) === "costo ars") ? "ARS" : "USD");
  const sourceRows = matrix.slice(headerIndex + 1).map((cells, i) => ({ cells, row: range.s.r + i + headerIndex + 2 })).filter(({ cells }) => cells.some(cell => String(cell).trim()));
  if (!sourceRows.length) throw new Error("La hoja no contiene productos.");
  if (sourceRows.length > PRODUCT_IMPORT_FILE_MAX_ROWS) throw new Error("El máximo por archivo es 50.000 productos.");
  const rawRow = ({ cells }: { cells: unknown[] }) => Object.fromEntries(columns.map((_, index) => [headers[index] + ((counts.get(headers[index]) || 0) > 1 ? `_${index}` : ""), cells[index] ?? ""]));
  const source = detectCatalogMigrationSource(sourceRows.slice(0,100).map(rawRow), filename);
  const platform = ["shopify", "tiendanube"].includes(source);
  const original: CatalogMigrationParseResult = hardware && !platform
    ? { source, sourceRows: sourceRows.length, products: [], variantCount: 0, imageCount: 0, redirectCount: 0, warnings: [] }
    : parseCatalogMigrationRows(sourceRows.map(rawRow), filename);
  if (platform && options.mapping) throw new Error("Las exportaciones de plataforma conservan su agrupación de variantes.");
  const cellValue = (cells: unknown[], row: number, field: keyof ImportMapping) => {
    const index = Number(mapping[field]);
    if (mapping[field] === "" || !Number.isInteger(index) || !columns[index]) return undefined;
    const cell = (sheet as XLSX.WorkSheet & { "!data"?: XLSX.CellObject[][] })["!data"]?.[row - 1]?.[range.s.c + index];
    const value = cells[index];
    if (identifiers.has(field) && cell?.t === "n" && typeof cell.z === "string" && /0{2,}/.test(cell.z)) return XLSX.utils.format_cell(cell);
    const text = String(value ?? "").trim();
    return !text || missingPlaceholder.test(text) ? undefined : identifiers.has(field) ? text : value;
  };
  const products = platform ? original.products : sourceRows.map(({ cells, row }, index) => {
    const product: CatalogMigrationProduct = { ...(hardware ? {} : original.products[index]), name: String(cellValue(cells, row, "name") ?? "").trim(), provided: [...(hardware ? [] : original.products[index].provided)], source_row: row,
      source_record: JSON.stringify({ headers, values: cells }) };
    if (product.name && !product.provided.includes("name")) product.provided.push("name");
    const pairs: [keyof ImportMapping, string][] = [["sku", "sku"], ["brand", "brand"], ["category", "category"],
      ["description", "description"], ["barcode", "barcode"], ["sale", "sale_price_ars"], ["stock", "stock"], ["cost", costCurrency === "ARS" ? "cost_ars" : "cost_usd"]];
    for (const [input, output] of pairs) {
      delete product[output];
      product.provided = product.provided.filter(field => field !== output);
      const raw = cellValue(cells, row, input);
      if (raw === undefined) continue;
      product[output] = ["sale", "stock", "cost"].includes(input) ? parseImportNumber(raw) ?? String(raw) : String(raw).trim();
      product.provided.push(output);
    }
    if (costCurrency === "ARS") { delete product.cost_usd; product.provided = product.provided.filter(field => field !== "cost_usd"); }
    const alternatives = [...new Set(["barcode2", "barcode3"].map(field => cellValue(cells, row, field as keyof ImportMapping)).filter(v => v !== undefined).map(String))].filter(v => v !== product.barcode);
    if (alternatives.length) { product.barcode_aliases = alternatives; product.provided.push("barcode_aliases"); }
    const classification = cellValue(cells, row, "classification");
    if (classification !== undefined) { product.tags = [String(classification).trim()]; product.provided.push("tags"); }
    return product;
  });
  const codes = new Map<string, number>();
  for (const product of products) { const key = String(product.sku || "").trim().toLowerCase(); if (key) codes.set(key, (codes.get(key) || 0) + 1); }
  const stocks = products.map(product => parseImportNumber(product.stock)).filter((value): value is number => value !== null);
  const warnings = [...original.warnings];
  if (hardware) warnings.push("PRECIO DE LISTA es el precio normal. VENTA se conserva como dato de origen para efectivo/transferencia; no se convierte en una oferta general ni cambia los descuentos del negocio.");
  if (!platform) warnings.push("Las columnas no mapeadas se conservan en el registro de origen del lote; no crean proveedores ni modifican descuentos automáticamente.");
  return { parsed: { ...original, products, sourceRows: sourceRows.length, warnings }, mapping, costCurrency,
    profile: platform ? "platform" : hardware ? "hardware" : "mapped", sheetName, sheetNames: workbook.SheetNames, columns,
    negativeStock: stocks.filter(value => value < 0).length, fractionalStock: stocks.filter(value => !Number.isInteger(value)).length,
    duplicateCodes: [...codes.values()].filter(value => value > 1).length };
}
