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

  it("resuelve links heredados por usuario u organización sin vaciar la tienda", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const products = source.slice(
      source.indexOf("export async function fetchCatalogProducts"),
      source.indexOf("export interface CatalogSettings"),
    );
    expect(products).toContain(".eq('user_id', userId)");
    expect(products).toContain(".eq('org_id', userId)");
    expect(products).toContain("{ ok: false, error:");
    expect(readFileSync(resolve(process.cwd(), "src/pages/PublicCatalogPage.tsx"), "utf8"))
      .toContain("fetchCatalogBranding(userId)");
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

  it.each(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '08006'])("recognizes database connection code %s without an embedded HTTP status", code => {
    expect(isTransientPublicError({ code, message: 'Could not query the database for the schema cache. Retrying.' })).toBe(true);
  });

  it.each(['42501', '42P01', '42883', '22023', 'PGRST202', 'PGRST205', 'PGRST301', 'PGRST300', 'XX000'])("does not retry structured error %s even with misleading transport wording", code => {
    expect(isTransientPublicError({ code, status: 500, message: 'network connection unavailable' })).toBe(false);
  });

  it("uses Supabase result status and preserves the final error after bounded retries", async () => {
    let attempts = 0;
    const error = { message: 'Gateway unavailable' };
    const result = await retryPublicRead(async () => { attempts++; return { data: null, error, status: 503 }; }, { delaysMs: [0, 0] });
    expect(attempts).toBe(3);
    expect(result.error).toBe(error);
    expect(result.status).toBe(503);
  });

  it("recovers from the exact production schema-cache outage instead of returning an empty catalog", async () => {
    let attempts = 0;
    const result = await retryPublicRead(async () => ++attempts === 1
      ? { data: null, error: { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, status: 503 }
      : { data: ['producto'], error: null, status: 200 }, { delaysMs: [0] });
    expect(attempts).toBe(2);
    expect(result.data).toEqual(['producto']);
  });

  it("recovers a thrown transport error but never retries a thrown permission error", async () => {
    let attempts = 0;
    expect((await retryPublicRead(async () => {
      if (++attempts === 1) throw new TypeError('Failed to fetch');
      return { data: 'ok', error: null };
    }, { delaysMs: [0] })).data).toBe('ok');
    attempts = 0;
    const denied = { code: '42501' };
    await expect(retryPublicRead(async () => { attempts++; throw denied; }, { delaysMs: [0, 0] })).rejects.toBe(denied);
    expect(attempts).toBe(1);
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

describe("catálogo, checkout y cobro no mienten con la red caída", () => {
  it("el catálogo distingue vacío de fallo: no devuelve [] como éxito", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const desde = fuente.indexOf("export async function fetchStoreProducts");
    const hasta = fuente.indexOf("export async function fetchCatalogProducts");
    const cuerpo = fuente.slice(desde, hasta);
    expect(cuerpo).toContain("{ ok: false, error:");
    expect(cuerpo).not.toMatch(/console\.error[\s\S]{0,80}return \[\]/);
  });

  it("el link de pago distingue inexistente de fallo: no devuelve null como 404", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const desde = fuente.indexOf("export async function fetchPublicPaymentLink");
    const hasta = fuente.indexOf("export async function confirmPaymentLinkTransfer");
    const cuerpo = fuente.slice(desde, hasta);
    expect(cuerpo).toContain("{ ok: false, error:");
    expect(cuerpo).toContain("Promise<LecturaPublica");
    expect(cuerpo).not.toMatch(/if \(!isMissingFunction\(rpc\.error\)\)[\s\S]{0,160}return null/);
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

  it("la pantalla pública diferencia error de catálogo vacío", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/pages/PublicCatalogPage.tsx"), "utf8");
    expect(fuente).toContain("const [loadError, setLoadError] = useState(false)");
    expect(fuente).toContain("if (loadError)");
    expect(fuente).toContain("No pudimos cargar el catálogo");
    expect(fuente).toContain("setLoadError(true)");
  });
});
