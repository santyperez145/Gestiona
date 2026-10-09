import * as XLSX from "xlsx";
import { detectCatalogMigrationSource, parseCatalogMigrationRows, type CatalogMigrationParseResult, type CatalogMigrationProduct } from "@/lib/catalogMigration";
import { normalizeImportHeader, parseImportNumber, PRODUCT_IMPORT_FILE_MAX_ROWS, PRODUCT_IMPORT_MAX_BYTES, type ImportMapping } from "@/lib/productImport";
import { detectProductHeader, productColumnWarnings, suggestProductColumns } from "@/lib/productImportDetection";
import { columnMappingToLegacy, importCostHeaderCurrency, prepareProductColumnMapping, type ProductColumnMappingField } from "@/lib/productImportColumnMapping";
export type { ImportMapping } from "@/lib/productImport";
export type WorkbookImportOptions = { mapping?: ImportMapping; columnMapping?: Record<string, string>; legacyPlatform?: boolean; costCurrency?: "ARS" | "USD"; sheetName?: string; headerRow?: number };
export type WorkbookImportResult = {
  parsed: CatalogMigrationParseResult; mapping: ImportMapping; costCurrency: "ARS" | "USD";
  profile: "hardware" | "mapped" | "platform"; sheetName: string; sheetNames: string[];
  columns: { id: string; label: string; letter: string; samples: string[]; suggestedTarget: string }[]; negativeStock: number; fractionalStock: number; duplicateCodes: number;
  columnMapping: Record<string, string>; mappingFields: ProductColumnMappingField[]; mappingIssues: string[];
  fingerprint?: string;
  headerRow: number; headerCandidates: { value: string; label: string }[]; detectionWarnings: string[];
  costCurrencyAmbiguous: boolean;
};

const identifiers = new Set<string>(["sku", "barcode", "barcode2", "barcode3"]);
const missingPlaceholder = /^\*+\s*sin datos\s*\*+$/i;

/** Read-only: never executes formulas, external links or macros; the workbook stays in the worker. */
export function readProductWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  if (!buffer.byteLength || buffer.byteLength > PRODUCT_IMPORT_MAX_BYTES) throw new Error("El archivo debe pesar hasta 50 MB.");
  return XLSX.read(buffer, { type: "array", dense: true, raw: true, sheetRows: PRODUCT_IMPORT_FILE_MAX_ROWS + 22, cellFormula: false, cellNF: true });
}

