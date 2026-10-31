import * as Sentry from "@sentry/react";
import { redactTelemetryText, sanitizeTelemetryUrl, sanitizeTelemetryValue } from "./telemetriaSegura";

// Las funciones de limpieza viven en telemetriaSegura.ts (livianas, sin Sentry):
// este módulo se carga en diferido (2026-10-31) y no puede estar en el arranque.
export { redactTelemetryText, sanitizeTelemetryUrl };

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
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined);
  if (!dsn) return; // skip in local dev without DSN configured

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined),
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

/** Lo que atrapa el ErrorBoundary de la app, si Sentry ya se inició. */
export function capturarExcepcion(error: unknown, componentStack?: string) {
  if (!Sentry.getClient()) return;
  Sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined);
}

// Re-export Sentry utilities for use across the app
export { Sentry };
