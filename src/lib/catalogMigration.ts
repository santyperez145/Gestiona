import {
  buildProductImportRow,
  normalizeImportHeader,
  parseImportNumber,
  type ProductImportPayloadRow,
} from "@/lib/productImport";

export type CatalogMigrationSource = "shopify" | "tiendanube" | "empretienda" | "nerqia" | "generic";

export type CatalogMigrationVariant = {
  external_key: string;
  name: string;
  variant_type: string;
  sku?: string;
  barcode?: string;
  price_override?: number | string;
  stock?: number | string;
  image_url?: string;
  provided: string[];
};

export type CatalogMigrationProduct = ProductImportPayloadRow & {
  external_key?: string;
  source_path?: string;
  image_urls?: string[];
  tags?: string[];
  weight_kg?: number | string;
  height_cm?: number | string;
  width_cm?: number | string;
  length_cm?: number | string;
  is_active?: boolean;
  published?: boolean;
  maneja_stock?: boolean;
  variants?: CatalogMigrationVariant[];
};

export type CatalogMigrationParseResult = {
  source: CatalogMigrationSource;
  products: CatalogMigrationProduct[];
  sourceRows: number;
  variantCount: number;
  imageCount: number;
  redirectCount: number;
  warnings: string[];
};

type RawRow = Record<string, unknown>;
type IndexedRow = Record<string, unknown>;

const SOURCE_LABELS: Record<CatalogMigrationSource, string> = {
  shopify: "Shopify",
  tiendanube: "Tiendanube",
  empretienda: "Empretienda",
  nerqia: "Nerqia",
  generic: "Planilla genérica",
};

export function catalogMigrationSourceLabel(source: CatalogMigrationSource): string {
  return SOURCE_LABELS[source];
}

function indexRow(row: RawRow): IndexedRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeImportHeader(key), value]));
}

function value(row: IndexedRow, aliases: string[]): unknown {
  for (const alias of aliases) {
    const found = row[normalizeImportHeader(alias)];
    if (found !== undefined && found !== null && String(found).trim() !== "") return found;
  }
  return undefined;
}

function textValue(row: IndexedRow, aliases: string[]): string {
  const found = value(row, aliases);
  return found === undefined ? "" : String(found).trim();
}

function firstText(rows: IndexedRow[], aliases: string[]): string {
  for (const row of rows) {
    const found = textValue(row, aliases);
    if (found) return found;
  }
  return "";
}

function sourceNumber(raw: unknown): number | string | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const parsed = parseImportNumber(raw);
  return parsed ?? String(raw).trim();
}

function firstNumber(rows: IndexedRow[], aliases: string[]): number | string | undefined {
  for (const row of rows) {
    const raw = value(row, aliases);
    const parsed = sourceNumber(raw);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function asBoolean(raw: unknown, fallback = true): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const normalized = normalizeImportHeader(String(raw));
  if (["false", "no", "0", "draft", "archived", "inactivo"].includes(normalized)) return false;
  if (["true", "si", "1", "active", "activo"].includes(normalized)) return true;
  return fallback;
}

function cleanDescription(raw: string): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tagsFrom(raw: string): string[] {
  return [...new Set(raw.split(/[,;]+/).map(tag => tag.trim()).filter(Boolean))].slice(0, 250);
}

function secureImageUrls(rows: IndexedRow[], aliases: string[]): string[] {
  const urls: string[] = [];
  for (const row of rows) {
    const raw = textValue(row, aliases);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const normalized = url.toString();
      if (!urls.includes(normalized)) urls.push(normalized);
    } catch {
      // El servidor vuelve a validar. La vista local sólo omite URLs inseguras.
    }
  }
  return urls.slice(0, 50);
}

function categoryValue(name: string, raw: string): string {
  const generic = buildProductImportRow({ Nombre: name, Categoría: raw });
  return String(generic.category || "otro");
}

function addProvided(product: CatalogMigrationProduct, field: string, raw: unknown) {
  if (raw !== undefined && raw !== null && String(raw).trim() !== "" && !product.provided.includes(field)) {
    product.provided.push(field);
  }
}

function assignOptional(
  product: CatalogMigrationProduct,
  field: keyof CatalogMigrationProduct,
  raw: unknown,
) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return;
  (product as Record<string, unknown>)[field] = raw;
  addProvided(product, String(field), raw);
}

