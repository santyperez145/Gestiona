import type { CatalogMigrationSource } from "@/lib/catalogMigration";
import { IMPORT_MAPPING_FIELDS, normalizeImportHeader, type ImportMapping } from "@/lib/productImport";
import { PRODUCT_WORKBOOK_ALIASES } from "@/lib/productImportDetection";

export type ProductColumnMappingField = { id: string; label: string; required?: boolean };
type Field = ProductColumnMappingField & { aliases: string[]; header?: string };
const field = (id: string, label: string, aliases: string[], header?: string, required?: boolean): Field => ({ id, label, aliases, header, required });
const genericFields: Field[] = [
  ...Object.entries(IMPORT_MAPPING_FIELDS).map(([id, label]) => field(id, label, PRODUCT_WORKBOOK_ALIASES[id as keyof ImportMapping], undefined, id === "name")),
  field("gender", "Género", ["genero", "gender", "sexo"]),
  field("content_ml", "Contenido (ml)", ["contenido ml", "ml", "volumen", "volume", "contenido", "tamano"]),
  field("low_stock_threshold", "Stock mínimo", ["stock minimo", "umbral stock", "low stock threshold", "alerta stock"]),
  field("discount_price_ars", "Precio de oferta (ARS)", ["precio descuento", "precio oferta", "precio promocional", "discount price", "promo", "promocion"]),
];
const options = (source: "shopify" | "tiendanube"): Field[] => [1, 2, 3].flatMap(number => source === "shopify" ? [
  field(`option${number}_name`, `Propiedad ${number}: nombre`, [`Option${number} Name`], `Option${number} Name`),
  field(`option${number}_value`, `Propiedad ${number}: valor`, [`Option${number} Value`], `Option${number} Value`),
] : [
  field(`option${number}_name`, `Propiedad ${number}: nombre`, [`Nombre de propiedad ${number}`, `Propiedad ${number}`], `Nombre de propiedad ${number}`),
  field(`option${number}_value`, `Propiedad ${number}: valor`, [`Valor de propiedad ${number}`, `Valores de propiedad ${number}`, `Valores ${number}`], `Valor de propiedad ${number}`),
]);
const shopifyFields: Field[] = [
  field("handle", "Identificador de URL", ["URL handle", "Handle"], "Handle", true),
  field("name", "Nombre del producto", ["Title"], "Title", true),
  field("sku", "Código / SKU", ["SKU", "Variant SKU"], "Variant SKU"),
  field("barcode", "Código de barras principal", ["Barcode", "Variant Barcode"], "Variant Barcode"),
  field("sale", "Precio de venta (ARS)", ["Price", "Variant Price"], "Variant Price"),
  field("compare_price", "Precio comparativo (ARS)", ["Compare-at price", "Variant Compare At Price"], "Variant Compare At Price"),
  field("cost", "Costo", ["Cost per item"], "Cost per item"),
  field("stock", "Stock", ["Inventory quantity", "Variant Inventory Qty"], "Variant Inventory Qty"),
  field("brand", "Marca", ["Vendor"], "Vendor"),
  field("category", "Rubro / categoría", ["Type", "Product category"], "Type"),
  field("description", "Descripción adicional", ["Description", "Body (HTML)"], "Body (HTML)"),
  field("tags", "Etiquetas", ["Tags"], "Tags"),
  field("image", "Imagen del producto (URL)", ["Product image URL", "Image Src"], "Image Src"),
  field("variant_image", "Imagen de variante (URL)", ["Variant image URL", "Variant Image"], "Variant Image"),
  field("status", "Estado del producto", ["Status"], "Status"),
  field("published", "Publicado en tienda", ["Published on online store", "Published"], "Published"),
  field("weight", "Peso (gramos)", ["Weight value (grams)", "Variant Grams"], "Variant Grams"),
  field("inventory_tracker", "Seguimiento de inventario", ["Inventory tracker"], "Inventory tracker"),
  ...options("shopify"),
];
const tiendanubeFields: Field[] = [
  field("handle", "Identificador de URL", ["Identificador de URL", "Identificador URL", "Handle"], "Identificador de URL", true),
  field("name", "Nombre del producto", ["Nombre", "Título"], "Nombre", true),
  field("sku", "Código / SKU", ["SKU"], "SKU"),
  field("barcode", "Código de barras principal", ["Código de barras"], "Código de barras"),
  field("sale", "Precio normal / lista (ARS)", ["Precio"], "Precio"),
  field("discount_price_ars", "Precio de oferta (ARS)", ["Precio promocional"], "Precio promocional"),
  field("cost", "Costo", ["Costo", "Precio de costo"], "Costo"),
  field("stock", "Stock", ["Stock"], "Stock"),
  field("brand", "Marca", ["Marca"], "Marca"),
  field("category", "Rubro / categoría", ["Categorías", "Categoría"], "Categorías"),
  field("description", "Descripción adicional", ["Descripción"], "Descripción"),
  field("tags", "Etiquetas", ["Tags", "Etiquetas"], "Tags"),
  field("image", "Imagen del producto (URL)", ["URL de imagen", "Imagen", "Image Src"], "URL de imagen"),
  field("published", "Publicado en tienda", ["Mostrar en tienda"], "Mostrar en tienda"),
  field("weight", "Peso (kg)", ["Peso"], "Peso"),
  field("height", "Alto (cm)", ["Alto"], "Alto"),
  field("width", "Ancho (cm)", ["Ancho"], "Ancho"),
  field("length", "Profundidad / largo (cm)", ["Profundidad", "Largo"], "Profundidad"),
  ...options("tiendanube"),
];
const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";

