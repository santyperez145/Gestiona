/**
 * Limpieza de lo que sale como telemetría: emails, tokens y parámetros
 * sensibles nunca viajan. Separado de sentry.ts (2026-10-31) para que el
 * registro de errores propio no arrastre Sentry (≈60 % del archivo de
 * arranque) a la carga inicial de cada pantalla.
 */
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_VALUE = /([?&](?:access_token|refresh_token|token|code|apikey|api_key|key)=)[^&#]*/gi;

export function redactTelemetryText(value: string): string {
  return value
    .replace(EMAIL, "[EMAIL_REDACTED]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(TOKEN_VALUE, "$1[REDACTED]");
}

export function sanitizeTelemetryUrl(value: string): string {
  try {
    const parsed = new URL(value, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return redactTelemetryText(value.split(/[?#]/, 1)[0]);
  }
}

export function sanitizeTelemetryValue(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/url|from|to/i.test(key)) return sanitizeTelemetryUrl(value);
    return redactTelemetryText(value);
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeTelemetryValue(entry));
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([field]) => !/cookie|authorization|password|passwd|secret|token|api.?key|request.?body/i.test(field))
      .map(([field, entry]) => [field, sanitizeTelemetryValue(entry, field)]),
  );
}
