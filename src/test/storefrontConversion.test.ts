import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * El recorrido de compra en el teléfono no puede perder el CTA.
 *
 * D5 pide compra completa a 360 px. La ficha, el carrito y el checkout ya
 * existían; lo que faltaba era que Agregar, Finalizar y Confirmar siguieran
 * al dedo cuando el comprador scrollea descripción, sugerencias o el formulario.
 */
describe("recorrido de compra a 360 px", () => {
  it("la ficha deja Agregar al carrito fijo al pie en mobile", () => {
    const ficha = leer("src/storefront/StoreProduct.tsx");
    expect(ficha).toContain("storefront-buy-bar");
    expect(ficha).toContain("fixed inset-x-0 bottom-0");
    expect(ficha).toContain("Agregar al carrito");
    expect(ficha).toContain("min-h-11 flex-1");
    expect(ficha).toContain("env(safe-area-inset-bottom)");
  });

  it("el carrito cierra, quita y termina la compra con objetivo de 44 px", () => {
    const layout = leer("src/storefront/StoreLayout.tsx");
    expect(layout).toContain('aria-label="Cerrar"');
    expect(layout).toContain("min-h-11 min-w-11 grid place-items-center");
    expect(layout).toContain('aria-label="Quitar"');
    expect(layout).toContain("Finalizar compra");
    expect(layout).toContain("flex min-h-11 items-center justify-center");
  });

  it("el carrito no dice Gratis cuando el envío se cotiza por provincia", () => {
    // Shopify/Tiendanube: sin ubicación no cierran flete en modo zonas.
    // shippingCost===0 ⇒ «Gratis» mentía con shipping_mode=zones (default ATM).
    const layout = leer("src/storefront/StoreLayout.tsx");
    const ctx = leer("src/storefront/storeContext.tsx");
    const helper = leer("src/lib/storeCartShipping.ts");
    expect(layout).toContain("shippingLabel");
    expect(layout).not.toMatch(/shippingCost === 0 \? ["']Gratis["']/);
    expect(ctx).toContain("cartShippingDisplay");
    expect(helper).toContain("Se calcula con tu provincia");
  });

  it("el carrito cotiza con provincia antes del checkout (estándar competitivo)", () => {
    // ESTANDAR §5.10: costo/plazo de envío antes de pedir datos innecesarios.
    const layout = leer("src/storefront/StoreLayout.tsx");
    const checkout = leer("src/storefront/StoreCheckout.tsx");
    expect(layout).toContain("quoteStoreShipping");
    expect(layout).toContain("Provincia para cotizar el envío");
    expect(layout).toContain("guardarProvinciaCarrito");
    expect(checkout).toContain("leerProvinciaCarrito");
  });

  it("el checkout no inventa Gratis y prioriza entrega + autofill", () => {
    const checkout = leer("src/storefront/StoreCheckout.tsx");
    expect(checkout).toContain("checkoutShippingDisplay");
    expect(checkout).toContain("envioResumenTexto");
    expect(checkout).not.toMatch(/opciones\.length > 0 \? 0 : shippingCost/);
    expect(checkout).toContain("Comprás como invitado");
    expect(checkout).toContain('autoComplete="email"');
    expect(checkout).toContain('autoComplete="name"');
    // Entrega aparece antes que contacto (índice en el archivo).
    expect(checkout.indexOf(">Entrega<")).toBeLessThan(checkout.indexOf(">Tus datos<"));
  });

  it("filtros y checkout no esconden la acción primaria en el teléfono", () => {
    const productos = leer("src/storefront/StoreProducts.tsx");
    const checkout = leer("src/storefront/StoreCheckout.tsx");
    expect(productos).toContain("sm:hidden inline-flex min-h-11");
    expect(productos).toContain("min-h-11 text-left");
    expect(checkout).toContain("w-full min-h-11 px-3");
    expect(checkout).toContain("w-full min-h-11 py-3");
    expect(checkout).toContain("max-md:sticky max-md:bottom-0");
  });
});
