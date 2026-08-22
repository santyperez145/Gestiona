export const PRODUCT_IMPORT_MAX_ROWS = 5_000;

export const PRODUCT_IMPORT_FIELDS = [
  "name",
  "brand",
  "category",
  "gender",
  "sku",
  "barcode",
  "cost_usd",
  "sale_price_ars",
  "discount_price_ars",
  "stock",
  "content_ml",
  "description",
  "low_stock_threshold",
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];
export type ProductImportPayloadRow = Record<string, string | number | null | string[]> & {
  name: string;
  provided: string[];
};

const COLUMN_ALIASES: Record<ProductImportField, string[]> = {
  name: ["nombre", "name", "producto", "product", "titulo", "título"],
  brand: ["marca", "brand", "fabricante", "manufacturer"],
  category: ["categoria", "categoría", "category", "rubro", "tipo"],
  gender: ["genero", "género", "gender", "sexo"],
  sku: ["sku", "codigo", "código", "code", "ref", "referencia"],
  barcode: ["codigo de barras", "código de barras", "barcode", "ean", "ean13", "gtin"],
  cost_usd: ["costo usd", "cost usd", "precio costo usd", "precio de costo usd", "costo en usd", "costo"],
  sale_price_ars: [
    "precio venta ars", "precio venta", "precio de venta", "sale price", "price",
    "precio ars", "precio", "pvp", "precio final",
  ],
  discount_price_ars: [
    "precio descuento", "precio oferta", "precio promocional", "discount price",
    "promo", "promocion", "promoción",
  ],
  stock: ["stock", "cantidad", "quantity", "existencia", "existencias"],
  content_ml: ["contenido ml", "ml", "volumen", "volume", "contenido", "tamaño", "tamano"],
  description: ["descripcion", "descripción", "descripcion larga", "descripción larga", "detalles", "notes", "observaciones"],
  low_stock_threshold: ["stock minimo", "stock mínimo", "umbral stock", "low stock threshold", "alerta stock"],
};

const NUMERIC_FIELDS = new Set<ProductImportField>([
  "cost_usd",
  "sale_price_ars",
  "discount_price_ars",
  "stock",
  "content_ml",
  "low_stock_threshold",
]);

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/perfum|fragran|eau de/i, "perfume_diseñador"],
  [/arab|oud|attar/i, "perfume_arabe"],
  [/vaper|vape|pod|cigarrillo elect/i, "vaper"],
  [/accesorio|accessory/i, "accesorio"],
  [/ropa|talle|indumentaria|prenda/i, "ropa"],
];

const GENDER_HINTS: Array<[RegExp, string]> = [
  [/femenin|mujer|woman|female|women/i, "femenino"],
  [/masculin|hombre|man|male|men/i, "masculino"],
  [/unisex|both/i, "unisex"],
];

export function normalizeImportHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findCell(row: Record<string, unknown>, field: ProductImportField) {
  const aliases = new Set(COLUMN_ALIASES[field].map(normalizeImportHeader));
  const header = Object.keys(row).find(key => aliases.has(normalizeImportHeader(key)));
  return header === undefined
    ? { present: false, value: undefined }
    : { present: true, value: row[header] };
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * Interpreta formatos habituales de Argentina y planillas internacionales.
 * En particular, no convierte `25.50` en `2550`, que era el bug del importador anterior.
 */
export function parseImportNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!hasValue(value)) return null;

  let raw = String(value).trim().replace(/[^0-9,.-]/g, "");
  if (!raw || raw === "-" || !/^-?[0-9][0-9.,]*$/.test(raw)) return null;

  const negative = raw.startsWith("-");
  if (negative) raw = raw.slice(1);
  const commas = (raw.match(/,/g) || []).length;
  const dots = (raw.match(/\./g) || []).length;
  let normalized = raw;

  if (commas > 0 && dots > 0) {
    const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw.split(groupingSeparator).join("").replace(decimalSeparator, ".");
  } else if (commas > 0) {
    if (commas > 1 && raw.split(",").slice(1).every(group => group.length === 3)) {
      normalized = raw.replace(/,/g, "");
    } else {
      const last = raw.lastIndexOf(",");
      normalized = raw.slice(0, last).replace(/,/g, "") + "." + raw.slice(last + 1);
    }
  } else if (dots > 0) {
    const groups = raw.split(".");
    const looksGrouped = groups.length > 2
      ? groups.slice(1).every(group => group.length === 3)
      : groups[1]?.length === 3 && groups[0] !== "0";
    normalized = looksGrouped
      ? raw.replace(/\./g, "")
      : groups.slice(0, -1).join("") + "." + groups.at(-1);
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectImportCategory(name: string, rawCategory: string): string {
  const combined = `${name} ${rawCategory}`;
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(combined)) return category;
  }
  return rawCategory.trim().toLowerCase() || "otro";
}

