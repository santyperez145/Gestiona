import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTransientPublicError, retryIdempotentWrite, retryPublicRead, type PgError } from "@/lib/publicDataSource";

describe("publicDataSource catalog columns", () => {
  it("keeps storefront-only pricing columns out of the WhatsApp catalog query", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const catalogSection = source.slice(
      source.indexOf("export async function fetchCatalogProducts"),
      source.indexOf("export interface CatalogSettings"),
    );

    expect(catalogSection).toContain("PRODUCT_COLUMNS_WITH_DECANTS");
    expect(catalogSection).not.toContain("STORE_PRODUCT_COLUMNS_WITH_DECANTS");
    expect(source).toContain("const STORE_PRODUCT_COLUMNS_WITH_DECANTS");
  });
});

describe("publicDataSource public read recovery", () => {
  it("classifies transport failures without treating permissions as transient", () => {
    expect(isTransientPublicError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isTransientPublicError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientPublicError({ status: 503, message: "unavailable" })).toBe(true);
    expect(isTransientPublicError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isTransientPublicError({ code: "PGRST205", message: "relation missing" })).toBe(false);
  });

  it("reintenta una lectura transitoria y devuelve los productos cuando vuelve la red", async () => {
    let attempts = 0;
    const result = await retryPublicRead(async () => {
      attempts += 1;
      return attempts === 1
        ? { data: null, error: { message: "Failed to fetch" } satisfies PgError }
        : { data: ["producto"], error: null };
    }, { delaysMs: [0], maxAttempts: 2 });

    expect(attempts).toBe(2);
    expect(result.data).toEqual(["producto"]);
  });

  it("no repite respuestas de autorización o esquema", async () => {
    let attempts = 0;
    const result = await retryPublicRead(async () => {
      attempts += 1;
      return { data: null, error: { code: "42501", message: "permission denied" } satisfies PgError };
    }, { delaysMs: [0], maxAttempts: 3 });

    expect(attempts).toBe(1);
    expect(result.data).toBeNull();
  });
});

describe("catálogo y checkout no mienten con la red caída", () => {
  it("el catálogo distingue vacío de fallo: no devuelve [] como éxito", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const desde = fuente.indexOf("export async function fetchStoreProducts");
    const hasta = fuente.indexOf("export async function fetchCatalogProducts");
    const cuerpo = fuente.slice(desde, hasta);
    expect(cuerpo).toContain("{ ok: false, error:");
    expect(cuerpo).not.toMatch(/console\.error[\s\S]{0,80}return \[\]/);
  });

  it("el checkout idempotente reintenta un corte de red con la misma clave", async () => {
    let attempts = 0;
    const result = await retryIdempotentWrite(async () => {
      attempts += 1;
      return attempts < 3
        ? { data: null, error: { message: "Failed to fetch" } satisfies PgError }
        : { data: { order_number: "1" }, error: null };
    }, { delaysMs: [0, 0], maxAttempts: 3 });

    expect(attempts).toBe(3);
    expect(result.data).toEqual({ order_number: "1" });

    const fuente = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    expect(fuente).toContain("retryIdempotentWrite");
    expect(fuente).toContain("create_store_order_idem");
    expect(checkout).toContain("isTransientPublicError");
  });
});
