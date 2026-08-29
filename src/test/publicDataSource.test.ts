import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTransientPublicError, retryPublicRead, type PgError } from "@/lib/publicDataSource";

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
