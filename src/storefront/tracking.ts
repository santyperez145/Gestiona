/**
 * Píxeles de seguimiento de la tienda.
 *
 * Sin esto no se puede publicitar: Meta Ads necesita el píxel para atribuir
 * una venta a un anuncio y para armar públicos similares; Google Analytics,
 * para saber de dónde viene el tráfico. Es lo primero que pide cualquiera que
 * invierte en publicidad, y por eso Tiendanube y Empretienda lo traen de
 * fábrica.
 *
 * Decisiones:
 *  - Los scripts se cargan **una sola vez** y sólo si la tienda tiene el ID
 *    configurado. Una vitrina sin píxel no paga el costo de red.
 *  - Todo es best-effort: un bloqueador de anuncios o una red caída no deben
 *    romper la compra. Cada llamada va dentro de try/catch.
 *  - No se envía información personal (nombre, email, dirección). Sólo qué
 *    producto se vio y cuánto salió: alcanza para optimizar campañas y evita
 *    mandar datos de clientes a terceros.
 */

interface TrackingIds {
  metaPixelId?: string | null;
  gaMeasurementId?: string | null;
  tiktokPixelId?: string | null;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    TiktokAnalyticsObject?: string;
    ttq?: TikTokPixelQueue;
  }
}

interface TikTokPixelQueue extends Array<unknown> {
  _u?: string;
  methods?: string[];
  setAndDefer?: (target: TikTokPixelQueue, method: string) => void;
  page: () => void;
  track: (event: string, properties?: unknown, options?: { event_id?: string }) => void;
  load: (id: string, options?: Record<string, unknown>) => void;
  instance?: (id: string) => TikTokPixelQueue;
  _i?: Record<string, TikTokPixelQueue>;
  _t?: Record<string, number>;
  _o?: Record<string, Record<string, unknown>>;
}

const metaIniciados = new Set<string>();
const gaIniciados = new Set<string>();
const tiktokIniciados = new Set<string>();

function cargarScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/**
 * Cola base oficial de TikTok escrita de forma legible y tipada. Cargar sólo
 * `events.js` no inicializa ningún pixel: hacen falta `ttq.load(id)` y la cola
 * que conserva PageView/eventos mientras llega el SDK.
 */
