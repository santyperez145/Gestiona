import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePageSize,
  parsePublicDecimal,
  publicApiHeaders,
  PUBLIC_API_ARS_DECIMALS,
  PUBLIC_API_MAX_ARS,
  PUBLIC_API_MAX_INTEGER,
  PUBLIC_API_MAX_USD,
  PUBLIC_API_RELEASE,
  PUBLIC_API_USD_DECIMALS,
} from "../../supabase/functions/_shared/publicApiContract";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const openapi = JSON.parse(read("public/developer/api/openapi.json"));
const changelog = JSON.parse(read("public/developer/api/changelog.json"));
const edge = read("supabase/functions/public-api/index.ts");
const sharedContract = read("supabase/functions/_shared/publicApiContract.ts");
const migration = read("supabase/migrations/20260829000020_api_publica_tiene_contrato.sql");
const verification = read("supabase/verificaciones/20260829_api_publica_contrato.sql");
const panel = read("src/components/integrations/AdvancedApiKeysPanel.tsx");
const docs = read("docs/API_PUBLICA.md");
const vercel = JSON.parse(read("vercel.json"));

describe("contrato público de la API v1", () => {
  it("publica sólo los siete métodos reales y su scope", () => {
    expect(openapi.openapi).toBe("3.1.1");
    expect(openapi["x-gestiona-contract"].release).toBe(PUBLIC_API_RELEASE);
    expect(openapi.security).toEqual([{ BearerApiKey: [] }]);
    const methods = Object.entries(openapi.paths).flatMap(([path, operations]) =>
      Object.entries(operations as Record<string, { "x-required-scope": string }>)
        .map(([method, operation]) => `${method.toUpperCase()} ${path} ${operation["x-required-scope"]}`),
    );
    expect(methods.sort()).toEqual([
      "GET /customers customers:read",
      "GET /products products:read",
      "GET /products/{productId} products:read",
      "GET /sales sales:read",
      "GET /stock/{productId} stock:read",
      "PATCH /stock/{productId} stock:write",
      "POST /sales sales:write",
    ]);
    expect(openapi.components.parameters.IdempotencyKey.required).toBe(true);
  });

  it("el contrato decimal es ejecutable y tolera sólo ruido IEEE-754", () => {
    expect(openapi.components.schemas.MoneyArs).toMatchObject({
      multipleOf: 0.01,
      maximum: PUBLIC_API_MAX_ARS,
    });
    expect(openapi.components.schemas.MoneyUsd).toMatchObject({
      multipleOf: 0.0001,
      maximum: PUBLIC_API_MAX_USD,
    });
    expect(parsePublicDecimal(12.34, PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS)).toBe(12.34);
    expect(parsePublicDecimal(0.1 + 0.2, PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS)).toBe(0.3);
    expect(parsePublicDecimal(12.345, PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS)).toBeNull();
    expect(parsePublicDecimal("12.34", PUBLIC_API_ARS_DECIMALS, PUBLIC_API_MAX_ARS)).toBeNull();
    expect(parsePublicDecimal(1.2345, PUBLIC_API_USD_DECIMALS, PUBLIC_API_MAX_USD)).toBe(1.2345);
    expect(openapi["x-gestiona-contract"].stock.representation).toBe("integer-units");
  });

  it("valida límites en vez de convertir NaN en un error de base", () => {
    expect(parsePageSize(null)).toBe(100);
    expect(parsePageSize("500")).toBe(500);
    for (const invalid of ["0", "501", "-1", "1.5", "abc"]) {
      expect(parsePageSize(invalid)).toBeNull();
    }
    expect(edge).toContain("parsePageSize(");
    expect(edge).toContain("since must be an ISO 8601 date-time");
    expect(edge).toContain("productId must be a UUID");
    expect(edge).toContain("Versioned path required");
    expect(edge).toContain("rawPath.startsWith(versionPrefix)");
    expect(openapi.components.schemas.SaleCreate.properties.quantity.maximum).toBe(PUBLIC_API_MAX_INTEGER);
  });

  it("usa un request id correlacionable y soporta deprecación estándar sin deprecar v1", () => {
    const active = publicApiHeaders({
      requestId: "11111111-1111-4111-8111-111111111111",
      origin: "https://nerqia.app",
      rateLimit: { limit: 1000, remaining: 999, resetAt: 1_788_000_000 },
    });
    expect(active["X-Request-Id"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(active["X-RateLimit-Remaining"]).toBe("999");
    expect(active.Link).toContain("rel=\"service-desc\"");
    expect(active).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(active).not.toHaveProperty("Deprecation");

    const deprecated = publicApiHeaders({
      requestId: "11111111-1111-4111-8111-111111111111",
      origin: "https://nerqia.app",
      lifecycle: {
        deprecationAt: 1_800_000_000,
        sunsetAt: new Date("2028-01-01T00:00:00Z"),
        migrationUrl: "https://nerqia.app/developer/api/v2",
      },
    });
    expect(deprecated.Deprecation).toBe("@1800000000");
    expect(deprecated.Sunset).toBe("Sat, 01 Jan 2028 00:00:00 GMT");
    expect(deprecated.Link).toContain("rel=\"deprecation\"");
    expect(changelog.versions[0].status).toBe("active");
    expect(changelog.versions[0].deprecated_at).toBeNull();
    expect(changelog.policy.minimum_support_after_successor_months).toBe(12);
  });

  it("el rate limit contractual es durable, por key y sólo service_role", () => {
    expect(edge).toContain('rpc("api_key_consumir_cupo"');
    expect(sharedContract).toContain('headers["X-RateLimit-Remaining"]');
    expect(edge).not.toContain("rateLimitResponse()");
    expect(migration).toContain("ON CONFLICT (clave, ventana) DO UPDATE");
    expect(migration).toContain("rate_limit_rpm BETWEEN 1 AND 10000");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.api_key_consumir_cupo(uuid) TO service_role");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("sales:write no hereda costs:read ni una idempotencia no atómica", () => {
    expect(edge).toContain("publicSale(rpcResult.data, tiene(\"costs:read\"))");
    expect(edge).not.toContain(".select().single()");
    expect(edge).not.toContain('rpc("idempotencia_reservar"');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.api_v1_crear_venta");
    expect(migration.indexOf("SELECT * INTO v_product")).toBeLessThan(migration.indexOf("public.idempotencia_reservar("));
    expect(migration).toContain("public.idempotencia_completar(");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(verification).toContain("ROLLBACK;");
    expect(verification).toContain("AS restos");
  });

  it("products:read no filtra stock y la UI tampoco lee el hash", () => {
    expect(edge).toContain('...(tiene("stock:read") ? ["stock"] : [])');
    expect(edge).toContain('...(tiene("costs:read") ? ["cost_usd"] : [])');
    expect(panel).not.toContain('.select("*")');
    expect(panel).not.toMatch(/\.select\([^)]*key_hash/);
  });

  it("la superficie hace visibles contrato, lifecycle y guía sin fallback HTML", () => {
    expect(panel).toContain("/developer/api/openapi.json");
    expect(panel).toContain("/developer/api/changelog.json");
    expect(panel).toContain("docs/API_PUBLICA.md");
    expect(docs).toContain("Deprecation");
    expect(docs).toContain("JSON number nominal");
    expect(vercel.rewrites.at(-1).source).toContain("developer/");
    expect(vercel.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/developer/(.*)" }),
    ]));
  });
});
