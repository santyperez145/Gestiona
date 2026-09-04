import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initTracking,
  markStoreConversionSent,
  storeConversionEventId,
  trackPageView,
  trackOrderPlaced,
  trackPaymentCompleted,
  wasStoreConversionSent,
} from "@/storefront/tracking";

const ROOT = resolve(import.meta.dirname, "../..");
const ITEM = { id: "sku-1", name: "Producto", price: 1200, quantity: 2 };

describe("medición de conversión del Storefront", () => {
  beforeEach(() => {
    delete window.fbq;
    delete window.gtag;
    delete window.ttq;
    delete window.TiktokAnalyticsObject;
  });

  it("separa pedido colocado de pago acreditado y usa ids estables", () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const tiktokTrack = vi.fn();
    window.fbq = fbq;
    window.gtag = gtag;
    window.ttq = {
      track: tiktokTrack,
      load: vi.fn(),
      page: vi.fn(),
    } as unknown as Window["ttq"];

    expect(trackOrderPlaced("NQ-42", [ITEM], 2400)).toBe(true);
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Purchase",
      expect.objectContaining({ value: 2400, currency: "ARS" }),
      { eventID: "store:NQ-42:placed" },
    );
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "purchase",
      expect.objectContaining({ transaction_id: "NQ-42", value: 2400 }),
    );
    expect(tiktokTrack).toHaveBeenCalledWith(
      "PlaceAnOrder",
      expect.objectContaining({ value: 2400, currency: "ARS" }),
      { event_id: "store:NQ-42:placed" },
    );
    expect(tiktokTrack).not.toHaveBeenCalledWith("CompletePayment", expect.anything(), expect.anything());

    expect(trackPaymentCompleted("NQ-42", [ITEM], 2400)).toBe(true);
    expect(tiktokTrack).toHaveBeenCalledWith(
      "CompletePayment",
      expect.objectContaining({ value: 2400, currency: "ARS" }),
      { event_id: "store:NQ-42:paid" },
    );
  });

  it("instala la cola base y carga el pixel de TikTok con su id", () => {
    const pixelId = "C1234567890NERQIA";
    initTracking({ tiktokPixelId: pixelId });

    expect(window.TiktokAnalyticsObject).toBe("ttq");
    expect(window.ttq).toBeInstanceOf(Array);
    expect(window.ttq?._i?.[pixelId]).toBeDefined();
    expect(window.ttq?._t?.[pixelId]).toEqual(expect.any(Number));
    expect(window.ttq?.length).toBe(0);
    const script = document.getElementById(`tiktok-pixel-src-${pixelId}`) as HTMLScriptElement | null;
    expect(script?.src).toContain(`sdkid=${pixelId}`);
    expect(script?.src).toContain("lib=ttq");
  });

  it("emite un solo PageView SPA coherente en los tres proveedores", () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const page = vi.fn();
    window.fbq = fbq;
    window.gtag = gtag;
    window.ttq = {
      track: vi.fn(),
      load: vi.fn(),
      page,
    } as unknown as Window["ttq"];

    trackPageView();

    expect(fbq).toHaveBeenCalledOnce();
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("event", "page_view", expect.objectContaining({
      page_location: window.location.href,
    }));
    expect(page).toHaveBeenCalledOnce();
  });

  it("guarda un receipt no sensible para no reemitir al recargar", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const eventId = storeConversionEventId("placed", "NQ-42");

    expect(wasStoreConversionSent(storage, eventId)).toBe(false);
    markStoreConversionSent(storage, eventId);
    expect(wasStoreConversionSent(storage, eventId)).toBe(true);
  });

  it("la página sólo emite CompletePayment cuando el pedido está paid", () => {
    const orderPage = readFileSync(resolve(ROOT, "src/storefront/StoreOrder.tsx"), "utf8");
    const storefrontPage = readFileSync(resolve(ROOT, "src/pages/StorefrontPage.tsx"), "utf8");
    expect(orderPage).toContain('order.payment_status !== "paid"');
    expect(orderPage).toContain('storeConversionEventId("placed"');
    expect(orderPage).toContain('storeConversionEventId("paid"');
    expect(orderPage).not.toContain("trackPurchase(");
    expect(storefrontPage).toContain("[pathname, search, store]");
  });
});