export function mapProductWorkbook(workbook: XLSX.WorkBook, filename: string, options: WorkbookImportOptions = {}): WorkbookImportResult {
  const suggestions = workbook.SheetNames.flatMap(name => {
    const candidate = workbook.Sheets[name];
    if (!candidate?.["!ref"]) return [];
    const bounds = XLSX.utils.decode_range(candidate["!ref"]);
    if (bounds.e.c - bounds.s.c > 127) return [];
    const sampleRange = { s: bounds.s, e: { r: Math.min(bounds.e.r, bounds.s.r + 19), c: bounds.e.c } };
    const sample = XLSX.utils.sheet_to_json<unknown[]>(candidate, { header: 1, raw: true, defval: "", blankrows: true, range: sampleRange });
    const detected = detectProductHeader(sample);
    return detected.index < 0 || detected.index >= bounds.e.r - bounds.s.r ? [] : [{ name, score: detected.score }];
  }).sort((a, b) => b.score - a.score);
  const sheetName = options.sheetName || suggestions[0]?.name || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) throw new Error("La hoja seleccionada está vacía.");
  const loadedRange = XLSX.utils.decode_range(sheet["!ref"]);
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
  if (range.e.r > loadedRange.e.r) throw new Error("La hoja supera el área de lectura segura. No se puede importar una vista truncada del archivo.");
  if (range.e.c - range.s.c > 127 || range.e.r - range.s.r > PRODUCT_IMPORT_FILE_MAX_ROWS + 20) throw new Error("La hoja supera 50.000 productos o 128 columnas.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  const detection = detectProductHeader(matrix);
  const headerIndex = options.headerRow === undefined ? detection.index : options.headerRow - range.s.r - 1;
  if (options.headerRow !== undefined && (!Number.isInteger(headerIndex) || !detection.candidates.some(row => row.index === headerIndex))) throw new Error("No encontramos una fila de encabezados válida entre las primeras 20 filas de la hoja.");
  if (headerIndex < 0) throw new Error("No encontramos una fila de encabezados.");
  const headers = matrix[headerIndex].map(cell => String(cell).trim());
  const counts = new Map<string, number>();
  const normalizedCounts = new Map<string, number>();
  headers.forEach(header => counts.set(header, (counts.get(header) || 0) + 1));
  headers.forEach(header => { const key = normalizeImportHeader(header); normalizedCounts.set(key, (normalizedCounts.get(key) || 0) + 1); });
  const hardware = headers.some(header => normalizeImportHeader(header) === "codigo barra 1") && headers.some(header => normalizeImportHeader(header) === "precio de lista");
  const sourceRows = matrix.slice(headerIndex + 1).map((cells, i) => ({ cells, row: range.s.r + i + headerIndex + 2 })).filter(({ cells }) => cells.some(cell => String(cell).trim()));
  if (!sourceRows.length) throw new Error("La hoja no contiene productos.");
  if (sourceRows.length > PRODUCT_IMPORT_FILE_MAX_ROWS) throw new Error("El máximo por archivo es 50.000 productos.");
  const rawRow = ({ cells }: { cells: unknown[] }) => Object.fromEntries(headers.map((_, index) => [headers[index] + ((counts.get(headers[index]) || 0) > 1 ? `_${index}` : ""), cells[index] ?? ""]));
  const legacy = !!options.mapping && !options.columnMapping || !!options.legacyPlatform;
  const source = detectCatalogMigrationSource(legacy ? sourceRows.slice(0,100).map(rawRow) : [Object.fromEntries(headers.map(header => [header, ""]))], filename);
  const platform = ["shopify", "tiendanube"].includes(source);
  const bindings = prepareProductColumnMapping(headers, sourceRows.map(({ cells }) => cells), source, options.columnMapping);
  const mapping = legacy ? options.mapping || suggestProductColumns(headers).mapping : columnMappingToLegacy(bindings.effectiveMapping);
  const columns = headers.map((header, index) => {
    const letter = XLSX.utils.encode_col(range.s.c + index);
    const samples = [...new Set(sourceRows.slice(0, 20).map(({ cells, row }) => {
      const cell = (sheet as XLSX.WorkSheet & { "!data"?: XLSX.CellObject[][] })["!data"]?.[row - 1]?.[range.s.c + index];
      return String(cell ? XLSX.utils.format_cell(cell) : cells[index] ?? "").trim().slice(0, 120);
    }).filter(Boolean))].slice(0, 3);
    return { id: String(index), letter, samples, suggestedTarget: bindings.suggested[String(index)],
      label: (header || "Sin título") + ((normalizedCounts.get(normalizeImportHeader(header)) || 0) > 1 ? ` · columna ${letter}` : "") };
  });
  const costHeader = normalizeImportHeader(headers[Number(mapping.cost)] || "");
  const headerCurrency = importCostHeaderCurrency(costHeader);
  const costCurrency = options.costCurrency || (legacy ? hardware || /^(costo ars|costo en pesos|costo pesos)$/.test(costHeader) ? "ARS" : "USD" : headerCurrency || (hardware ? "ARS" : "USD"));
  let original: CatalogMigrationParseResult = !legacy || hardware && !platform
    ? { source, sourceRows: sourceRows.length, products: [], variantCount: 0, imageCount: 0, redirectCount: 0, warnings: [] }
    : parseCatalogMigrationRows(sourceRows.map(rawRow), filename);
  const platformHasCosts = platform && original.products.some(product => product.cost_usd !== undefined);
  if (platform && options.mapping && !options.legacyPlatform) throw new Error("Las exportaciones de plataforma conservan su agrupación de variantes.");
  const cellValue = (cells: unknown[], row: number, field: keyof ImportMapping) => {
    const index = Number(mapping[field]);
    if (mapping[field] === "" || !Number.isInteger(index) || !columns[index]) return undefined;
    const cell = (sheet as XLSX.WorkSheet & { "!data"?: XLSX.CellObject[][] })["!data"]?.[row - 1]?.[range.s.c + index];
    const value = cells[index];
    if (identifiers.has(field) && cell?.t === "n" && typeof cell.z === "string" && /0{2,}/.test(cell.z)) return XLSX.utils.format_cell(cell);
    const text = String(value ?? "").trim();
    return !text || missingPlaceholder.test(text) ? undefined : identifiers.has(field) ? text : value;
  };
  let products: CatalogMigrationProduct[] = !legacy ? [] : platform ? original.products.map(product => {
    // Platform exports use the store's currency, not an implied USD currency.
    // Reinterpret only after the merchant chooses; never convert the amount.
    if (costCurrency !== "ARS" || product.cost_usd === undefined) return product;
    const next: CatalogMigrationProduct = { ...product, cost_ars: product.cost_usd,
      provided: [...product.provided.filter(field => field !== "cost_usd"), "cost_ars"] };
    delete next.cost_usd;
    return next;
  }) : sourceRows.map(({ cells, row }, index) => {
    const product: CatalogMigrationProduct = { ...(hardware ? {} : original.products[index]), name: String(cellValue(cells, row, "name") ?? "").trim(), provided: [...(hardware ? [] : original.products[index].provided)], source_row: row,
      source_record: JSON.stringify({ headers, values: cells }) };
    if (product.name && !product.provided.includes("name")) product.provided.push("name");
    delete product.cost_ars; delete product.cost_usd;
    product.provided = product.provided.filter(field => field !== "cost_ars" && field !== "cost_usd");
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
  const mappingIssues = legacy ? [] : [...bindings.issues];
  if (!legacy) {
    const entries = Object.entries(bindings.effectiveMapping).filter(([, target]) => target);
    const selectedTargets = new Set(entries.map(([, target]) => target));
    const valueFor = (cells: unknown[], row: number, column: string, target: string) => {
      const index = Number(column); const raw = cells[index];
      const text = String(raw ?? "").trim();
      if (!text || missingPlaceholder.test(text)) return undefined;
      const cell = (sheet as XLSX.WorkSheet & { "!data"?: XLSX.CellObject[][] })["!data"]?.[row - 1]?.[range.s.c + index];
      return ["handle", "sku", "barcode", "barcode2", "barcode3"].includes(target) && cell?.t === "n" && typeof cell.z === "string" && /0{2,}/.test(cell.z) ? XLSX.utils.format_cell(cell) : raw;
    };
    if (platform) {
      const canonical = sourceRows.map(({ cells, row }) => Object.fromEntries(entries.map(([column, target]) => [bindings.canonicalHeaders[target], valueFor(cells, row, column, target) ?? ""])));
      const handleHeader = bindings.canonicalHeaders.handle;
      const invalidIdentity = canonical.some(record => !String(record[handleHeader] ?? "").trim());
      if (invalidIdentity && !bindings.requiredMissing) mappingIssues.push("Hay filas sin Identificador de URL. Completá su identidad antes de importar para no dividir productos y variantes.");
      const parsed = bindings.requiredMissing || bindings.structureInvalid || invalidIdentity ? { ...original, products: [], variantCount: 0, imageCount: 0, redirectCount: 0 } : parseCatalogMigrationRows(canonical, filename);
      original = parsed;
      const grouped = new Map<string, typeof sourceRows>();
      canonical.forEach((record, index) => {
        const key = String(record[handleHeader] ?? "").trim();
        const group = grouped.get(key) || [];
        group.push(sourceRows[index]); grouped.set(key, group);
      });
      products = parsed.products.map(product => {
        const next: CatalogMigrationProduct = { ...product, provided: [...product.provided] };
        const group = grouped.get(String(product.external_key)) || [];
        next.source_row = group[0]?.row;
        // Variants remain complete in normalized payload; raw metadata has a 16 KB per-product gate.
        next.source_record = JSON.stringify({ headers, values: group[0]?.cells || [], source_row_count: group.length, scope: "first_row" });
        const selected = (target: string) => selectedTargets.has(target) && group.some(({ cells, row }) => entries.some(([column, assigned]) => assigned === target && valueFor(cells, row, column, target) !== undefined));
        for (const [target, output] of [["status", "is_active"], ["published", "published"], ["stock", "maneja_stock"]]) {
          if (!selected(target) && !(output === "maneja_stock" && selected("inventory_tracker"))) {
            delete next[output]; next.provided = next.provided.filter(field => field !== output);
          }
        }
        for (const [target, output] of [["status", "is_active"], ["published", "published"]]) {
          const column = entries.find(([, assigned]) => assigned === target)?.[0];
          if (column === undefined || !selected(target)) continue;
          const values = group.map(({ cells, row }) => valueFor(cells, row, column, target)).filter(value => value !== undefined).map(value => normalizeImportHeader(String(value)));
          const booleans = values.map(value => ["true", "si", "1", "active", "activo"].includes(value) ? true : ["false", "no", "0", "draft", "archived", "inactivo"].includes(value) ? false : undefined);
          if (booleans.some(value => value === undefined) || new Set(booleans).size > 1) {
            const issue = `${bindings.fields.find(field => field.id === target)!.label} tiene valores inválidos o contradictorios dentro de un producto. Revisá la columna elegida.`;
            if (!mappingIssues.includes(issue)) mappingIssues.push(issue);
            delete next[output]; next.provided = next.provided.filter(field => field !== output);
          } else next[output] = booleans[0];
        }
        const categoryColumn = entries.find(([, target]) => target === "category")?.[0];
        if (categoryColumn !== undefined) {
          const category = group.map(({ cells, row }) => valueFor(cells, row, categoryColumn, "category")).find(value => value !== undefined);
          if (category !== undefined) next.category = String(category).trim();
        }
        if (costCurrency === "ARS" && next.cost_usd !== undefined) {
          next.cost_ars = next.cost_usd; delete next.cost_usd;
          next.provided = [...next.provided.filter(field => field !== "cost_usd"), "cost_ars"];
        }
        return next;
      });
    } else {
      const numeric = new Set(["cost", "sale", "stock", "discount_price_ars", "content_ml", "low_stock_threshold"]);
      const outputs: Record<string, string> = { cost: costCurrency === "ARS" ? "cost_ars" : "cost_usd", sale: "sale_price_ars" };
      products = sourceRows.map(({ cells, row }) => {
      const product: CatalogMigrationProduct = { name: "", provided: [], source_row: row, source_record: JSON.stringify({ headers, values: cells }) };
      const alternatives: string[] = [];
      for (const [column, target] of entries) {
        const raw = valueFor(cells, row, column, target);
        if (raw === undefined) continue;
        if (target === "barcode2" || target === "barcode3") { alternatives.push(String(raw).trim()); continue; }
        const output = target === "classification" ? "tags" : outputs[target] || target;
        product[output] = target === "classification" ? [String(raw).trim()] : numeric.has(target) ? parseImportNumber(raw) ?? String(raw).trim() : String(raw).trim();
        product.provided.push(output);
      }
      const aliases = [...new Set(alternatives)].filter(value => value !== product.barcode);
      if (aliases.length) { product.barcode_aliases = aliases; product.provided.push("barcode_aliases"); }
      return product;
      });
      if (source === "empretienda") original.warnings.push("Empretienda fue detectada por el nombre del archivo; revisá el mapeo antes de aprobar porque su plantilla pública no documenta todas las columnas.");
    }
  }
  const codes = new Map<string, number>();
  for (const product of products) { const key = String(product.sku || "").trim().toLowerCase(); if (key) codes.set(key, (codes.get(key) || 0) + 1); }
  const stocks = products.map(product => parseImportNumber(product.stock)).filter((value): value is number => value !== null);
  const warnings = [...original.warnings];
  const detectionWarnings = legacy ? platform ? [] : productColumnWarnings(headers, mapping) : [...mappingIssues];
  if (!options.headerRow && detection.uncertain) detectionWarnings.push("La fila de encabezados no es concluyente. Revisá la fila elegida y el mapeo antes de continuar.");
  if (!options.sheetName && suggestions.length > 1 && suggestions[0].score === suggestions[1].score) detectionWarnings.push("Hay varias hojas posibles. Revisá la hoja elegida antes de continuar; sólo se importa una por sesión.");
  const costCurrencyAmbiguous = !options.costCurrency && (legacy ? platformHasCosts || (!platform && !!mapping.cost && costHeader === "costo" && !hardware) : !!mapping.cost && !headerCurrency);
  if (costCurrencyAmbiguous) detectionWarnings.push("El costo no indica moneda. Confirmá ARS o USD; el valor no se convierte automáticamente.");
  if (hardware) warnings.push("PRECIO DE LISTA es el precio normal. VENTA se conserva como dato de origen para efectivo/transferencia; no se convierte en una oferta general ni cambia los descuentos del negocio.");
  if (!platform) warnings.push("Las columnas no mapeadas se conservan en el registro de origen del lote; no crean proveedores ni modifican descuentos automáticamente.");
  return { parsed: { ...original, products, sourceRows: sourceRows.length, warnings,
      variantCount: products.reduce((sum, product) => sum + (product.variants?.length || 0), 0),
      imageCount: products.reduce((sum, product) => sum + (product.image_urls?.length || 0), 0),
      redirectCount: products.filter(product => product.source_path).length }, mapping, costCurrency,
    columnMapping: legacy ? Object.fromEntries(columns.map(column => [column.id, Object.entries(mapping).find(([, value]) => value === column.id)?.[0] || ""])) : bindings.columnMapping,
    mappingFields: bindings.fields, mappingIssues,
    profile: platform ? "platform" : hardware ? "hardware" : "mapped", sheetName, sheetNames: workbook.SheetNames, columns,
    headerRow: range.s.r + headerIndex + 1, headerCandidates: detection.candidates.map(row => ({ value: String(range.s.r + row.index + 1), label: `Fila ${range.s.r + row.index + 1} · ${row.label}` })), detectionWarnings,
    costCurrencyAmbiguous,
    negativeStock: stocks.filter(value => value < 0).length, fractionalStock: stocks.filter(value => !Number.isInteger(value)).length,
    duplicateCodes: [...codes.values()].filter(value => value > 1).length };
}
