// ── Motor de similitud de perfumes ──────────────────────────────────────────
// Recomendación determinística (sin costo de IA) basada en la ficha olfativa:
// familia + notas (salida/corazón/fondo) + género + duración + proyección.
// Usada por el modal recomendador (productos similares) y para sugerir
// perfumes a un cliente según sus preferencias olfativas.

export interface PerfumeDetail {
  product_id: string;
  familia_olfativa?: string | null;
  notas_salida?: string[] | null;
  notas_corazon?: string[] | null;
  notas_fondo?: string[] | null;
  duracion?: string | null;
  proyeccion?: string | null;
}

const DURACION_ORDER = ["corta", "moderada", "larga", "muy_larga"];
const PROYECCION_ORDER = ["intima", "moderada", "fuerte", "enorme"];

function allNotes(d?: PerfumeDetail | null): Set<string> {
  if (!d) return new Set();
  return new Set([...(d.notas_salida || []), ...(d.notas_corazon || []), ...(d.notas_fondo || [])]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  a.forEach(v => { if (b.has(v)) inter++; });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function ordinalProximity(a: string | null | undefined, b: string | null | undefined, order: string[]): number {
  if (!a || !b) return 0;
  const ia = order.indexOf(a), ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  const dist = Math.abs(ia - ib);
  return 1 - dist / (order.length - 1); // 1 = idéntico, 0 = extremos opuestos
}

/**
 * Puntúa la similitud olfativa entre dos fichas (0–100).
 * Pesos: notas 50%, familia 30%, duración 10%, proyección 10%.
 */
export function scoreSimilarity(a: PerfumeDetail, b: PerfumeDetail): number {
  const notesScore = jaccard(allNotes(a), allNotes(b)); // 0–1
  const familiaScore = a.familia_olfativa && b.familia_olfativa && a.familia_olfativa === b.familia_olfativa ? 1 : 0;
  const durScore = ordinalProximity(a.duracion, b.duracion, DURACION_ORDER);
  const proyScore = ordinalProximity(a.proyeccion, b.proyeccion, PROYECCION_ORDER);
  const score = notesScore * 0.5 + familiaScore * 0.3 + durScore * 0.1 + proyScore * 0.1;
  return Math.round(score * 100);
}

export interface SimilarResult<P> {
  product: P;
  detail: PerfumeDetail;
  score: number;
}

/**
 * Devuelve los productos más similares a `target` (excluye el propio),
 * ordenados por score descendente, con un mínimo de similitud.
 */
export function recommendSimilar<P extends { id: string }>(
  targetProductId: string,
  products: P[],
  detailsById: Record<string, PerfumeDetail>,
  opts: { limit?: number; minScore?: number } = {},
): SimilarResult<P>[] {
  const { limit = 6, minScore = 15 } = opts;
  const target = detailsById[targetProductId];
  if (!target) return [];
  return products
    .filter(p => p.id !== targetProductId && detailsById[p.id])
    .map(p => ({ product: p, detail: detailsById[p.id], score: scoreSimilarity(target, detailsById[p.id]) }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Recomienda perfumes que matcheen las preferencias de notas de un cliente.
 * `prefs` = array de notas (mismos values que la taxonomía).
 */
export function recommendForPreferences<P extends { id: string }>(
  prefs: string[],
  products: P[],
  detailsById: Record<string, PerfumeDetail>,
  opts: { limit?: number; minScore?: number } = {},
): SimilarResult<P>[] {
  const { limit = 6, minScore = 10 } = opts;
  if (!prefs || prefs.length === 0) return [];
  const prefSet = new Set(prefs);
  return products
    .filter(p => detailsById[p.id])
    .map(p => {
      const notes = allNotes(detailsById[p.id]);
      const score = Math.round(jaccard(prefSet, notes) * 100);
      return { product: p, detail: detailsById[p.id], score };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
