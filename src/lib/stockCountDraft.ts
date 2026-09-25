/**
 * Borrador local de la toma física.
 *
 * Un conteo real toma horas: si el navegador se recarga, se corta la
 * conexión o el usuario cambia de pestaña, el progreso vivía sólo en
 * `useState` y se perdía. Este módulo persiste lo contado por dispositivo
 * y organización, y avisa cuando hay un conteo a medio terminar.
 *
 * El servidor (`stock_counts` + `registrar_conteo`) sigue siendo la única
 * autoridad: el borrador es conveniencia local, no segundo libro.
 */

export type StockCountDraftRow = {
  product_id: string;
  counted: string;
};

export type StockCountDraft = {
  /** Fecha ISO en la que se contó por última vez. */
  saved_at: string;
  rows: StockCountDraftRow[];
};

const KEY_PREFIX = "gestiona.stockcount.draft.";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function stockCountDraftKey(orgId: string | undefined | null): string {
  return `${KEY_PREFIX}${orgId || "default"}`;
}

function sanitizeRows(raw: unknown): StockCountDraftRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row): StockCountDraftRow | null => {
      if (typeof row !== "object" || row === null) return null;
      const record = row as Record<string, unknown>;
      const productId = typeof record.product_id === "string" ? record.product_id : null;
      const counted = typeof record.counted === "string" ? record.counted : null;
      if (!productId || counted === null) return null;
      return { product_id: productId, counted };
    })
    .filter((row): row is StockCountDraftRow => row !== null)
    .slice(0, 20_000);
}

export function loadStockCountDraft(orgId: string | undefined | null): StockCountDraft | null {
  const store = storage();
  if (!orgId || !store) return null;
  try {
    const raw = store.getItem(stockCountDraftKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const savedAt = typeof parsed.saved_at === "string" ? parsed.saved_at : null;
    const rows = sanitizeRows(parsed.rows);
    if (!savedAt || rows.length === 0) {
      store.removeItem(stockCountDraftKey(orgId));
      return null;
    }
    return { saved_at: savedAt ?? new Date().toISOString(), rows };
  } catch {
    // Borrador corrupto: se descarta, no bloquea una nueva toma.
    try { store.removeItem(stockCountDraftKey(orgId)); } catch { /* noop */ }
    return null;
  }
}

export function saveStockCountDraft(
  orgId: string | undefined | null,
  rows: readonly { product: { id: string }; counted: string }[],
): boolean {
  const store = typeof localStorage !== "undefined" ? (storage()) : null;
  if (!orgId || !store) return false;
  const pending = rows.filter(row => row.counted !== "");
  const draft: StockCountDraft = {
    saved_at: new Date().toISOString(),
    rows: pending.map(row => ({ product_id: row.product.id, counted: row.counted })),
  };
  try {
    if (pending.length === 0) {
      store.removeItem(stockCountDraftKey(orgId));
    } else {
      store.setItem(stockCountDraftKey(orgId), JSON.stringify(draft));
    }
    return true;
  } catch {
    return false;
  }
}

export function clearStockCountDraft(orgId: string | undefined | null): void {
  const store = storage();
  if (!orgId || !store) return;
  try { store.removeItem(stockCountDraftKey(orgId)); } catch { /* noop */ }
}