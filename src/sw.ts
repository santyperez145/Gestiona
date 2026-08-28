/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Precaching ───────────────────────────────────────────────
cleanupOutdatedCaches();
// self.__WB_MANIFEST is replaced by workbox-build injectManifest at build time
precacheAndRoute(self.__WB_MANIFEST);

// ── Skip waiting immediately so new SW activates without manual trigger ──
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all open tabs immediately
  event.waitUntil(self.clients.claim());
});

// ── Also handle explicit SKIP_WAITING messages (legacy / manual) ──────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/**
 * ── Runtime caching — los chunks que el precache ya no trae ───────────────
 *
 * ⚠️ Hasta el 2026-08-28 el precache eran **8,2 MB**: el panel entero, y el
 * service worker se registra en toda página, así que un comprador que entraba
 * a la tienda bajaba 87 chunks del panel en segundo plano.
 *
 * Ahora el precache trae sólo el shell y el POS. El resto se guarda **la
 * primera vez que se abre**, con `StaleWhileRevalidate`: se sirve la copia al
 * instante y se refresca por atrás.
 *
 * 📌 Los nombres llevan hash, así que una versión nueva es otra URL y nunca se
 * sirve un chunk viejo por error. La expiración es para que el caché no crezca
 * sin techo entre deploys.
 */
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    url.pathname.startsWith("/assets/") &&
    (request.destination === "script" || request.destination === "style"),
  new StaleWhileRevalidate({
    cacheName: "app-chunks",
    plugins: [
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

// ── Runtime caching — Supabase REST ─────────────────────────
registerRoute(
  ({ url }) =>
    url.hostname.includes("supabase.co") && url.pathname.startsWith("/rest/"),
  new NetworkFirst({
    cacheName: "supabase-api",
    // 24 h y 200 entradas. Con los 5 minutos anteriores, una jornada en una
    // feria sin señal dejaba al POS sin catálogo. Al ser NetworkFirst, con
    // conexión siempre se sirve el dato fresco: el TTL solo define hasta
    // cuándo vale la copia de emergencia.
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 })],
  })
);

// ── Runtime caching — Supabase Storage ──────────────────────
registerRoute(
  ({ url }) =>
    url.hostname.includes("supabase.co") &&
    url.pathname.startsWith("/storage/"),
  new CacheFirst({
    cacheName: "supabase-storage",
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  })
);

// ── Push Notifications ───────────────────────────────────────
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? "Nueva notificación" };
  }

  const title = data.title ?? "Gestiona";
  // `renotify` es válido en la Web Notifications API pero todavía no está en
  // el tipo NotificationOptions del lib DOM de TS → se castea.
  const options = {
    body: data.body ?? "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag ?? "gestiona-push",
    renotify: true,
    data: { url: data.url ?? "/" },
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as any)?.url ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url === targetUrl && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
