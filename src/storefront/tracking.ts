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
    ttq?: { track: (e: string, p?: unknown) => void; load: (id: string) => void; page: () => void };
  }
}

let iniciado = false;

function cargarScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Inicializa los píxeles configurados. Repetir la llamada no hace nada. */
export function initTracking({ metaPixelId, gaMeasurementId, tiktokPixelId }: TrackingIds) {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;

  try {
    // ── Meta (Facebook / Instagram) ─────────────────────────────────────
    if (metaPixelId) {
      // Cola mínima de fbq: encola los eventos hasta que el script real carga.
      // Es la forma que documenta Meta, escrita sin los atajos del snippet
      // original para que pase el linter.
      /* eslint-disable @typescript-eslint/no-explicit-any */
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
      /* eslint-enable @typescript-eslint/no-explicit-any */
      window.fbq?.("init", metaPixelId);
      window.fbq?.("track", "PageView");
    }

    // ── Google Analytics 4 ──────────────────────────────────────────────
    if (gaMeasurementId) {
      cargarScript(`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`, "ga4-src");
      window.dataLayer = window.dataLayer || [];
      window.gtag = function (...args: unknown[]) { window.dataLayer!.push(args); };
      window.gtag("js", new Date());
      window.gtag("config", gaMeasurementId);
    }

    // ── TikTok ──────────────────────────────────────────────────────────
    if (tiktokPixelId) {
      cargarScript("https://analytics.tiktok.com/i18n/pixel/events.js", "ttq-src");
    }
  } catch {
    // Un bloqueador de anuncios no debe romper la tienda.
  }
}

/** Cambio de página en una SPA: los píxeles no lo detectan solos. */
export function trackPageView() {
  try {
    window.fbq?.("track", "PageView");
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

/**
 * Compra concretada. `orderNumber` va como id de transacción para que las
 * plataformas descarten duplicados si el comprador recarga la confirmación.
 */
export function trackPurchase(
  orderNumber: string,
  items: TrackedItem[],
  total: number,
  currency = "ARS",
) {
  try {
    window.fbq?.("track", "Purchase", {
      content_ids: items.map(i => i.id), content_type: "product",
      value: total, currency,
    });
    window.gtag?.("event", "purchase", {
      transaction_id: orderNumber, currency, value: total,
      items: items.map(i => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
    });
    window.ttq?.track("CompletePayment", { value: total, currency });
  } catch { /* best-effort */ }
}
