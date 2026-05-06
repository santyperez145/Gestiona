import * as Sentry from "@sentry/react";
import { getOptionalEnv } from "./env";

export function initSentry() {
  const dsn = getOptionalEnv("VITE_SENTRY_DSN");
  if (!dsn) return; // skip in local dev without DSN configured

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: getOptionalEnv("VITE_APP_VERSION"),
    // Only sample a fraction in production to keep quota low
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    // Replay 10% of sessions, 100% of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Don't report ResizeObserver loop errors (browser quirk, not a real error)
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
    beforeSend(event) {
      // Strip auth tokens from URLs before sending
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/access_token=[^&]+/, "access_token=REDACTED");
      }
      return event;
    },
  });
}

// Re-export Sentry utilities for use across the app
export { Sentry };
