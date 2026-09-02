/**
 * Ranking de productos relacionados para la ficha pública.
 *
 * Combina coocurrencia (quién compra con quién), afinidad de marca/categoría,
 * ventas y stock. Un score de atributos opcional (p. ej. ficha olfativa cuando
 * el producto la tiene) puede sumar boost — **nunca** asume rubro: la tienda
 * sirve a cualquier comercio legal, no sólo perfumes o vapers.
 *
 * Puro y testeado: el storefront sólo aporta candidatos y scores.
 */

export interface RelatedCandidate {
  id: string;
  brand?: string | null;
  category?: string | null;
  stock?: number | null;
  total_sold?: number | null;
  /** false = servicio / no stockeable: no se penaliza por stock 0. */
  maneja_stock?: boolean | null;
}

export interface ScoreRelatedOptions<T extends RelatedCandidate> {
  seedId: string;
  seed: Pick<RelatedCandidate, "brand" | "category">;
  candidates: T[];
  /** product_id → fuerza de coocurrencia (count o score del RPC). */
  cooccurrenceScores?: Record<string, number>;
  /**
   * product_id → score 0–100 de afinidad por atributos del producto.
   * Ej.: perfumeMatch si hay notas; en otros rubros puede venir vacío o de
   * otro motor. No implica que la tienda sea de perfumería.
   */
  attributeScores?: Record<string, number>;
  /** @deprecated usar attributeScores */
  perfumeScores?: Record<string, number>;
  /** Preferir en stock cuando maneja_stock (default true). */
  preferInStock?: boolean;
  limit?: number;
  excludeIds?: Iterable<string>;
}

export interface RelatedScored<T extends RelatedCandidate> {
  product: T;
  score: number;
  reasons: string[];
}

/** Pesos relativos del score compuesto (suma ~100 en el caso ideal). */
export const RELATED_WEIGHTS = {
  cooccurrence: 50,
  sameBrand: 18,
  sameCategory: 14,
  totalSold: 10,
  /** Afinidad por atributos (olfativa u otra); opcional. */
  attribute: 12,
  outOfStockPenalty: 40,
} as const;

function maxCooc(scores: Record<string, number> | undefined): number {
  if (!scores) return 0;
  let m = 0;
  for (const v of Object.values(scores)) if (v > m) m = v;
  return m;
}

function soldCap(candidates: RelatedCandidate[]): number {
  let m = 0;
  for (const c of candidates) {
    const s = Number(c.total_sold) || 0;
    if (s > m) m = s;
  }
  return m || 1;
}

export function scoreRelatedProducts<T extends RelatedCandidate>(
  opts: ScoreRelatedOptions<T>,
): RelatedScored<T>[] {
  const {
    seedId,
    seed,
    candidates,
    cooccurrenceScores = {},
    preferInStock = true,
    limit = 8,
    excludeIds,
  } = opts;

  const attributeScores = opts.attributeScores ?? opts.perfumeScores ?? {};

  const excluded = new Set(excludeIds ?? []);
  excluded.add(seedId);

  const coocMax = maxCooc(cooccurrenceScores) || 1;
  const soldMax = soldCap(candidates);

  const ranked: RelatedScored<T>[] = [];

  for (const p of candidates) {
    if (excluded.has(p.id)) continue;

    let score = 0;
    const reasons: string[] = [];

    const cooc = Number(cooccurrenceScores[p.id]) || 0;
    if (cooc > 0) {
      const part = (cooc / coocMax) * RELATED_WEIGHTS.cooccurrence;
      score += part;
      reasons.push("cooccurrence");
    }

    if (seed.brand && p.brand && seed.brand === p.brand) {
      score += RELATED_WEIGHTS.sameBrand;
      reasons.push("brand");
    }

    if (seed.category && p.category && seed.category === p.category) {
      score += RELATED_WEIGHTS.sameCategory;
      reasons.push("category");
    }

    const sold = Number(p.total_sold) || 0;
    if (sold > 0) {
      score += (sold / soldMax) * RELATED_WEIGHTS.totalSold;
      reasons.push("sold");
    }

    const affinity = Number(attributeScores[p.id]) || 0;
    if (affinity > 0) {
      score += (affinity / 100) * RELATED_WEIGHTS.attribute;
      reasons.push("affinity");
    }

    const maneja = p.maneja_stock !== false;
    const stock = Number(p.stock) || 0;
    if (preferInStock && maneja && stock <= 0) {
      score -= RELATED_WEIGHTS.outOfStockPenalty;
      reasons.push("oos");
    }

    if (score <= 0 && reasons.length === 0) continue;
    // Sin señales: no inventar ranking. Si sólo hay OOS penalty, tampoco.
    if (score <= 0 && !reasons.some(r => r !== "oos")) continue;

    ranked.push({ product: p, score, reasons });
  }

  ranked.sort((a, b) => b.score - a.score || (Number(b.product.total_sold) || 0) - (Number(a.product.total_sold) || 0));
  return ranked.slice(0, limit);
}

/**
 * Semillas desde pedidos del comprador: product_ids comprados, más recientes primero.
 * No cruza CRM del SaaS — sólo ítems del JSON de la orden de tienda.
 */
export function productIdsFromStoreOrders(
  orders: { items?: unknown; created_at?: string }[],
  opts: { limit?: number } = {},
): string[] {
  const { limit = 12 } = opts;
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...orders].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
  for (const o of sorted) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const raw of items) {
      const row = raw as { product_id?: string; productId?: string };
      const id = row.product_id || row.productId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Sugerencias "porque compraste": para cada semilla, toma top relacionados
 * excluyendo ya comprados y el carrito.
 */
export function suggestionsFromOrderSeeds<T extends RelatedCandidate>(
  seedIds: string[],
  catalog: T[],
  opts: {
    cooccurrenceScoresBySeed?: Record<string, Record<string, number>>;
    excludeIds?: Iterable<string>;
    limit?: number;
    preferInStock?: boolean;
  } = {},
): RelatedScored<T>[] {
  const { cooccurrenceScoresBySeed = {}, excludeIds, limit = 8, preferInStock = true } = opts;
  const exclude = new Set(excludeIds ?? []);
  for (const id of seedIds) exclude.add(id);

  const byId = new Map(catalog.map(p => [p.id, p]));
  const merged = new Map<string, RelatedScored<T>>();

  for (const seedId of seedIds) {
    const seed = byId.get(seedId);
    if (!seed) continue;
    const ranked = scoreRelatedProducts({
      seedId,
      seed,
      candidates: catalog,
      cooccurrenceScores: cooccurrenceScoresBySeed[seedId],
      preferInStock,
      excludeIds: exclude,
      limit: limit * 2,
    });
    for (const r of ranked) {
      const prev = merged.get(r.product.id);
      if (!prev || r.score > prev.score) merged.set(r.product.id, r);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
