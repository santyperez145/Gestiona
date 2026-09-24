import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const vercelJson = readFileSync(resolve(root, "vercel.json"), "utf8");
const storeProduct = readFileSync(resolve(root, "src/storefront/StoreProduct.tsx"), "utf8");
const storeCheckout = readFileSync(resolve(root, "src/storefront/StoreCheckout.tsx"), "utf8");
const storePublish = readFileSync(resolve(root, "src/lib/storeFirstPublish.ts"), "utf8");
const ecommercePage = readFileSync(resolve(root, "src/pages/EcommerceStorePage.tsx"), "utf8");

describe("potenciación de tiendas online y seguridad HTTPS/SSL", () => {
  it("fuerza la actualización de contenido inseguro a https con upgrade-insecure-requests en index.html y vercel.json", () => {
    // Evita la advertencia de navegador 'No seguro' por contenido mixto (imágenes http://)
    expect(indexHtml).toContain('<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests" />');
    expect(vercelJson).toContain("upgrade-insecure-requests;");
  });

  it("permite frames de Mercado Pago en la CSP para evitar bloqueos en el checkout", () => {
    expect(vercelJson).toContain("https://*.mercadopago.com");
    expect(vercelJson).toContain("https://www.mercadopago.com.ar");
  });

  it("provee la función urlDirectaDeTienda para enlace seguro garantizado en el dominio principal", () => {
    expect(storePublish).toContain("export function urlDirectaDeTienda");
    expect(ecommercePage).toContain("urlDirectaDeTienda");
    expect(ecommercePage).toContain("urlDirectaSegura");
  });

  it("la ficha de producto incorpora el botón 'Comprar ahora' (1-click checkout)", () => {
    expect(storeProduct).toContain("comprarAhora");
    expect(storeProduct).toContain("Comprar ahora");
    expect(storeProduct).toContain("navigate(`${base}/checkout`)");
  });

  it("la ficha de producto y el checkout exhiben badges verídicos de compra segura y cifrado SSL", () => {
    expect(storeProduct).toContain("Compra protegida y cifrada con SSL");
    expect(storeCheckout).toContain("Checkout 100% protegido con cifrado SSL bancario");
    expect(storeCheckout).toContain("ShieldCheck");
  });
});
