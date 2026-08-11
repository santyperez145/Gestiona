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

// ── B10 — tolerancia a errores de tipeo ─────────────────────────────────────
//
// El buscador de la tienda exige que los términos coincidan, así que "lataffa"
// no encuentra nada teniendo 30 productos Lattafa. Y no encuentra nada de la
// peor forma posible: la tienda muestra "sin resultados" y el comprador
// concluye que no lo tenemos.
//
// La regla que ya estaba escrita arriba se mantiene y esto la completa:
// **primero literal, y sólo si no hay ninguna se cae a lo aproximado.** Nunca
// se mezclan, porque un resultado difuso arriba de uno exacto es peor que no
// tener difuso.

/**
 * Distancia de edición con transposiciones (Damerau-Levenshtein).
 *
 * La transposición importa más de lo que parece: los errores de tipeo reales
 * son en su mayoría dos letras cambiadas de lugar —"lattafa" → "lataffa",
 * "perfmue"— y contarlas como dos operaciones en vez de una obliga a subir el
 * umbral, que es justo lo que trae basura.
 *
 * Corta apenas se pasa del máximo: no interesa saber si la distancia es 8 o 9.
 */
export function distanciaEdicion(a: string, b: string, maximo = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previa: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let anterior: number[] = [];

  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let mejorDeLaFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(fila[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      // Transposición: "ab" → "ba" cuesta 1, no 2.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, anterior[j - 2] + 1);
      }
      fila.push(v);
      if (v < mejorDeLaFila) mejorDeLaFila = v;
    }
    if (mejorDeLaFila > maximo) return maximo + 1;
    anterior = previa;
    previa = fila;
  }
  return previa[b.length];
}

/**
 * Cuántos errores se le toleran a un término según su largo.
 *
 * No es una constante a propósito. Con tolerancia fija de 1, "oud" matchearía
 * "sud", "sur" y "out"; con 0 para todo, no sirve de nada. Un término corto no
 * tiene margen porque casi cualquier cambio lo convierte en otra palabra.
 */
export function toleranciaDe(termino: string): number {
  if (termino.length <= 3) return 0;
  if (termino.length <= 6) return 1;
  return 2;
}

/**
 * ¿Alguna palabra del texto se parece lo suficiente al término?
 *
 * Se compara **palabra por palabra** y no contra el texto entero: la distancia
 * de "lataffa" a "LATTAFA ASAD ZANZIBAR" completo es enorme, aunque contra
 * "lattafa" sea 2.
 *
 * También cuenta como parecido que la palabra **empiece** con el término, para
 * que siga funcionando mientras se escribe.
 */
export function tokenAproxima(haystack: string, termino: string): boolean {
  if (!termino) return true;
  const hay = normalizeText(haystack);
  if (hay.includes(termino)) return true;

  const tol = toleranciaDe(termino);
  if (tol === 0) return false;

  return hay.split(/[^a-z0-9]+/).filter(Boolean).some(palabra => {
    if (palabra.startsWith(termino)) return true;
    return distanciaEdicion(palabra, termino, tol) <= tol;
  });
}

/** ¿El texto se parece a TODOS los términos? Mismo criterio que el literal. */
export function matchesAllTokensAprox(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every(t => tokenAproxima(haystack, t));
}
