/**
 * Atribución first-party de la tienda.
 *
 * El navegador sólo conserva una capacidad aleatoria durante 30 minutos. La
 * base recibe UTM y hostname referente minimizados; nunca la URL completa, IP,
 * user-agent, email ni parámetros ajenos a la campaña.
 */

export const STORE_VISIT_WINDOW_MS = 30 * 60 * 1_000;

export type StoreVisitAttribution = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer_host: string | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function clean(value: string | null, max: number, lower = false): string | null {
  const normalized = Array.from(value ?? '')
    .filter(character => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  if (!normalized) return null;
  const clipped = normalized.slice(0, max);
  return lower ? clipped.toLocaleLowerCase('en-US') : clipped;
}

function hostnameOf(value: string): string | null {
  if (!value) return null;
  try {
    return clean(new URL(value).hostname, 253, true);
  } catch {
    return null;
  }
}

function isNerqiaHost(host: string): boolean {
  return host === 'nerqia.app' || host.endsWith('.nerqia.app');
}

/** Primera interacción observable; las UTM no se reconstruyen ni se adivinan. */
export function storeVisitAttribution(input: {
  search: string;
  referrer: string;
  currentHostname: string;
}): StoreVisitAttribution {
  const params = new URLSearchParams(input.search);
  const current = clean(input.currentHostname, 253, true) ?? '';
  const referred = hostnameOf(input.referrer);
  const isInternal = referred !== null && (
    referred === current || (isNerqiaHost(referred) && isNerqiaHost(current))
  );

  return {
    utm_source: clean(params.get('utm_source'), 100, true),
    utm_medium: clean(params.get('utm_medium'), 100, true),
    utm_campaign: clean(params.get('utm_campaign'), 160),
    referrer_host: isInternal ? null : referred,
  };
}

function keyFor(slug: string): string {
  return `nerqia.store.visit.${encodeURIComponent(slug.trim().toLocaleLowerCase('en-US'))}`;
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 32
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Reutiliza una visita durante 30 minutos de actividad. El carrito usa otro
 * token y otra duración: mezclar esas dos vidas fue el origen del dato falso.
 */
export function storeVisitToken(input: {
  storage: StorageLike | null;
  slug: string;
  now: number;
  createToken: () => string;
}): string {
  const storageKey = keyFor(input.slug);
  let token = '';

  if (input.storage) {
    try {
      const raw = input.storage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) as { token?: unknown; lastSeen?: unknown } : null;
      const lastSeen = Number(parsed?.lastSeen);
      if (
        validToken(parsed?.token)
        && Number.isFinite(lastSeen)
        && input.now >= lastSeen
        && input.now - lastSeen < STORE_VISIT_WINDOW_MS
      ) {
        token = parsed.token;
      }
    } catch {
      token = '';
    }
  }

  if (!token) token = input.createToken();
  if (!validToken(token)) throw new Error('El generador devolvió una capacidad de visita inválida');

  if (input.storage) {
    try {
      input.storage.setItem(storageKey, JSON.stringify({ token, lastSeen: input.now }));
    } catch {
      // La visita sigue funcionando en memoria aunque el navegador bloquee storage.
    }
  }
  return token;
}
