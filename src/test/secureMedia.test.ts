import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { urlMediaSegura, esUrlHttpInsegura } from "../lib/secureMedia";
import { galeriaDeProducto } from "../lib/storeProductGallery";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Contenido mixto en la vitrina.
 *
 * La alerta «No segura» de Chrome/Google aparece cuando una página HTTPS
 * carga imágenes por HTTP. Las fotos entran del comercio (Excel, migración,
 * carga manual) y nadie garantiza que estén en HTTPS. Esta guarda fija el
 * contrato: la vitrina normaliza al renderizar y nunca degrada.
 */
describe("urlMediaSegura", () => {
  it("sube http:// a https:// en dominios públicos", () => {
    expect(urlMediaSegura("http://cdn.ejemplo.com/foto.jpg")).toBe("https://cdn.ejemplo.com/foto.jpg");
    expect(urlMediaSegura("HTTP://tienda.com.ar/x.png")).toBe("https://tienda.com.ar/x.png");
  });

  it("deja localhost e IPs en http (ambientes de prueba)", () => {
    expect(urlMediaSegura("http://localhost:5173/f.png")).toBe("http://localhost:5173/f.png");
    expect(urlMediaSegura("http://127.0.0.1:9000/f.png")).toBe("http://127.0.0.1:9000/f.png");
  });

  it("no toca URLs ya seguras, relativas ni data URIs", () => {
    expect(urlMediaSegura("https://a.com/b.jpg")).toBe("https://a.com/b.jpg");
    expect(urlMediaSegura("/img/local.jpg")).toBe("/img/local.jpg");
    expect(urlMediaSegura("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(urlMediaSegura(null)).toBeNull();
    expect(urlMediaSegura("")).toBeNull();
  });

  it("agrega esquema a URLs sin protocolo", () => {
    expect(urlMediaSegura("midominio.com/foto.jpg")).toBe("https://midominio.com/foto.jpg");
  });

  it("esUrlHttpInsegura marca exactamente lo que corregimos", () => {
    expect(esUrlHttpInsegura("http://a.com/f.jpg")).toBe(true);
    expect(esUrlHttpInsegura("http://localhost/f.jpg")).toBe(false);
    expect(esUrlHttpInsegura("https://a.com/f.jpg")).toBe(false);
  });
});

describe("galeriaDeProducto con medios seguros", () => {
  it("normaliza http a https antes de deduplicar", () => {
    const g = galeriaDeProducto({
      image_url: "http://a.com/f.jpg",
      image_urls: ["https://a.com/f.jpg", "http://b.com/g.jpg"],
    });
    // La versión http y https de la misma foto colapsan en una entrada.
    expect(g).toEqual(["https://a.com/f.jpg", "https://b.com/g.jpg"]);
  });
});

/**
 * Cobertura de render: cada superficie de imagen de la vitrina pasa por
 * `urlMediaSegura`. Si mañana se agrega una imagen nueva sin normalizar,
 * este test la detecta.
 */
describe("superficies de imagen de la vitrina normalizadas", () => {
  const VENTANAS: Array<[string, RegExp]> = [
    ["src/storefront/ProductCard.tsx", /urlMediaSegura\(p\.image_url\)/],
    ["src/storefront/StoreBanners.tsx", /urlMediaSegura\(b\.image_url\)/],
    ["src/storefront/StoreHome.tsx", /urlMediaSegura\(cover\.image_url\)/],
    ["src/storefront/StoreLayout.tsx", /urlMediaSegura\(l\.image\)/],
    ["src/storefront/StoreCart.tsx", /urlMediaSegura\(l\.image\)/],
  ];

  it.each(VENTANAS)("%s normaliza su imagen", (file, re) => {
    expect(readFileSync(join(root, file), "utf8")).toMatch(re);
  });

  it("la galería de la ficha normaliza adentro de galeriaDeProducto", () => {
    const gallery = read("src/lib/storeProductGallery.ts");
    expect(gallery).toContain("urlMediaSegura");
  });

  it("vercel.json envía HSTS para que Chrome recuerde el HTTPS", () => {
    const v = read("vercel.json");
    expect(v).toContain("Strict-Transport-Security");
    expect(v).toContain("includeSubDomains");
  });
});