import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "supabase/functions/mp-installments/index.ts"), "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const executable = ts.transpileModule(ast.statements.filter(statement => !ts.isImportDeclaration(statement))
  .map(statement => statement.getFullText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
let handler: (request: Request) => Promise<Response>;
let store: unknown, connection: unknown, permitted: unknown, rate: number | undefined;
let envFailure: boolean;
const provider = vi.fn(), log = vi.fn(), rpc = vi.fn();
beforeEach(() => {
  store = { data: { org_id: "zz-org", payment_methods: ["gestiona_pay"], currency: "ARS" }, error: null };
  connection = { data: { public_key: "ZZ-public-test" }, error: null };
  permitted = { data: [], error: null }; rate = 0; envFailure = false;
  log.mockReset(); rpc.mockReset().mockImplementation(() => Promise.resolve(permitted));
  provider.mockReset().mockImplementation(async () => new Response(JSON.stringify([{ payment_type_id: "credit_card", payer_costs: [
    { installments: 3, installment_amount: 400, total_amount: 1200, ...(rate === undefined ? {} : { installment_rate: rate }) },
  ] }]), { status: 200, headers: { "Content-Type": "application/json" } }));
  const admin = { rpc, from: (table: string) => {
    const query = { select: () => query, ilike: () => query, eq: () => query,
      maybeSingle: async () => table === "ecommerce_stores" ? store : connection };
    return query;
  } };
  // Execute the actual handler with controlled dependencies; no HTTP server, provider or merchant writes.
  new Function("createClient", "requireEnv", "Deno", "fetch", "console", executable)(() => admin,
    () => { if (envFailure) throw new Error("ZZ confidential environment detail"); return "ZZ-env"; },
    { serve: (serve: typeof handler) => { handler = serve; } }, provider, { error: log });
});
const request = (method = "POST", body = JSON.stringify({ slug: "zz-store", amount: 1200 })) =>
  new Request("https://example.invalid/mp-installments", { method, ...(method === "POST" ? { body } : {}) });
async function expectSafeFailure(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).not.toMatch(/confidential|secret|SQL|credential/);
}

describe("public installment handler", () => {
  it("preserves the public storefront gateway configuration", () => {
    const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8").replace(/\r\n/g, "\n");
    expect(config).toContain("[functions.mp-installments]\nverify_jwt = false");
  });
  it("answers preflight without touching credentials or provider", async () => {
    envFailure = true;
    const response = await handler(request("OPTIONS"));
    expect(response.status).toBe(200); expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects unsupported methods with CORS", async () => { await expectSafeFailure(await handler(request("GET")), 405); });
  it("returns CORS for malformed input without reading configuration", async () => {
    envFailure = true; await expectSafeFailure(await handler(request("POST", "{bad")), 400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("contains environment failures without leaking secrets or caching errors", async () => {
    envFailure = true; await expectSafeFailure(await handler(request()), 503); expect(log).toHaveBeenCalledTimes(1);
  });
  it("does not turn a store lookup failure into an absent store", async () => {
    store = { data: null, error: { code: "PGRST002", message: "ZZ confidential SQL detail" } };
    await expectSafeFailure(await handler(request()), 503); expect(provider).not.toHaveBeenCalled();
  });
  it("does not turn a connection failure into missing OAuth", async () => {
    connection = { data: null, error: { code: "XX000", message: "ZZ confidential credential detail" } };
    await expectSafeFailure(await handler(request()), 503); expect(provider).not.toHaveBeenCalled();
  });
  it.each(["gestiona_pay", "mercadopago"])("accepts the canonical product and its legacy alias %s", async method => {
    store = { data: { org_id: "zz-org", payment_methods: [method], currency: "ARS" }, error: null };
    const response = await handler(request()); const data = await response.json();
    expect(response.status).toBe(200); expect(data.mejorSinInteres.cuotas).toBe(3); expect(provider).toHaveBeenCalledTimes(5);
    expect(rpc).toHaveBeenCalledWith("cuotas_disponibles", { p_org: "zz-org", p_monto: 1200, p_provider: "mercadopago" });
  });
  it("does not promise free financing when the provider omitted its rate", async () => {
    rate = undefined; const data = await (await handler(request())).json();
    expect(data.mejorSinInteres).toBeNull(); expect(data.opciones[0].sinInteres).toBe(false);
  });
  it("preserves recovery for provider outages and permission validation failures", async () => {
    provider.mockRejectedValue(new Error("ZZ confidential provider detail")); await expectSafeFailure(await handler(request()), 503);
    provider.mockImplementation(async () => new Response(JSON.stringify([{ payment_type_id: "credit_card", payer_costs: [] }])));
    permitted = { data: null, error: { code: "42501", message: "ZZ confidential SQL detail" } };
    await expectSafeFailure(await handler(request()), 503);
  });
  it("never contacts the provider for an unsupported store or currency", async () => {
    store = { data: { org_id: "zz-org", payment_methods: ["transferencia"], currency: "ARS" }, error: null };
    expect((await (await handler(request())).json()).motivo).toBe("mercadopago_no_habilitado");
    store = { data: { org_id: "zz-org", payment_methods: ["gestiona_pay"], currency: "USD" }, error: null };
    expect((await (await handler(request())).json()).motivo).toBe("moneda_no_soportada"); expect(provider).not.toHaveBeenCalled();
  });
});
