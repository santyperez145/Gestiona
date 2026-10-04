import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("barcode scanner capability", () => {
  it("limits the native scanner to Android and iOS", async () => {
    const { isNativeMobilePlatform } = await import("@/hooks/useBarcodeScan");

    expect(isNativeMobilePlatform("android")).toBe(true);
    expect(isNativeMobilePlatform("ios")).toBe(true);
    expect(isNativeMobilePlatform("windows")).toBe(false);
    expect(isNativeMobilePlatform(null)).toBe(false);
  });

  it("uses the browser detector when the web runtime exposes it", async () => {
    class Detector {
      static async getSupportedFormats() { return ["ean_13"]; }
      async detect() { return []; }
    }
    vi.stubGlobal("BarcodeDetector", Detector);

    const { barcodeScanSupported } = await import("@/hooks/useBarcodeScan");
    expect(barcodeScanSupported()).toBe(true);
  });
});
