// ── Búsqueda de texto para listados (productos, clientes, etc.) ─────────────
// El buscador anterior usaba solo fuzzy (Fuse) con un umbral permisivo, así
// que traía resultados que no coincidían con lo escrito. La regla ahora es:
// primero coincidencia literal (todos los términos), y recién si no hay
// ninguna se cae a la búsqueda difusa que tolera errores de tipeo.

/** Pasa a minúsculas y saca tildes: "Ámbar Óud" → "ambar oud". */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Parte la consulta en términos normalizados, sin vacíos. */
export function queryTokens(query: string | null | undefined): string[] {
  return normalizeText(query).trim().split(/\s+/).filter(Boolean);
}

/**
 * ¿El texto contiene TODOS los términos de la consulta?
 * Buscar "lattafa khamrah" solo matchea si aparecen ambos.
 */
export function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeText(haystack);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Filtra por coincidencia literal sobre los campos indicados.
 * Devuelve [] si no hay ninguna (ahí conviene caer al fuzzy).
 */
export function literalFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | null | undefined>,
): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  return items.filter((it) => matchesAllTokens(getFields(it).join(" "), tokens));
}
