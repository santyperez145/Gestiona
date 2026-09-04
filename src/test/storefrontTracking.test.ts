import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deactivateTracking,
  initTracking,
  isSensitiveStorefrontTrackingPath,
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
    deactivateTracking();
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

    initTracking({
      metaPixelId: "META-NQ-42",
      gaMeasurementId: "G-NQ42",
      tiktokPixelId: "TIK-NQ42",
    });
    window.fbq = fbq;
    window.gtag = gtag;
    window.ttq = {
      track: tiktokTrack,
      load: vi.fn(),
      page: vi.fn(),
    } as unknown as Window["ttq"];
    fbq.mockClear();
    gtag.mockClear();
    tiktokTrack.mockClear();

    expect(trackOrderPlaced("NQ-42", [ITEM], 2400)).toBe(true);
    expect(fbq).toHaveBeenCalledWith(
      "trackSingle",
      "META-NQ-42",
      "Purchase",
      expect.objectContaining({ value: 2400, currency: "ARS" }),
      { eventID: "store:NQ-42:placed" },
    );
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "purchase",
      expect.objectContaining({ transaction_id: "NQ-42", value: 2400, send_to: "G-NQ42" }),
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

    initTracking({
      metaPixelId: "META-PAGE",
      gaMeasurementId: "G-PAGE",
      tiktokPixelId: "TIK-PAGE",
    });
    window.fbq = fbq;
    window.gtag = gtag;
    window.ttq = {
      track: vi.fn(),
      load: vi.fn(),
      page,
    } as unknown as Window["ttq"];
    fbq.mockClear();
    gtag.mockClear();
    page.mockClear();

    trackPageView();

    expect(fbq).toHaveBeenCalledOnce();
    expect(fbq).toHaveBeenCalledWith("trackSingle", "META-PAGE", "PageView");
    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("event", "page_view", expect.objectContaining({
      page_location: window.location.href,
      send_to: "G-PAGE",
    }));
    expect(page).toHaveBeenCalledOnce();
  });

  it("no envía eventos sin consentimiento y corta el tenant anterior", () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const page = vi.fn();
    window.fbq = fbq;
    window.gtag = gtag;
    window.ttq = { track: vi.fn(), load: vi.fn(), page } as unknown as Window["ttq"];

    deactivateTracking();
    fbq.mockClear();
    gtag.mockClear();
    page.mockClear();
    trackPageView();

    expect(fbq).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
    expect(trackOrderPlaced("NQ-NO-CONSENT", [ITEM], 2400)).toBe(false);
  });

  it("direcciona el PageView al merchant activo al navegar entre tiendas", () => {
    const fbq = vi.fn();
    const pageA = vi.fn();
    const pageB = vi.fn();
    const instance = vi.fn((id: string) => ({
      page: id === "TIK-TENANT-B" ? pageB : pageA,
      track: vi.fn(),
      load: vi.fn(),
      enableCookie: vi.fn(),
      disableCookie: vi.fn(),
    }));
    window.fbq = fbq;
    window.ttq = {
      instance,
      page: vi.fn(),
      track: vi.fn(),
      load: vi.fn(),
    } as unknown as Window["ttq"];

    initTracking({ metaPixelId: "META-TENANT-A", tiktokPixelId: "TIK-TENANT-A" });
    initTracking({ metaPixelId: "META-TENANT-B", tiktokPixelId: "TIK-TENANT-B" });
    fbq.mockClear();
    instance.mockClear();
    trackPageView();

    expect(fbq).toHaveBeenCalledWith("trackSingle", "META-TENANT-B", "PageView");
    expect(fbq).not.toHaveBeenCalledWith("trackSingle", "META-TENANT-A", "PageView");
    expect(instance).toHaveBeenCalledWith("TIK-TENANT-B");
    expect(pageB).toHaveBeenCalledOnce();
    expect(pageA).not.toHaveBeenCalled();
  });

  it("reconoce rutas con capacidades y no confunde el carrito normal", () => {
    expect(isSensitiveStorefrontTrackingPath("/tienda/demo/orden/NQ-42")).toBe(true);
    expect(isSensitiveStorefrontTrackingPath("/tienda/demo/carrito/token-secreto")).toBe(true);
    expect(isSensitiveStorefrontTrackingPath("/tienda/demo/carrito")).toBe(false);
    expect(isSensitiveStorefrontTrackingPath("/tienda/demo/productos")).toBe(false);
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
    expect(storefrontPage).toContain("[pathname, search, store, trackingRuntimeReady]");
  });
});
