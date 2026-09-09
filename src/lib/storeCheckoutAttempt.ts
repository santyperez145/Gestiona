const ATTEMPT_PREFIX = "nerqia.store.checkout.attempt.";
const ATTEMPT_VERSION = 1;
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

export type StoreCheckoutAttemptPhase = "submitting" | "order_created";

export interface StoreCheckoutAttempt {
  version: typeof ATTEMPT_VERSION;
  slug: string;
  cartToken: string;
  fingerprint: string;
  idempotencyKey: string;
  phase: StoreCheckoutAttemptPhase;
  orderNumber: string | null;
  updatedAt: number;
}

export interface CreatedStoreOrder {
  orderNumber: string;
  replayed: boolean;
}

export function checkoutAttemptStorage(): Storage | null {
  try { return globalThis.localStorage; } catch { return null; }
}

function cleanPart(value: string) {
  return value.trim().toLowerCase();
}

export function storeCheckoutAttemptStorageKey(slug: string, cartToken: string) {
  return `${ATTEMPT_PREFIX}${encodeURIComponent(cleanPart(slug))}.${encodeURIComponent(cartToken.trim())}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/**
 * El storage conserva sólo un SHA-256 del payload. Nombre, email y domicilio
 * no quedan duplicados en localStorage para resolver la idempotencia.
 */
export async function storeCheckoutPayloadFingerprint(payload: unknown) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("El navegador no permite proteger este intento de compra");
  const encoded = new TextEncoder().encode(JSON.stringify(canonical(payload)));
  const digest = await subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function isAttempt(value: unknown): value is StoreCheckoutAttempt {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoreCheckoutAttempt>;
  return row.version === ATTEMPT_VERSION
    && typeof row.slug === "string"
    && typeof row.cartToken === "string"
    && typeof row.fingerprint === "string"
    && /^[a-f0-9]{64}$/.test(row.fingerprint)
    && typeof row.idempotencyKey === "string"
    && row.idempotencyKey.length > 0
    && (row.phase === "submitting" || row.phase === "order_created")
    && (row.phase === "submitting"
      ? row.orderNumber === null
      : typeof row.orderNumber === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(row.orderNumber))
    && typeof row.updatedAt === "number"
    && Number.isFinite(row.updatedAt);
}

export function readStoreCheckoutAttempt(
  storage: Storage | null,
  slug: string,
  cartToken: string,
  now = Date.now(),
) {
  const key = storeCheckoutAttemptStorageKey(slug, cartToken);
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isAttempt(parsed)
      || cleanPart(parsed.slug) !== cleanPart(slug)
      || parsed.cartToken !== cartToken.trim()
      || now - parsed.updatedAt > ATTEMPT_TTL_MS
      || parsed.updatedAt > now + 60_000) {
      if (raw) storage?.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function prepareStoreCheckoutAttempt(args: {
  storage: Storage | null;
  slug: string;
  cartToken: string;
  fingerprint: string;
  createKey: () => string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const current = readStoreCheckoutAttempt(args.storage, args.slug, args.cartToken, now);
  // Until the server confirms or rejects the request, changing the payload
  // must not silently create a second order after a lost response.
  if (current) return current;

  const attempt: StoreCheckoutAttempt = {
    version: ATTEMPT_VERSION,
    slug: cleanPart(args.slug),
    cartToken: args.cartToken.trim(),
    fingerprint: args.fingerprint,
    idempotencyKey: args.createKey(),
    phase: "submitting",
    orderNumber: null,
    updatedAt: now,
  };
  try {
    args.storage?.setItem(storeCheckoutAttemptStorageKey(args.slug, args.cartToken), JSON.stringify(attempt));
  } catch {
    // In-memory retries still use the same server-side idempotency key.
  }
  return attempt;
}

export function markStoreCheckoutOrderCreated(
  storage: Storage | null,
  attempt: StoreCheckoutAttempt,
  orderNumber: string,
  now = Date.now(),
) {
  const current = readStoreCheckoutAttempt(storage, attempt.slug, attempt.cartToken, now);
  if (current && current.idempotencyKey !== attempt.idempotencyKey) return current;
  const completed: StoreCheckoutAttempt = {
    ...attempt,
    phase: "order_created",
    orderNumber: orderNumber.trim(),
    updatedAt: now,
  };
  try {
    storage?.setItem(
      storeCheckoutAttemptStorageKey(attempt.slug, attempt.cartToken),
      JSON.stringify(completed),
    );
  } catch {
    // El pedido ya existe; la pantalla de orden también permite verificar por email.
  }
  return completed;
}

export function clearStoreCheckoutAttemptForOrder(
  storage: Storage | null,
  slug: string,
  orderNumber: string,
) {
  const prefix = `${ATTEMPT_PREFIX}${encodeURIComponent(cleanPart(slug))}.`;
  const keys: string[] = [];
  if (!storage) return;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isAttempt(parsed) && parsed.orderNumber === orderNumber) storage.removeItem(key);
      } catch { /* One corrupt entry must not prevent cleanup of other entries. */ }
    }
  } catch {
    // Un navegador sin storage sigue pudiendo consultar el pedido.
  }
}

export function parseCreatedStoreOrder(value: unknown): CreatedStoreOrder | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const orderNumber = typeof record.order_number === "string" ? record.order_number.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(orderNumber)) return null;
  return {
    orderNumber,
    replayed: record.reintento === true || record.cart_replayed === true,
  };
}

export function discardStoreCheckoutAttempt(storage: Storage | null, slug: string, cartToken: string) {
  try { storage?.removeItem(storeCheckoutAttemptStorageKey(slug, cartToken)); } catch { /* privacy */ }
}
