/**
 * Vistos recientemente por tienda — sólo en el navegador.
 *
 * No es un warehouse de PII: no se manda al servidor. Cada slug tiene su lista
 * para que dos tiendas en el mismo browser no se mezclen.
 */

export interface RecentView {
  productId: string;
  viewedAt: number;
}

export const RECENTLY_VIEWED_PREFIX = "gestiona:recently-viewed:";
export const RECENTLY_VIEWED_MAX = 12;

function storageKey(storeSlug: string): string {
  return `${RECENTLY_VIEWED_PREFIX}${storeSlug}`;
}

function readRaw(store: Storage | undefined, key: string): RecentView[] {
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentView =>
        !!x && typeof x === "object"
        && typeof (x as RecentView).productId === "string"
        && typeof (x as RecentView).viewedAt === "number")
      .slice(0, RECENTLY_VIEWED_MAX);
  } catch {
    return [];
  }
}

function writeRaw(store: Storage | undefined, key: string, views: RecentView[]): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(views.slice(0, RECENTLY_VIEWED_MAX)));
  } catch {
    // Quota / private mode: fallar en silencio; la home sigue sin el rail.
  }
}

/** Lista ordenada (más reciente primero). */
export function listRecentlyViewed(
  storeSlug: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): RecentView[] {
  if (!storeSlug) return [];
  return readRaw(storage, storageKey(storeSlug));
}

/** Registra una vista; mueve al frente si ya estaba. */
export function recordView(
  storeSlug: string,
  productId: string,
  opts: {
    now?: number;
    max?: number;
    storage?: Storage;
  } = {},
): RecentView[] {
  const {
    now = Date.now(),
    max = RECENTLY_VIEWED_MAX,
    storage = typeof localStorage !== "undefined" ? localStorage : undefined,
  } = opts;
  if (!storeSlug || !productId) return [];

  const key = storageKey(storeSlug);
  const prev = readRaw(storage, key).filter(v => v.productId !== productId);
  const next = [{ productId, viewedAt: now }, ...prev].slice(0, max);
  writeRaw(storage, key, next);
  return next;
}

/** Ids en orden, cruzables con el catálogo ya cargado. */
export function recentlyViewedIds(
  storeSlug: string,
  storage?: Storage,
): string[] {
  return listRecentlyViewed(storeSlug, storage).map(v => v.productId);
}

/** Productos del catálogo que coinciden con vistos, preservando orden. */
export function productsFromRecentlyViewed<T extends { id: string }>(
  storeSlug: string,
  catalog: T[],
  opts: { limit?: number; excludeId?: string; storage?: Storage } = {},
): T[] {
  const { limit = 8, excludeId, storage } = opts;
  const byId = new Map(catalog.map(p => [p.id, p]));
  const out: T[] = [];
  for (const id of recentlyViewedIds(storeSlug, storage)) {
    if (id === excludeId) continue;
    const p = byId.get(id);
    if (!p) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
