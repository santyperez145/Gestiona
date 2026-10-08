import { detectCatalogMigrationSource } from "@/lib/catalogMigration";
import { IMPORT_MAPPING_FIELDS, normalizeImportHeader, type ImportMapping } from "@/lib/productImport";

// Exact aliases only: guessing a money/identity column can corrupt a catalogue.
export const PRODUCT_WORKBOOK_ALIASES: Record<keyof ImportMapping, string[]> = {
  name: ["nombre", "nombre del producto", "nombre producto", "producto", "articulo", "name", "title", "titulo", "descripcion"],
  sku: ["sku", "codigo", "codigo de articulo", "codigo articulo", "cod articulo", "code", "referencia"],
  brand: ["marca", "brand", "fabricante"], category: ["rubro", "categoria", "category"],
  cost: ["costo ars", "costo en pesos", "costo pesos", "costo usd", "costo"],
  sale: ["precio de lista", "precio lista", "precio venta ars", "precio de venta", "precio venta", "precio publico", "pvp", "precio", "price", "venta"],
  barcode: ["codigo barra 1", "codigo de barras", "barcode", "ean", "ean13", "gtin"],
  barcode2: ["codigo barra 2"], barcode3: ["codigo barra 3"],
  stock: ["stock", "existencia", "existencias", "cantidad", "quantity"],
  description: ["descripcion larga", "descripcion adicional", "descripcion", "description"],
  classification: ["clasificacion"],
};

export function suggestProductColumns(headers: string[]) {
  const normalized = headers.map(normalizeImportHeader);
  const ambiguous: (keyof ImportMapping)[] = [];
  const mapping = Object.fromEntries(Object.entries(PRODUCT_WORKBOOK_ALIASES).map(([field, names]) => {
    for (const name of names) {
      const indices = normalized.flatMap((header, index) => header === name ? [index] : []);
      if (indices.length > 1) { ambiguous.push(field as keyof ImportMapping); return [field, ""]; }
      if (indices.length === 1) return [field, String(indices[0])];
    }
    return [field, ""];
  })) as ImportMapping;
  if (mapping.description === mapping.name) mapping.description = "";
  return { mapping, ambiguous };
}

export function detectProductHeader(matrix: unknown[][]) {
  const candidates = matrix.slice(0, 20).flatMap((cells, index) => {
    const headers = cells.map(cell => String(cell ?? "").trim());
    if (headers.filter(Boolean).length < 2) return [];
    const { mapping } = suggestProductColumns(headers);
    const fields = Object.values(mapping).filter(Boolean).length;
    const source = detectCatalogMigrationSource([Object.fromEntries(headers.map(header => [header, ""]))]);
    const platform = source === "shopify" || source === "tiendanube";
    // Rank the whole bounded preamble, not the first pair of familiar words.
    const score = platform ? 100 + fields : fields >= 2 ? fields * 2 + (mapping.name ? 5 : 0) + (mapping.sku ? 4 : 0) : 0;
    return [{ index, score, label: headers.filter(Boolean).slice(0, 3).join(" · ").slice(0, 180) }];
  });
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index);
  return { index: ranked[0]?.index ?? -1, score: ranked[0]?.score ?? 0, candidates,
    uncertain: !ranked[0]?.score || (ranked.length > 1 && ranked[0].score === ranked[1].score) };
}

export function productColumnWarnings(headers: string[], mapping: ImportMapping) {
  const suggestions = suggestProductColumns(headers);
  const warnings = suggestions.ambiguous.filter(field => !mapping[field])
    .map(field => `${IMPORT_MAPPING_FIELDS[field]} tiene encabezados repetidos. Elegí la columna correcta o dejala sin importar.`);
  if (!mapping.name) warnings.push("Elegí la columna Nombre del producto antes de validar el catálogo.");
  return warnings;
}