function prepararTikTok(): TikTokPixelQueue {
  if (window.ttq?.load) return window.ttq;

  const queue = [] as unknown as TikTokPixelQueue;
  const methods = [
    "page", "track", "identify", "instances", "debug", "on", "off", "once",
    "ready", "alias", "group", "enableCookie", "disableCookie",
  ];
  queue.methods = methods;
  queue.setAndDefer = (target, method) => {
    (target as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  methods.forEach(method => queue.setAndDefer?.(queue, method));
  queue.instance = (id) => {
    queue._i ??= {};
    const instance = queue._i[id] ?? ([] as unknown as TikTokPixelQueue);
    methods.forEach(method => queue.setAndDefer?.(instance, method));
    queue._i[id] = instance;
    return instance;
  };
  queue.load = (id, options = {}) => {
    queue._i ??= {};
    queue._t ??= {};
    queue._o ??= {};
    queue._i[id] ??= [] as unknown as TikTokPixelQueue;
    queue._i[id]._u = "https://analytics.tiktok.com/i18n/pixel/events.js";
    queue._t[id] = Date.now();
    queue._o[id] = options;
    cargarScript(
      `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`,
      `tiktok-pixel-src-${id}`,
    );
  };
  window.TiktokAnalyticsObject = "ttq";
  window.ttq = queue;
  return queue;
}

/** Inicializa los píxeles configurados. Repetir la llamada no hace nada. */
export function initTracking({ metaPixelId, gaMeasurementId, tiktokPixelId }: TrackingIds) {
  if (typeof window === "undefined") return;

  try {
    // ── Meta (Facebook / Instagram) ─────────────────────────────────────
    if (metaPixelId && !metaIniciados.has(metaPixelId)) {
      // Cola mínima de fbq: encola los eventos hasta que el script real carga.
      // Es la forma que documenta Meta, escrita sin los atajos del snippet
      // original para que pase el linter.
      const w = window as any;
      if (!w.fbq) {
        const fbq: any = function (...args: unknown[]) {
          if (fbq.callMethod) fbq.callMethod(...args);
          else fbq.queue.push(args);
        };
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = "2.0";
        fbq.queue = [];
        w.fbq = fbq;
        w._fbq = fbq;
        cargarScript("https://connect.facebook.net/en_US/fbevents.js", "meta-pixel-src");
      }
      window.fbq?.("init", metaPixelId);
      metaIniciados.add(metaPixelId);
    }

    // ── Google Analytics 4 ──────────────────────────────────────────────
    if (gaMeasurementId && !gaIniciados.has(gaMeasurementId)) {
      cargarScript(`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`, "ga4-src");
      window.dataLayer = window.dataLayer || [];
      window.gtag = function (...args: unknown[]) { window.dataLayer!.push(args); };
      window.gtag("js", new Date());
      // La ruta SPA emite el PageView una sola vez en `trackPageView`.
      window.gtag("config", gaMeasurementId, { send_page_view: false });
      gaIniciados.add(gaMeasurementId);
    }

    // ── TikTok ──────────────────────────────────────────────────────────
    if (tiktokPixelId && !tiktokIniciados.has(tiktokPixelId)) {
      const ttq = prepararTikTok();
      ttq.load(tiktokPixelId);
      tiktokIniciados.add(tiktokPixelId);
    }
  } catch {
    // Un bloqueador de anuncios no debe romper la tienda.
  }
}

/** Cambio de página en una SPA: los píxeles no lo detectan solos. */
export function trackPageView() {
  try {
    window.fbq?.("track", "PageView");
    window.gtag?.("event", "page_view", {
      page_location: window.location.href,
    });
    window.ttq?.page();
  } catch { /* best-effort */ }
}

export interface TrackedItem {
  id: string;
  name: string;
  price: number;
  quantity?: number;
}

export function trackViewItem(item: TrackedItem, currency = "ARS") {
  try {
    window.fbq?.("track", "ViewContent", {
      content_ids: [item.id], content_name: item.name,
      content_type: "product", value: item.price, currency,
    });
    window.gtag?.("event", "view_item", {
      currency, value: item.price,
      items: [{ item_id: item.id, item_name: item.name, price: item.price }],
    });
  } catch { /* best-effort */ }
}

export function trackAddToCart(item: TrackedItem, currency = "ARS") {
  try {
    const qty = item.quantity ?? 1;
    window.fbq?.("track", "AddToCart", {
      content_ids: [item.id], content_name: item.name,
      content_type: "product", value: item.price * qty, currency,
    });
    window.gtag?.("event", "add_to_cart", {
      currency, value: item.price * qty,
      items: [{ item_id: item.id, item_name: item.name, price: item.price, quantity: qty }],
    });
    window.ttq?.track("AddToCart", { content_id: item.id, value: item.price * qty, currency });
  } catch { /* best-effort */ }
}

export function trackBeginCheckout(items: TrackedItem[], total: number, currency = "ARS") {
  try {
    window.fbq?.("track", "InitiateCheckout", {
      content_ids: items.map(i => i.id), content_type: "product",
      num_items: items.length, value: total, currency,
    });
    window.gtag?.("event", "begin_checkout", {
      currency, value: total,
      items: items.map(i => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
    });
    window.ttq?.track("InitiateCheckout", { value: total, currency });
  } catch { /* best-effort */ }
}

export type StoreConversionKind = "placed" | "paid";

export function storeConversionEventId(kind: StoreConversionKind, orderNumber: string) {
  return `store:${orderNumber}:${kind}`;
}

export function storeConversionReceiptKey(eventId: string) {
  return `nerqia.pixel.sent.${eventId}`;
}

export function wasStoreConversionSent(storage: Pick<Storage, "getItem">, eventId: string) {
  try {
    return storage.getItem(storeConversionReceiptKey(eventId)) === "1";
  } catch {
    return false;
  }
}

export function markStoreConversionSent(storage: Pick<Storage, "setItem">, eventId: string) {
  try {
    storage.setItem(storeConversionReceiptKey(eventId), "1");
  } catch {
    // Storage bloqueado: transaction_id/event_id siguen dando deduplicación en proveedor.
  }
}

/**
 * Pedido creado. Shopify separa checkout completado del pago diferido y TikTok
 * ofrece `PlaceAnOrder`: una transferencia pendiente no es `CompletePayment`.
 * El id estable permite deduplicar recargas y una futura Events API.
 */
export function trackOrderPlaced(
  orderNumber: string,
  items: TrackedItem[],
  total: number,
  currency = "ARS",
) {
  const eventId = storeConversionEventId("placed", orderNumber);
  let attempted = false;
  try {
    if (window.fbq) {
      attempted = true;
      window.fbq("track", "Purchase", {
        content_ids: items.map(i => i.id), content_type: "product",
        value: total, currency,
      }, { eventID: eventId });
    }
    if (window.gtag) {
      attempted = true;
      window.gtag("event", "purchase", {
        transaction_id: orderNumber, currency, value: total,
        items: items.map(i => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
      });
    }
    if (window.ttq) {
      attempted = true;
      window.ttq.track("PlaceAnOrder", {
        contents: items.map(i => ({ content_id: i.id, content_name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
        content_type: "product", value: total, currency,
      }, { event_id: eventId });
    }
  } catch { /* best-effort */ }
  return attempted;
}

/** Pago efectivamente acreditado; nunca se emite para pending/failed. */
export function trackPaymentCompleted(
  orderNumber: string,
  items: TrackedItem[],
  total: number,
  currency = "ARS",
) {
  if (!window.ttq) return false;
  const eventId = storeConversionEventId("paid", orderNumber);
  try {
    window.ttq.track("CompletePayment", {
      contents: items.map(i => ({ content_id: i.id, content_name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
      content_type: "product", value: total, currency,
    }, { event_id: eventId });
    return true;
  } catch {
    return false;
  }
}