export function detectImportGender(name: string, rawGender: string): string {
  const combined = `${name} ${rawGender}`;
  for (const [pattern, gender] of GENDER_HINTS) {
    if (pattern.test(combined)) return gender;
  }
  return "unisex";
}

/**
 * Convierte una fila de planilla al contrato del RPC. `provided` incluye sólo
 * celdas con valor: una columna vacía nunca borra silenciosamente un dato existente.
 */
export function buildProductImportRow(row: Record<string, unknown>): ProductImportPayloadRow {
  const nameCell = findCell(row, "name");
  const name = hasValue(nameCell.value) ? String(nameCell.value).trim() : "";
  const payload: ProductImportPayloadRow = { name, provided: name ? ["name"] : [] };

  for (const field of PRODUCT_IMPORT_FIELDS) {
    if (field === "name") continue;
    const cell = findCell(row, field);
    if (!cell.present || !hasValue(cell.value)) continue;

    payload.provided.push(field);
    if (NUMERIC_FIELDS.has(field)) {
      const parsed = parseImportNumber(cell.value);
      payload[field] = parsed ?? String(cell.value).trim();
    } else {
      payload[field] = String(cell.value).trim();
    }
  }

  const category = String(payload.category ?? "");
  const gender = String(payload.gender ?? "");
  payload.category = detectImportCategory(name, category);
  payload.gender = detectImportGender(name, gender);
  return payload;
}

export interface ProductImportCalculationParams {
  exchangeRate: number;
  customsPercent: number;
  defaultMarginPercent: number;
  autoFillSalePrice: boolean;
}

export interface ProductImportPreview {
  costUSD: number;
  salePriceARS: number;
  stock: number | null;
  totalCostUSD: number;
  profitARS: number;
  marginPercent: number;
  localIssues: string[];
}

/** Espejo informativo; `stage_product_import` sigue siendo la autoridad. */
export function previewProductImportRow(
  row: ProductImportPayloadRow,
  params: ProductImportCalculationParams,
): ProductImportPreview {
  const cost = parseImportNumber(row.cost_usd);
  const importedPrice = parseImportNumber(row.sale_price_ars);
  const stock = parseImportNumber(row.stock);
  let price = importedPrice ?? 0;
  if (params.autoFillSalePrice && price <= 0 && (cost ?? 0) > 0 && params.exchangeRate > 0) {
    price = Math.round(
      (cost ?? 0) * (1 + params.customsPercent / 100) * params.exchangeRate
      * (1 + params.defaultMarginPercent / 100),
    );
  }

  const totalCostUSD = (cost ?? 0) * (1 + params.customsPercent / 100);
  const profitARS = price - totalCostUSD * params.exchangeRate;
  const issues: string[] = [];
  if (!row.name.trim()) issues.push("Falta el nombre");
  if (row.provided.includes("cost_usd") && cost === null) issues.push("Costo inválido");
  if (row.provided.includes("sale_price_ars") && importedPrice === null) issues.push("Precio inválido");
  if (row.provided.includes("stock") && (stock === null || stock < 0 || !Number.isInteger(stock))) issues.push("Stock inválido");
  if (price <= 0) issues.push("Falta el precio");
  if ((cost ?? 0) === 0) issues.push("Margen incompleto: falta costo");

  return {
    costUSD: cost ?? 0,
    salePriceARS: price,
    stock,
    totalCostUSD,
    profitARS,
    marginPercent: price > 0 ? (profitARS / price) * 100 : 0,
    localIssues: issues,
  };
}

export function productImportFormat(filename: string): "xlsx" | "xls" | "csv" | null {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension === "xlsx" || extension === "xls" || extension === "csv" ? extension : null;
}
