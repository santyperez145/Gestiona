import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

describe("transporte CSP de los píxeles consentidos", () => {
  it("permite sólo los hosts que el cliente intenta usar", () => {
    const tracking = readFileSync(resolve(root, "src/storefront/tracking.ts"), "utf8");
    const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const csp = vercel.headers
      .flatMap(entry => entry.headers)
      .find(header => header.key === "Content-Security-Policy")?.value ?? "";

    for (const scriptHost of [
      "https://connect.facebook.net",
      "https://www.googletagmanager.com",
      "https://analytics.tiktok.com",
    ]) {
      expect(tracking).toContain(scriptHost);
      expect(csp).toContain(scriptHost);
    }
    for (const collectionHost of [
      "https://www.facebook.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://www.googletagmanager.com",
      "https://analytics.tiktok.com",
    ]) {
      expect(csp).toContain(collectionHost);
    }
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("connect-src *");
  });

  it("no activa medición ni mezcla merchants sin consentimiento", () => {
    const page = readFileSync(resolve(root, "src/pages/StorefrontPage.tsx"), "utf8");
    const order = readFileSync(resolve(root, "src/storefront/StoreOrder.tsx"), "utf8");
    const product = readFileSync(resolve(root, "src/storefront/StoreProduct.tsx"), "utf8");
    const checkout = readFileSync(resolve(root, "src/storefront/StoreCheckout.tsx"), "utf8");
    const tracking = readFileSync(resolve(root, "src/storefront/tracking.ts"), "utf8");

    expect(page).toContain('trackingConsent !== "granted"');
    expect(page).toContain("deactivateTracking()");
    expect(order).toContain("useStoreTrackingRuntimeReady");
    expect(product).toContain("useStoreTrackingRuntimeReady");
    expect(checkout).toContain("useStoreTrackingRuntimeReady");
    expect(page).toContain("isSensitiveStorefrontTrackingPath(pathname)");
    expect(tracking).toContain('"trackSingle", activos.metaPixelId');
    expect(tracking).toContain("send_to: activos.gaMeasurementId");
    expect(tracking).toContain("window.ttq.instance?.(activos.tiktokPixelId)");
  });
});