function withPrices(
  product: CatalogMigrationProduct,
  regularRaw: unknown,
  promotionalRaw: unknown,
) {
  const regular = sourceNumber(regularRaw);
  const promotional = sourceNumber(promotionalRaw);
  if (regular !== undefined) assignOptional(product, "sale_price_ars", regular);
  if (typeof regular === "number" && typeof promotional === "number" && promotional > 0 && promotional < regular) {
    assignOptional(product, "discount_price_ars", promotional);
  }
}

function groupBy(rows: IndexedRow[], keyAliases: string[], nameAliases: string[]): Map<string, IndexedRow[]> {
  const groups = new Map<string, IndexedRow[]>();
  rows.forEach((row, index) => {
    const key = textValue(row, keyAliases) || textValue(row, nameAliases) || `fila-${index + 1}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return groups;
}

function variantIdentity(handle: string, values: string[], sku: string, index: number): string {
  return `${handle}::${sku || values.join("|") || index + 1}`.slice(0, 500);
}

function parseShopify(rows: IndexedRow[]): CatalogMigrationProduct[] {
  const groups = groupBy(rows, ["URL handle", "Handle"], ["Title"]);
  const products: CatalogMigrationProduct[] = [];

  for (const [handle, group] of groups) {
    const name = firstText(group, ["Title"]);
    const description = cleanDescription(firstText(group, ["Description", "Body (HTML)"]));
    const brand = firstText(group, ["Vendor"]);
    const category = firstText(group, ["Type", "Product category", "Product Category"]);
    const tags = tagsFrom(firstText(group, ["Tags"]));
    const images = secureImageUrls(group, ["Product image URL", "Image Src"]);
    const status = firstText(group, ["Status"]);
    const publishedRaw = value(group[0], ["Published on online store", "Published"]);
    const optionNames = [1, 2, 3]
      .map(number => firstText(group, [`Option${number} name`, `Option${number} Name`]))
      .filter(option => option && normalizeImportHeader(option) !== "default title");

    const candidates = group.map((row, index) => {
      const optionValues = [1, 2, 3]
        .map(number => textValue(row, [`Option${number} value`, `Option${number} Value`]))
        .filter(option => option && normalizeImportHeader(option) !== "default title");
      const sku = textValue(row, ["SKU", "Variant SKU"]);
      const barcode = textValue(row, ["Barcode", "Variant Barcode"]);
      const price = sourceNumber(value(row, ["Price", "Variant Price"]));
      const stock = sourceNumber(value(row, ["Inventory quantity", "Variant Inventory Qty"]));
      const image = secureImageUrls([row], ["Variant image URL", "Variant Image"])[0];
      const hasVariantData = optionValues.length > 0;
      const provided = [
        "variant_type",
        ...(sku ? ["sku"] : []), ...(barcode ? ["barcode"] : []),
        ...(price !== undefined ? ["price_override"] : []),
        ...(stock !== undefined ? ["stock"] : []), ...(image ? ["image_url"] : []),
      ];
      return {
        optionValues, sku, barcode, price, stock, image, hasVariantData, provided,
        externalKey: variantIdentity(handle, optionValues, sku, index),
      };
    });
    const hasVariants = candidates.some(candidate => candidate.hasVariantData);
    const firstSellable = candidates.find(candidate => candidate.price !== undefined || candidate.sku || candidate.stock !== undefined);

    const product: CatalogMigrationProduct = {
      name,
      provided: name ? ["name"] : [],
      external_key: handle,
      source_path: handle && !handle.startsWith("fila-") ? `/products/${handle}` : undefined,
      variants: [],
    };
    assignOptional(product, "brand", brand);
    if (category) assignOptional(product, "category", categoryValue(name, category));
    assignOptional(product, "description", description);
    if (tags.length) assignOptional(product, "tags", tags);
    if (images.length) assignOptional(product, "image_urls", images);
    assignOptional(product, "is_active", status ? normalizeImportHeader(status) === "active" : true);
    assignOptional(product, "published", asBoolean(publishedRaw, true));

    const regular = firstNumber(group, ["Price", "Variant Price"]);
    const compareAt = firstNumber(group, ["Compare-at price", "Variant Compare At Price"]);
    if (typeof regular === "number" && typeof compareAt === "number" && compareAt > regular) {
      assignOptional(product, "sale_price_ars", compareAt);
      assignOptional(product, "discount_price_ars", regular);
    } else if (regular !== undefined) {
      assignOptional(product, "sale_price_ars", regular);
    }
    assignOptional(product, "cost_usd", firstNumber(group, ["Cost per item", "Cost per Item"]));

    const grams = firstNumber(group, ["Weight value (grams)", "Variant Grams"]);
    if (typeof grams === "number") assignOptional(product, "weight_kg", grams / 1000);

    if (hasVariants) {
      product.variants = candidates.filter(candidate => candidate.hasVariantData).map((candidate, index) => ({
        external_key: candidate.externalKey,
        name: candidate.optionValues.join(" / "),
        variant_type: optionNames.join(" / ") || "variante",
        ...(candidate.sku ? { sku: candidate.sku } : {}),
        ...(candidate.barcode ? { barcode: candidate.barcode } : {}),
        ...(candidate.price !== undefined ? { price_override: candidate.price } : {}),
        ...(candidate.stock !== undefined ? { stock: candidate.stock } : {}),
        ...(candidate.image ? { image_url: candidate.image } : {}),
        provided: candidate.provided,
      }));
      const stocks = product.variants.map(variant => parseImportNumber(variant.stock)).filter((stock): stock is number => stock !== null);
      if (stocks.length) assignOptional(product, "stock", stocks.reduce((sum, stock) => sum + stock, 0));
    } else if (firstSellable) {
      assignOptional(product, "sku", firstSellable.sku);
      assignOptional(product, "barcode", firstSellable.barcode);
      assignOptional(product, "stock", firstSellable.stock);
    }
    assignOptional(
      product,
      "maneja_stock",
      candidates.some(candidate => candidate.stock !== undefined)
        || firstText(group, ["Inventory tracker"]) !== "",
    );
    products.push(product);
  }
  return products;
}

function parseTiendanube(rows: IndexedRow[]): CatalogMigrationProduct[] {
  const groups = groupBy(rows, ["Identificador de URL", "Identificador URL", "Handle"], ["Nombre"]);
  const products: CatalogMigrationProduct[] = [];

  for (const [handle, group] of groups) {
    const name = firstText(group, ["Nombre", "Título"]);
    const brand = firstText(group, ["Marca"]);
    const category = firstText(group, ["Categorías", "Categorias", "Categoría"]);
    const description = cleanDescription(firstText(group, ["Descripción"]));
    const tags = tagsFrom(firstText(group, ["Tags", "Etiquetas"]));
    const images = secureImageUrls(group, ["URL de imagen", "Imagen", "Image Src"]);
    const optionNames = [1, 2, 3]
      .map(number => firstText(group, [`Nombre de propiedad ${number}`, `Propiedad ${number}`]))
      .filter(Boolean);
    const candidates = group.map((row, index) => {
      const optionValues = [1, 2, 3]
        .map(number => textValue(row, [`Valor de propiedad ${number}`, `Valores de propiedad ${number}`, `Valores ${number}`]))
        .filter(Boolean);
      const sku = textValue(row, ["SKU"]);
      const barcode = textValue(row, ["Código de barras", "Codigo de barras"]);
      const price = sourceNumber(value(row, ["Precio"]));
      const promo = sourceNumber(value(row, ["Precio promocional", "Precio Promocional"]));
      const rawStock = value(row, ["Stock"]);
      const infinite = String(rawStock ?? "").trim() === "-";
      const stock = infinite ? undefined : sourceNumber(rawStock);
      return {
        optionValues, sku, barcode, price, promo, stock, infinite,
        externalKey: variantIdentity(handle, optionValues, sku, index),
      };
    });
    const hasVariants = candidates.some(candidate => candidate.optionValues.length > 0);
    const first = candidates[0];
    const product: CatalogMigrationProduct = {
      name,
      provided: name ? ["name"] : [],
      external_key: handle,
      source_path: handle && !handle.startsWith("fila-") ? `/productos/${handle}` : undefined,
      variants: [],
    };
    assignOptional(product, "brand", brand);
    if (category) assignOptional(product, "category", categoryValue(name, category.split(",")[0]));
    assignOptional(product, "description", description);
    if (tags.length) assignOptional(product, "tags", tags);
    if (images.length) assignOptional(product, "image_urls", images);
    assignOptional(product, "published", asBoolean(value(group[0], ["Mostrar en tienda"]), true));
    assignOptional(product, "is_active", true);
    assignOptional(product, "cost_usd", firstNumber(group, ["Costo", "Precio de costo"]));
    assignOptional(product, "weight_kg", firstNumber(group, ["Peso"]));
    assignOptional(product, "height_cm", firstNumber(group, ["Alto"]));
    assignOptional(product, "width_cm", firstNumber(group, ["Ancho"]));
    assignOptional(product, "length_cm", firstNumber(group, ["Profundidad", "Largo"]));
    withPrices(product, first?.price, first?.promo);

    const finiteStock = candidates.some(candidate => !candidate.infinite && candidate.stock !== undefined);
    assignOptional(product, "maneja_stock", finiteStock);
    if (hasVariants) {
      product.variants = candidates.filter(candidate => candidate.optionValues.length > 0).map(candidate => {
        const price = typeof candidate.promo === "number" && typeof candidate.price === "number"
          && candidate.promo > 0 && candidate.promo < candidate.price ? candidate.promo : candidate.price;
        const provided = [
          "variant_type",
          ...(candidate.sku ? ["sku"] : []), ...(candidate.barcode ? ["barcode"] : []),
          ...(price !== undefined ? ["price_override"] : []),
          ...(candidate.stock !== undefined ? ["stock"] : []),
        ];
        return {
          external_key: candidate.externalKey,
          name: candidate.optionValues.join(" / "),
          variant_type: optionNames.join(" / ") || "variante",
          ...(candidate.sku ? { sku: candidate.sku } : {}),
          ...(candidate.barcode ? { barcode: candidate.barcode } : {}),
          ...(price !== undefined ? { price_override: price } : {}),
          ...(candidate.stock !== undefined ? { stock: candidate.stock } : {}),
          provided,
        };
      });
      const stocks = product.variants.map(variant => parseImportNumber(variant.stock)).filter((stock): stock is number => stock !== null);
      if (stocks.length) assignOptional(product, "stock", stocks.reduce((sum, stock) => sum + stock, 0));
    } else {
      assignOptional(product, "sku", first?.sku);
      assignOptional(product, "barcode", first?.barcode);
      assignOptional(product, "stock", first?.stock);
    }
    products.push(product);
  }
  return products;
}

export function detectCatalogMigrationSource(rows: RawRow[], filename = ""): CatalogMigrationSource {
  const headers = new Set(rows.flatMap(row => Object.keys(row).map(normalizeImportHeader)));
  if ((headers.has("url handle") || headers.has("handle")) && headers.has("title")) return "shopify";
  if (headers.has("identificador de url") || headers.has("nombre de propiedad 1")) return "tiendanube";
  if (normalizeImportHeader(filename).includes("empretienda")) return "empretienda";
  if (headers.has("precio venta ars") || headers.has("costo usd")) return "nerqia";
  return "generic";
}

export function parseCatalogMigrationRows(rows: RawRow[], filename = ""): CatalogMigrationParseResult {
  const source = detectCatalogMigrationSource(rows, filename);
  const indexed = rows.map(indexRow);
  const products: CatalogMigrationProduct[] = source === "shopify"
    ? parseShopify(indexed)
    : source === "tiendanube"
      ? parseTiendanube(indexed)
      : rows.map(buildProductImportRow);
  const variantCount = products.reduce((sum, product) => sum + (product.variants?.length ?? 0), 0);
  const imageCount = products.reduce((sum, product) => sum + (product.image_urls?.length ?? 0), 0);
  const redirectCount = products.filter(product => product.source_path).length;
  const warnings: string[] = [];
  if (source === "tiendanube" && imageCount === 0) {
    warnings.push("El export estándar de Tiendanube no incluye imágenes; podés agregarlas después sin perder el resto del catálogo.");
  }
  if (source === "empretienda") {
    warnings.push("Empretienda fue detectada por el nombre del archivo; revisá el mapeo antes de aprobar porque su plantilla pública no documenta todas las columnas.");
  }
  if (products.some(product => !product.external_key) && (source === "shopify" || source === "tiendanube")) {
    warnings.push("Hay productos sin identificador URL; podrán crearse, pero no conservarán identidad ni redirect de origen.");
  }
  return { source, products, sourceRows: rows.length, variantCount, imageCount, redirectCount, warnings };
}
