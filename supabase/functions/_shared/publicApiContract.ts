/**
 * Contrato ejecutable de la API publica v1.
 *
 * La Edge Function, OpenAPI y los tests importan estas constantes para que la
 * version, los limites y la precision monetaria no diverjan entre tres copias.
 */
export const PUBLIC_API_PATH_VERSION = "v1";
export const PUBLIC_API_VERSION = "1";
export const PUBLIC_API_RELEASE = "2026-08-29";
// Se arma por segmentos para que el bundler de Edge no interprete la URL
// publica como un import absoluto del filesystem durante el deploy.
export const PUBLIC_API_OPENAPI_PATH = ["", "developer", "api", "openapi.json"].join("/");
export const PUBLIC_API_PUBLIC_ORIGIN = "https://nerqia.app";
export const PUBLIC_API_MAX_ARS = 999_999_999_999.99;
export const PUBLIC_API_MAX_USD = 99_999_999.9999;
export const PUBLIC_API_ARS_DECIMALS = 2;
export const PUBLIC_API_USD_DECIMALS = 4;
export const PUBLIC_API_MAX_INTEGER = 2_147_483_647;
export const PUBLIC_API_DEFAULT_PAGE_SIZE = 100;
export const PUBLIC_API_MAX_PAGE_SIZE = 500;

export type PublicApiRateLimit = {
  limit: number;
  remaining: number;
  resetAt: number;
};

export type PublicApiLifecycle = {
  deprecationAt?: number;
  sunsetAt?: Date;
  migrationUrl?: string;
};

/**
 * v1 esta activa. Cuando se anuncie una deprecacion, los tres campos se
 * completan juntos y todas las respuestas empiezan a comunicarla sin cambiar
 * la semantica del endpoint.
 */
export const PUBLIC_API_LIFECYCLE: Record<string, PublicApiLifecycle> = {
  [PUBLIC_API_PATH_VERSION]: {},
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function roundDecimal(value: unknown, decimals: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

/**
 * JSON no conserva el lexema original del numero. La tolerancia absorbe el
 * ruido binario de IEEE-754, pero rechaza una tercera/quinta cifra real.
 */
export function parsePublicDecimal(
  value: unknown,
  decimals: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return null;
  const factor = 10 ** decimals;
  if (Math.abs(value * factor - Math.round(value * factor)) > 1e-7) return null;
  return roundDecimal(value, decimals);
}

export function parsePageSize(
  raw: string | null,
  fallback = PUBLIC_API_DEFAULT_PAGE_SIZE,
  max = PUBLIC_API_MAX_PAGE_SIZE,
): number | null {
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : null;
}

export function publicApiHeaders(input: {
  requestId: string;
  origin: string;
  rateLimit?: PublicApiRateLimit;
  lifecycle?: PublicApiLifecycle;
  extra?: Record<string, string>;
}): Record<string, string> {
  const lifecycle = input.lifecycle ?? PUBLIC_API_LIFECYCLE[PUBLIC_API_PATH_VERSION];
  const links = [
    `<${input.origin}${PUBLIC_API_OPENAPI_PATH}>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
  ];
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Authorization",
    "X-API-Version": PUBLIC_API_VERSION,
    "X-Gestiona-API-Release": PUBLIC_API_RELEASE,
    "X-Request-Id": input.requestId,
  };

  if (input.rateLimit) {
    headers["X-RateLimit-Limit"] = String(input.rateLimit.limit);
    headers["X-RateLimit-Remaining"] = String(input.rateLimit.remaining);
    headers["X-RateLimit-Reset"] = String(input.rateLimit.resetAt);
  }
  if (lifecycle?.deprecationAt != null) {
    headers.Deprecation = `@${lifecycle.deprecationAt}`;
    if (lifecycle.migrationUrl) links.push(`<${lifecycle.migrationUrl}>; rel="deprecation"; type="text/html"`);
  }
  if (lifecycle?.sunsetAt) headers.Sunset = lifecycle.sunsetAt.toUTCString();
  headers.Link = links.join(", ");

  return { ...headers, ...(input.extra ?? {}) };
}
