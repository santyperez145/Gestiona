/**
 * Colecciones de la tienda (surtido por canal).
 *
 * Shopify/Tiendanube permiten excluir productos, fijar precios contextuales y
 * organizar el catálogo en colecciones. Nerqia las traduce como un overlay del
 * canal sobre el producto: la colección decide qué se muestra y en qué orden,
 * pero el producto, stock y precio siguen siendo una única fuente.
 *
 * Todo acá es puro y está testeado: no inventa stock, precio, margen ni cliente.
 */

export interface StoreCollection {
  id: string;
  store_slug: string;
  name: string;
  slug: string;
  description: string | null;
  product_ids: string[];
  cover_image_url: string | null;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCollectionInput {
  name: string;
  slug?: string;
  description?: string;
  product_ids?: string[];
  cover_image_url?: string;
  is_published?: boolean;
}

export interface UpdateCollectionInput {
  id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  product_ids?: string[];
  cover_image_url?: string | null;
  is_published?: boolean;
  sort_order?: number;
}

/** Slug seguro: minúsculas, guiones, sin acentos, sin espacios. */
export function slugifyCollection(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function listStoreCollections(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown[] | null; error: unknown }> },
  slug: string,
  options: { publishedOnly?: boolean } = {},
): Promise<StoreCollection[]> {
  const { data, error } = await supabase.rpc("list_store_collections", {
    p_slug: slug,
    p_published_only: options.publishedOnly ?? true,
  });
  if (error) throw error;
  return (data ?? []) as unknown as StoreCollection[];
}

export async function createStoreCollection(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  slug: string,
  input: CreateCollectionInput,
): Promise<StoreCollection> {
  const { data, error } = await supabase.rpc("create_store_collection", {
    p_slug: slug,
    p_name: input.name,
    p_slug: slugifyCollection(input.slug ?? input.name),
    p_description: input.description ?? null,
    p_product_ids: input.product_ids ?? [],
    p_cover_image_url: input.cover_image_url ?? null,
    p_is_published: input.is_published ?? true,
  });
  if (error) throw error;
  return data as unknown as StoreCollection;
}

export async function updateStoreCollection(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  slug: string,
  input: UpdateCollectionInput,
): Promise<StoreCollection> {
  const { data, error } = await supabase.rpc("update_store_collection", {
    p_slug: slug,
    p_collection_id: input.id,
    p_name: input.name ?? null,
    p_slug: input.slug ? slugifyCollection(input.slug) : null,
    p_description: input.description ?? null,
    p_product_ids: input.product_ids ?? null,
    p_cover_image_url: input.cover_image_url ?? null,
    p_is_published: input.is_published ?? null,
    p_sort_order: input.sort_order ?? null,
  });
  if (error) throw error;
  return data as unknown as StoreCollection;
}

export async function deleteStoreCollection(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  slug: string,
  collectionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("delete_store_collection", {
    p_slug: slug,
    p_collection_id: collectionId,
  });
  if (error) throw error;
}