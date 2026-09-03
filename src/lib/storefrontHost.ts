import { BRAND_DOMAIN } from './brand.js';
import { isPotentialCustomStoreHostname, normalizeCustomStoreDomain } from './storeCustomDomain.js';

/** Hosts propios de Nerqia que nunca pueden convertirse en una tienda. */
export const RESERVED_NERQIA_SUBDOMAINS = [
  'www', 'app', 'api', 'admin', 'platform', 'finance', 'auth', 'docs', 'help',
  'status', 'soporte', 'mail', 'cdn', 'assets', 'developer',
] as const;

const RESERVED = new Set<string>(RESERVED_NERQIA_SUBDOMAINS);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

export function isValidStoreSubdomain(value: string): boolean {
  const slug = value.trim().toLowerCase();
  return DNS_LABEL.test(slug) && !RESERVED.has(slug);
}

/**
 * Resuelve sólo el wildcard controlado por Nerqia. Los dominios propios se
 * resolverán contra una tabla/RPC pública mínima; nunca se adivinan por host.
 */
export function storeSlugFromHostname(
  hostname: string,
  platformDomain = BRAND_DOMAIN,
): string | null {
  const host = normalizeHostname(hostname);
  const domain = normalizeHostname(platformDomain);
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return null;

  const slug = host.slice(0, -suffix.length);
  if (slug.includes('.') || !isValidStoreSubdomain(slug)) return null;
  return slug;
}

/** Prefijo interno único: vacío en slug.nerqia.app, heredado en host compartido. */
export function storefrontBasePath(slug: string, hostname?: string | null): string {
  const cleanSlug = slug.trim().toLowerCase();
  return hostname && storeSlugFromHostname(hostname) === cleanSlug
    ? ''
    : `/tienda/${encodeURIComponent(cleanSlug)}`;
}

export function storefrontHomePath(basePath: string): string {
  return basePath || '/';
}

/** Captura de Vercel como fallback; el hostname original sigue siendo autoridad. */
export function hostedStoreSlugFromUrl(url: URL): string | null {
  const fromHost = storeSlugFromHostname(url.hostname);
  if (fromHost) return fromHost;
  const fromRewrite = url.searchParams.get('hostSlug')?.trim().toLowerCase() ?? '';
  return isValidStoreSubdomain(fromRewrite) ? fromRewrite : null;
}

/** Origen público aun si Vercel expone el destino interno del rewrite. */
export function hostedStoreOrigin(url: URL, hostedSlug: string | null): string {
  const requestOrigin = `${url.protocol}//${url.host}`;
  if (!hostedSlug) return requestOrigin;
  return storeSlugFromHostname(url.hostname) === hostedSlug
    ? requestOrigin
    : `${url.protocol}//${hostedSlug}.${BRAND_DOMAIN}`;
}

export interface HostedStoreResolution {
  slug: string | null;
  customDomain: boolean;
  hostname: string | null;
}

/**
 * Complementa el wildcard con una consulta pública mínima para dominios
 * propios. El callback decide cómo hablar con Supabase; este módulo nunca
 * conoce credenciales ni tablas internas.
 */
export async function resolveHostedStoreRequest(
  url: URL,
  lookupCustomHost: (hostname: string) => Promise<string | null>,
): Promise<HostedStoreResolution> {
  const hostedSlug = hostedStoreSlugFromUrl(url);
  if (hostedSlug) return { slug: hostedSlug, customDomain: false, hostname: null };

  const candidate = normalizeCustomStoreDomain(
    url.searchParams.get('customHost') ?? url.hostname,
  );
  if (!isPotentialCustomStoreHostname(candidate)) {
    return { slug: null, customDomain: false, hostname: null };
  }

  const slug = await lookupCustomHost(candidate);
  return { slug, customDomain: true, hostname: candidate };
}

export function resolvedStoreOrigin(url: URL, resolution: HostedStoreResolution): string {
  if (resolution.customDomain && resolution.hostname) {
    return `${url.protocol}//${resolution.hostname}`;
  }
  return hostedStoreOrigin(url, resolution.slug);
}

export async function lookupStoreSlugByHost(input: {
  hostname: string;
  supabaseUrl: string;
  supabaseKey: string;
  fetcher?: typeof fetch;
}): Promise<string | null> {
  if (!input.supabaseUrl || !input.supabaseKey) {
    throw new Error('Falta configurar la fuente pública del storefront');
  }
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${input.supabaseUrl}/rest/v1/rpc/get_store_slug_by_host`, {
    method: 'POST',
    headers: {
      apikey: input.supabaseKey,
      Authorization: `Bearer ${input.supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_host: input.hostname }),
  });
  if (!response.ok) {
    throw new Error(`No se pudo resolver el host público (HTTP ${response.status})`);
  }
  const data = await response.json();
  return typeof data === 'string' && data.trim() ? data.trim().toLowerCase() : null;
}

export function publicStoreBaseUrl(origin: string, slug: string, hosted: boolean): string {
  return hosted ? origin : `${origin}/tienda/${encodeURIComponent(slug)}`;
}

/**
 * URL que comparte Business. Sólo migra a subdominio si el origin pertenece
 * a Nerqia y el slug es un label DNS válido; previews/localhost conservan el
 * path para que la verificación local siga siendo posible.
 */
export function hostedStoreUrl(origin: string, slug: string): string | null {
  const cleanSlug = slug.trim().toLowerCase();
  if (!isValidStoreSubdomain(cleanSlug)) return null;

  try {
    const url = new URL(origin);
    const host = normalizeHostname(url.hostname);
    if (host === BRAND_DOMAIN || host === `www.${BRAND_DOMAIN}` || host === `app.${BRAND_DOMAIN}`) {
      return `${url.protocol}//${cleanSlug}.${BRAND_DOMAIN}`;
    }
  } catch {
    return null;
  }
  return null;
}
