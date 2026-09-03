/**
 * Persistencia del código de influencer en la tienda (?ref=).
 * El tag en notas alimenta `ecommerce_orders.referral_code` (trigger) y
 * al pagar se copia a `sales.referral_code` para la comisión automática.
 */
const keyOf = (slug: string) => `gestiona.store.ref.${slug.trim().toLowerCase()}`;

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code || code.length > 32) return null;
  if (!/^[A-Z0-9_-]+$/.test(code)) return null;
  return code;
}

/** Extrae el tag `[ref:CODE]` que el checkout deja en notas. */
export function extractReferralFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes ?? "").match(/\[ref:([A-Z0-9_-]+)\]/i);
  return normalizeReferralCode(m?.[1] ?? null);
}

export function captureStoreReferral(slug: string, search: string | URLSearchParams): string | null {
  const s = slug.trim();
  if (!s) return null;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const fromUrl = normalizeReferralCode(params.get("ref"));
  if (fromUrl) {
    try { sessionStorage.setItem(keyOf(s), fromUrl); } catch { /* private mode */ }
    return fromUrl;
  }
  try {
    return normalizeReferralCode(sessionStorage.getItem(keyOf(s)));
  } catch {
    return null;
  }
}

export function readStoreReferral(slug: string): string | null {
  try {
    return normalizeReferralCode(sessionStorage.getItem(keyOf(slug)));
  } catch {
    return null;
  }
}

/**
 * Deja el código en las notas del pedido. El trigger del Core lo asienta
 * en `ecommerce_orders.referral_code` y luego en la venta al pagar.
 */
export function notesWithStoreReferral(
  notes: string | null | undefined,
  referral: string | null | undefined,
): string | null {
  const base = String(notes ?? "").trim();
  const code = normalizeReferralCode(referral);
  if (!code) return base || null;
  const tag = `[ref:${code}]`;
  if (base.includes(tag)) return base;
  return base ? `${base}\n${tag}` : tag;
}
