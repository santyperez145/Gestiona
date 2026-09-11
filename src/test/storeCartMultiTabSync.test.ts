import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("sincronización multi-pestaña del carrito (Shopify parity)", () => {
  const contextCode = read("src/storefront/storeContext.tsx");

  it("escucha el evento storage de window para sincronizar líneas del carrito", () => {
    expect(contextCode).toContain("window.addEventListener(\"storage\", handleStorage)");
    expect(contextCode).toContain("cartKey(storageScope)");
    expect(contextCode).toContain("cartRef.current = raw");
    expect(contextCode).toContain("setCart(raw");
  });

  it("sincroniza el cartToken cuando rota o se actualiza en otra pestaña", () => {
    expect(contextCode).toContain("cartSessionKey(storageScope)");
    expect(contextCode).toContain("setCartToken(e.newValue)");
  });

  it("remueve el listener al desmontar para evitar memory leaks", () => {
    expect(contextCode).toContain("window.removeEventListener(\"storage\", handleStorage)");
  });
});
