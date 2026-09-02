import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clampIndice,
  galeriaDeProducto,
  indiceAnterior,
  indicePorDesliz,
  indiceSiguiente,
} from "@/lib/storeProductGallery";

describe("galería de la ficha", () => {
  it("deduplica y pone la foto de la variante primero", () => {
    expect(galeriaDeProducto({
      image_url: "https://cdn/a.jpg",
      image_urls: ["https://cdn/a.jpg", "https://cdn/b.jpg", ""],
      variant_image: "https://cdn/b.jpg",
    })).toEqual(["https://cdn/b.jpg", "https://cdn/a.jpg"]);
  });

  it("sin fotos no inventa un slide", () => {
    expect(galeriaDeProducto({})).toEqual([]);
    expect(indiceSiguiente(0, 0)).toBe(0);
    expect(indiceAnterior(3, 1)).toBe(0);
    expect(clampIndice(9, 3)).toBe(2);
  });

  it("el desliz cambia de toma y no sale de la lista", () => {
    expect(indicePorDesliz(-50, 0, 3)).toBe(1);
    expect(indicePorDesliz(50, 0, 3)).toBe(2);
    expect(indicePorDesliz(-10, 1, 3)).toBe(1);
    expect(indiceSiguiente(2, 3)).toBe(0);
  });

  it("la ficha abre, pasa y acerca; no copia un lightbox ajeno", () => {
    const ui = readFileSync(resolve(process.cwd(), "src/storefront/StoreProductGallery.tsx"), "utf8");
    const ficha = readFileSync(resolve(process.cwd(), "src/storefront/StoreProduct.tsx"), "utf8");
    expect(ficha).toContain("StoreProductGallery");
    expect(ficha).toContain("galeriaDeProducto");
    expect(ui).toContain('role="dialog"');
    expect(ui).toContain("indicePorDesliz");
    expect(ui).toContain("Acercar");
    expect(ui).toContain("min-h-11");
    expect(ui).not.toMatch(/@nimbus-ds|nimbus\.tiendanube/i);
  });
});
