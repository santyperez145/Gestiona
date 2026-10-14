interface StoreCatalogRequest {
  supabaseUrl: string;
  supabaseKey: string;
  slug: string;
  select: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
}

interface StoreCatalogResult<T> {
  data: T[] | null;
  status: number;
  error?: string;
}

/**
 * Reads the public catalog through the slug-aware RPC. Edge handlers must not
 * query the legacy organization view because one organization can own several
 * stores with different assortments and prices.
 */
export async function fetchStoreCatalog<T>({
  supabaseUrl,
  supabaseKey,
  slug,
  select,
  filters = {},
  order,
  limit = 5000,
}: StoreCatalogRequest): Promise<StoreCatalogResult<T>> {
  // Lectura completa (feed, sitemap): un solo JSON, sin el tope de 1.000 filas
  // de la API. Con filtros u orden propio se usa la lista de filas.
  if (Object.keys(filters).length === 0 && !order && limit >= 1000) {
    const completo = await fetchCatalogoCompleto<T>(supabaseUrl, supabaseKey, slug, select);
    if (completo) return completo;
  }
  const params = new URLSearchParams({ select, limit: String(limit) });
  if (order) params.set("order", order);
  for (const [key, value] of Object.entries(filters)) params.set(key, value);

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_store_catalog_products?${params.toString()}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_slug: slug }),
      },
    );
    if (!response.ok) {
      return {
        data: null,
        status: response.status,
        error: `get_store_catalog_products respondió HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return { data: null, status: 502, error: "El catálogo no devolvió una lista" };
    }
    return { data: payload as T[], status: response.status };
  } catch (error) {
    return {
      data: null,
      status: 503,
      error: error instanceof Error ? error.message : "No se pudo consultar el catálogo",
    };
  }
}

/** `get_store_catalog_completo`; null si la función todavía no existe (se usa la de filas). */
async function fetchCatalogoCompleto<T>(supabaseUrl: string, supabaseKey: string, slug: string, select: string): Promise<StoreCatalogResult<T> | null> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_store_catalog_completo`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (response.status === 404) return null;
    if (!response.ok) return { data: null, status: response.status, error: `get_store_catalog_completo respondió HTTP ${response.status}` };
    const payload = await response.json();
    if (!Array.isArray(payload)) return { data: null, status: 502, error: "El catálogo no devolvió una lista" };
    const columnas = select.split(",").map(c => c.trim()).filter(Boolean);
    const data = payload.map((fila: Record<string, unknown>) =>
      Object.fromEntries(columnas.map(c => [c, fila[c] ?? null]))) as T[];
    return { data, status: response.status };
  } catch (error) {
    return { data: null, status: 503, error: error instanceof Error ? error.message : "No se pudo consultar el catálogo" };
  }
}
