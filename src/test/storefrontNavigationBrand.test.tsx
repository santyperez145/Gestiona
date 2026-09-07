import { afterEach, describe, expect, it } from "vitest";
import { applyStorefrontDocumentBrand } from "@/lib/storefrontDocumentBrand";
import { storefrontScrollTarget } from "@/storefront/StorefrontNavigation";
import { PRESETS } from "@/lib/imageUpload";
import { NavigationType } from "react-router-dom";

describe("navegación e identidad del storefront", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("abre rutas nuevas arriba y restaura Atrás/Adelante", () => {
    expect(storefrontScrollTarget(NavigationType.Push, 580)).toBe(0);
    expect(storefrontScrollTarget(NavigationType.Replace, 580)).toBe(0);
    expect(storefrontScrollTarget(NavigationType.Pop, 580)).toBe(580);
    expect(storefrontScrollTarget(NavigationType.Pop)).toBe(0);
  });

  it("aplica favicon, Apple icon y color por tienda y restaura Nerqia al salir", () => {
    document.head.innerHTML = [
      '<link rel="icon" href="/brand/nerqia-mark.png">',
      '<link rel="apple-touch-icon" href="/brand/nerqia-mark.png">',
      '<meta name="theme-color" content="#173aef">',
      '<meta name="apple-mobile-web-app-title" content="Nerqia">',
    ].join("");

    const restore = applyStorefrontDocumentBrand({
      faviconUrl: "https://cdn.test/comercio.png",
      logoUrl: "https://cdn.test/logo.png",
      primaryColor: "#AA44CC",
      storeName: "Mi comercio",
    });
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href)
      .toBe("https://cdn.test/comercio.png");
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"))
      .toBe("https://cdn.test/comercio.png");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content"))
      .toBe("#AA44CC");
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"))
      .toBe("Mi comercio");

    restore();
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href"))
      .toBe("/brand/nerqia-mark.png");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content"))
      .toBe("#173aef");
  });

  it("prepara el favicon cuadrado, pequeño y PNG", () => {
    expect(PRESETS.favicon).toMatchObject({
      maxLado: 128,
      recorte: "cuadrado",
      formato: "png",
    });
  });
});
