export interface StoreCartReference {
  product_id: string;
  variant_id: string | null;
  quantity: number;
}

export interface StoreCartCatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  stock: number;
  image_url: string | null;
}

export interface StoreCartCatalogVariant {
  id: string;
  variant_name: string;
  stock: number;
  price_override: number | null;
  image_url: string | null;
}

export interface RebuiltStoreCartLine {
  productId: string;
  variantId: string | null;
  name: string;
  brand: string | null;
  price: number;
  qty: number;
  image: string | null;
  stock: number;
}

const referenceKey = (item: Pick<StoreCartReference, "product_id" | "variant_id">) =>
  item.variant_id ? `${item.product_id}::${item.variant_id}` : item.product_id;

function positiveQuantity(value: unknown): number | null {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  return Math.min(quantity, 999);
}

/**
 * Lee sólo identidad y cantidad. Precio, nombre y stock de snapshots viejos no
 * son autoridad: se reconstruyen contra el catálogo vigente.
 */
export function parseStoreCartReferences(value: unknown): StoreCartReference[] {
  if (!Array.isArray(value)) return [];

  const references = new Map<string, StoreCartReference>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const productId = typeof item.product_id === "string" ? item.product_id.trim() : "";
    const variantId = typeof item.variant_id === "string" && item.variant_id.trim()
      ? item.variant_id.trim()
      : null;
    const quantity = positiveQuantity(item.quantity ?? item.qty);
    if (!productId || quantity === null) continue;

    const reference = { product_id: productId, variant_id: variantId, quantity };
    const key = referenceKey(reference);
    const previous = references.get(key);
    references.set(key, previous
      ? { ...reference, quantity: Math.max(previous.quantity, quantity) }
      : reference);
  }
  return [...references.values()];
}

export function storeCartReferencesFromLines(
  lines: Array<{ productId: string; variantId?: string | null; qty: number }>,
): StoreCartReference[] {
  return parseStoreCartReferences(lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId ?? null,
    quantity: line.qty,
  })));
}

/**
 * Al iniciar sesión pueden coexistir el carrito anónimo del dispositivo y el
 * último de la cuenta. Se conserva la mayor cantidad por línea: sumar ambas
 * podría duplicar una compra sin intención del comprador.
 */
export function mergeStoreCartReferences(
  ...groups: StoreCartReference[][]
): StoreCartReference[] {
  return parseStoreCartReferences(groups.flat());
}

export function rebuildStoreCart<TProduct extends StoreCartCatalogProduct>(
  references: StoreCartReference[],
  products: TProduct[],
  variantsByProduct: Record<string, StoreCartCatalogVariant[]>,
  priceOf: (product: TProduct) => number,
): { lines: RebuiltStoreCartLine[]; unavailableCount: number; adjustedCount: number } {
  const lines: RebuiltStoreCartLine[] = [];
  let unavailableCount = 0;
  let adjustedCount = 0;

  for (const reference of parseStoreCartReferences(references)) {
    const product = products.find((candidate) => candidate.id === reference.product_id);
    if (!product) {
      unavailableCount += 1;
      continue;
    }

    const variant = reference.variant_id
      ? variantsByProduct[product.id]?.find((candidate) => candidate.id === reference.variant_id)
      : null;
    if (reference.variant_id && !variant) {
      unavailableCount += 1;
      continue;
    }

    const stock = Number(variant?.stock ?? product.stock) || 0;
    if (stock < 1) {
      unavailableCount += 1;
      continue;
    }

    const quantity = Math.min(reference.quantity, stock);
    if (quantity !== reference.quantity) adjustedCount += 1;
    const variantPrice = Number(variant?.price_override);

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: variant ? `${product.name} — ${variant.variant_name}` : product.name,
      brand: product.brand,
      price: variant && variantPrice > 0 ? variantPrice : priceOf(product),
      qty: quantity,
      image: variant?.image_url ?? product.image_url,
      stock,
    });
  }

  return { lines, unavailableCount, adjustedCount };
}
