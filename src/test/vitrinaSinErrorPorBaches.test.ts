import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { STORE_AUTO_RELOAD_DELAYS_MS, STORE_READ_RETRY_DELAYS_MS } from "@/storefront/storeContext";

// 2026-10-14: el E2E de la tienda mostró «No pudimos cargar Exentry Imports»
// a un comprador simulado: cada lectura tenía 2 intentos de 4 s y un bache de
// la base de unos segundos alcanzaba para la pantalla de error.
describe("la vitrina no muestra error por un bache de la base", () => {
  it("cada lectura de la vitrina se intenta 4 veces con espera creciente", () => {
    expect(STORE_READ_RETRY_DELAYS_MS).toEqual([300, 1_000, 2_500]);
    const s = fs.readFileSync("src/storefront/storeContext.tsx", "utf8");
    expect(s).toContain("const readOptions = { signal: controller.signal, delaysMs: STORE_READ_RETRY_DELAYS_MS };");
  });

  it("si igual falla, se recarga sola dos veces antes de dejar sólo el botón", () => {
    expect(STORE_AUTO_RELOAD_DELAYS_MS).toEqual([5_000, 15_000]);
    const s = fs.readFileSync("src/storefront/storeContext.tsx", "utf8");
    expect(s).toMatch(/autoReintentosRef\.current >= STORE_AUTO_RELOAD_DELAYS_MS\.length/);
    expect(s).toMatch(/setTimeout\(\(\) => \{ autoReintentosRef\.current \+= 1; reload\(\); \}, espera\)/);
  });

  it("el E2E de recuperación cuenta los 4 intentos", () => {
    const e2e = fs.readFileSync("e2e/store-read-recovery.spec.ts", "utf8");
    expect(e2e).toContain('expect(attempts).toBe(resource === "get_store_variants" ? 1 : 4);');
  });
});