/** Column choices are the authority; aliases only suggest, never approve ambiguous data. */
export function prepareProductColumnMapping(headers: string[], rows: unknown[][], source: CatalogMigrationSource, explicit?: Record<string, string>) {
  const platform = source === "shopify" || source === "tiendanube";
  const registry = (source === "shopify" ? shopifyFields : source === "tiendanube" ? tiendanubeFields : genericFields).map(item => ({ ...item }));
  const normalized = headers.map(normalizeImportHeader);
  const suggested: Record<string, string> = Object.fromEntries(headers.map((_, index) => [String(index), ""]));
  const ambiguous: string[] = [];
  for (const item of registry) {
    let aliases = item.aliases.map(normalizeImportHeader);
    // In ERP exports DESCRIPCION is the name only when no distinct name exists.
    if (!platform && item.id === "name" && normalized.some(header => aliases.includes(header) && header !== "descripcion")) aliases = aliases.filter(alias => alias !== "descripcion");
    // A payment-conditioned VENTA is not the normal list price in this profile.
    if (!platform && item.id === "sale" && normalized.some(header => ["precio de lista", "precio lista"].includes(header))) aliases = ["precio de lista", "precio lista"];
    const matches = normalized.flatMap((header, index) => aliases.includes(header) ? [index] : []);
    if (matches.length > 1) ambiguous.push(item.label);
    else if (matches.length === 1 && !(item.id === "description" && suggested[String(matches[0])] === "name")) suggested[String(matches[0])] = item.id;
  }
  // A true variant value makes its complete name/value pair structural.
  const structuralRows = new Map<string, number[]>();
  if (platform) for (const number of [1, 2, 3]) {
    const valueField = registry.find(item => item.id === `option${number}_value`)!;
    const valueColumns = normalized.flatMap((header, index) => valueField.aliases.map(normalizeImportHeader).includes(header) ? [index] : []);
    if (explicit) valueColumns.push(...Object.entries(explicit).filter(([column, target]) => target === valueField.id && /^(0|[1-9]\d*)$/.test(column) && Number(column) < headers.length).map(([column]) => Number(column)));
    const populated = rows.flatMap((row, index) => valueColumns.some(column => hasValue(row[column]) && !(source === "shopify" && normalizeImportHeader(String(row[column])) === "default title")) ? [index] : []);
    if (populated.length) {
      structuralRows.set(valueField.id, populated);
      for (const item of registry) if (item.id === `option${number}_name` || item.id === `option${number}_value`) item.required = true;
    }
  }
  const issues: string[] = explicit ? [] : ambiguous.map(label => `${label} coincide con varias columnas. Elegí una o marcá las columnas como No importar.`);
  const mapping = Object.fromEntries(headers.map((_, index) => [String(index), explicit ? "" : suggested[String(index)]])) as Record<string, string>;
  if (explicit) for (const [column, target] of Object.entries(explicit)) {
    if (!/^(0|[1-9]\d*)$/.test(column) || Number(column) >= headers.length) {
      issues.push(`La columna ${column} no existe en la hoja elegida.`); continue;
    }
    if (typeof target !== "string" || target && !registry.some(item => item.id === target)) {
      issues.push(`La columna ${column} tiene un destino inválido.`); continue;
    }
    mapping[column] = target;
  }
  const effective = { ...mapping };
  for (const item of registry) {
    const assigned = Object.entries(mapping).filter(([, target]) => target === item.id);
    if (assigned.length > 1) {
      issues.push(`${item.label} tiene más de una columna asignada. Conservá sólo una.`);
      assigned.forEach(([column]) => { effective[column] = ""; });
    }
    if (item.required && !Object.values(effective).includes(item.id)) issues.push(`Elegí una columna para ${item.label}; es obligatoria para conservar el catálogo.`);
  }
  for (const dependent of ["compare_price", "discount_price_ars"]) if (platform && Object.values(effective).includes(dependent) && !Object.values(effective).includes("sale")) {
    issues.push("El precio de oferta/comparativo requiere una columna de precio normal.");
    Object.entries(effective).forEach(([column, target]) => { if (target === dependent) effective[column] = ""; });
  }
  let structureInvalid = false;
  const handleColumn = Object.entries(effective).find(([, target]) => target === "handle")?.[0];
  for (const [valueTarget, populated] of structuralRows) {
    const valueColumn = Object.entries(effective).find(([, target]) => target === valueTarget)?.[0];
    const nameTarget = valueTarget.replace(/_value$/, "_name");
    const nameColumn = Object.entries(effective).find(([, target]) => target === nameTarget)?.[0];
    if (valueColumn === undefined || nameColumn === undefined) continue;
    const losesValues = populated.some(index => !hasValue(rows[index][Number(valueColumn)]) || source === "shopify" && normalizeImportHeader(String(rows[index][Number(valueColumn)])) === "default title");
    const groupKey = (index: number) => handleColumn === undefined ? String(index) : String(rows[index][Number(handleColumn)] ?? "").trim();
    const namedGroups = new Set(rows.flatMap((row, index) => hasValue(row[Number(nameColumn)]) ? [groupKey(index)] : []));
    const losesNames = populated.some(index => !namedGroups.has(groupKey(index)));
    if (losesValues || losesNames) {
      const label = registry.find(item => item.id === valueTarget)!.label;
      issues.push(`${label} perdería datos de variantes. Elegí columnas con valores y nombre de propiedad completos.`);
      structureInvalid = true;
    }
  }
  const fields = registry.map(({ id, label, required }) => ({ id, label, ...(required ? { required } : {}) }));
  const requiredMissing = registry.some(item => item.required && !Object.values(effective).includes(item.id));
  return { columnMapping: mapping, effectiveMapping: effective, suggested, fields, issues, requiredMissing, structureInvalid,
    canonicalHeaders: Object.fromEntries(registry.map(item => [item.id, item.header || item.id])) as Record<string, string> };
}

export function columnMappingToLegacy(mapping: Record<string, string>): ImportMapping {
  return Object.fromEntries(Object.keys(IMPORT_MAPPING_FIELDS).map(field => [field, Object.entries(mapping).find(([, target]) => target === field)?.[0] || ""])) as ImportMapping;
}

export function importCostHeaderCurrency(header: string): "ARS" | "USD" | undefined {
  const normalized = normalizeImportHeader(header);
  if (/\b(ars|pesos)\b/.test(normalized)) return "ARS";
  if (/\b(usd|dolares)\b/.test(normalized)) return "USD";
  return undefined;
}
