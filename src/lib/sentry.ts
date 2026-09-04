import * as Sentry from "@sentry/react";
import { getOptionalEnv } from "./env";

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

function sanitizeTelemetryValue(value: unknown, key = ""): unknown {
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

function minimizeEvent<T extends Sentry.Event>(event: T): T {
  event.user = undefined;
  if (event.request) {
    event.request.url = event.request.url ? sanitizeTelemetryUrl(event.request.url) : undefined;
    event.request.cookies = undefined;
    event.request.headers = undefined;
    event.request.data = undefined;
  }
  event.extra = sanitizeTelemetryValue(event.extra) as T["extra"];
  event.contexts = sanitizeTelemetryValue(event.contexts) as T["contexts"];
  event.tags = sanitizeTelemetryValue(event.tags) as T["tags"];
  event.breadcrumbs = event.breadcrumbs
    ?.filter((breadcrumb) => !/^(console|ui\.)/.test(breadcrumb.category ?? ""))
    .map((breadcrumb) => sanitizeTelemetryValue(breadcrumb) as typeof breadcrumb);
  if (event.message) event.message = redactTelemetryText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception?.value) exception.value = redactTelemetryText(exception.value);
  }
  return event;
}

export function initSentry() {
  const dsn = getOptionalEnv("VITE_SENTRY_DSN");
  if (!dsn) return; // skip in local dev without DSN configured

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: getOptionalEnv("VITE_APP_VERSION"),
    sendDefaultPii: false,
    // Diagnóstico proporcional sin convertir la operación del comercio en telemetría.
    tracesSampleRate: import.meta.env.PROD ? 0.05 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    // Don't report ResizeObserver loop errors (browser quirk, not a real error)
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
    beforeBreadcrumb(breadcrumb) {
      if (/^(console|ui\.)/.test(breadcrumb.category ?? "")) return null;
      return sanitizeTelemetryValue(breadcrumb) as typeof breadcrumb;
    },
    beforeSend: minimizeEvent,
    beforeSendTransaction: minimizeEvent,
  });
}

// Re-export Sentry utilities for use across the app
export { Sentry };
