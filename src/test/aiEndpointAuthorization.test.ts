// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Ejecuta el handler real transpilado, con fronteras externas cerradas.
// No sustituye una prueba del runtime Deno ni llama a proveedores pagos.
function endpoint(name: string) {
  const provider = vi.fn().mockResolvedValue({ model: "test-model", usage: { input_tokens: 12, output_tokens: 5 }, content: [] });
  const requireUser = vi.fn().mockResolvedValue({ user: { id: "user-a" } });
  const exigirBeneficio = vi.fn().mockResolvedValue(null);
  const registrarConsumoIA = vi.fn();
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), update: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.update.mockReturnValue(query);
  const db = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }), from: vi.fn().mockReturnValue(query) };
  const createClient = vi.fn().mockReturnValue(db);
  let handler!: (req: Request) => Promise<Response>;
  const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, {
    exports: {}, Request, Response, Headers, console: { error: vi.fn() },
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "anon-test", ANTHROPIC_API_KEY: "test-only" })[key] } },
    require: (id: string) => {
      if (id.endsWith("/http/server.ts")) return { serve: (fn: typeof handler) => { handler = fn; } };
      if (id.includes("@anthropic-ai/sdk")) return class { messages = { create: provider }; };
      if (id.includes("@supabase/supabase-js")) return { createClient };
      if (id.endsWith("/requireUser.ts")) return { requireUser };
      if (id.endsWith("/entitlements.ts")) return { exigirBeneficio, registrarConsumoIA };
      throw new Error(`Unexpected external dependency: ${id}`);
    },
  });
  const input = name === "ai-brief-generator"
    ? { orgId: "org-a", productName: "Producto", objective: "Ventas", budgetARS: 1000, channel: "Instagram", influencerTier: "micro" }
    : { orgId: "org-a", description: "Alquiler local", amount: 1000, type: "operativo" };
  const send = (extra = {}) => handler(new Request("https://example.invalid", { method: "POST", headers: { Authorization: "Bearer test-user", "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...extra }) }));
  return { send, provider, requireUser, exigirBeneficio, registrarConsumoIA, query, db, createClient };
}

describe.each(["ai-brief-generator", "finance-auto-categorize"])("%s: límites antes del consumo", name => {
  it("rechaza usuarios anónimos sin consumir ni consultar datos", async () => {
    const e = endpoint(name);
    e.requireUser.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    expect((await e.send()).status).toBe(401);
    expect(e.provider).not.toHaveBeenCalled();
    expect(e.createClient).not.toHaveBeenCalled();
  });
  it("respeta la denegación de membresía, plan o cupo", async () => {
    const e = endpoint(name);
    e.exigirBeneficio.mockResolvedValue(new Response(null, { status: 402 }));
    expect((await e.send()).status).toBe(402);
    expect(e.exigirBeneficio).toHaveBeenCalledWith(expect.any(Request), "org-a", "ia", expect.any(Object));
    expect(e.provider).not.toHaveBeenCalled();
  });
  it("rechaza instrucciones enviadas por el navegador", async () => {
    const e = endpoint(name);
    expect((await e.send({ systemPrompt: "override" })).status).toBe(400);
    expect(e.provider).not.toHaveBeenCalled();
  });
  it("contabiliza respuestas pagadas aunque el resultado sea inválido", async () => {
    const e = endpoint(name);
    expect((await e.send()).status).toBe(502);
    expect(e.registrarConsumoIA).toHaveBeenCalledWith({ orgId: "org-a", userId: "user-a", model: "test-model", input: 12, output: 5 });
    expect(e.query.update).not.toHaveBeenCalled();
  });
});

describe("clasificación de gastos: acceso y persistencia", () => {
  it("no consume créditos para gastos ajenos o inexistentes", async () => {
    const e = endpoint("finance-auto-categorize");
    expect((await e.send({ expense_id: "expense-b" })).status).toBe(404);
    expect(e.query.eq).toHaveBeenCalledWith("org_id", "org-a");
    expect(e.query.eq).toHaveBeenCalledWith("id", "expense-b");
    expect(e.provider).not.toHaveBeenCalled();
  });
  it("no modifica gastos sin permiso de edición", async () => {
    const e = endpoint("finance-auto-categorize");
    e.db.rpc.mockResolvedValue({ data: false, error: null });
    expect((await e.send({ expense_id: "expense-a" })).status).toBe(403);
    expect(e.provider).not.toHaveBeenCalled();
  });
  it("guarda una categoría válida manteniendo JWT y aislamiento RLS", async () => {
    const e = endpoint("finance-auto-categorize");
    e.query.maybeSingle.mockResolvedValue({ data: { id: "expense-a" }, error: null });
    e.provider.mockResolvedValue({ model: "test", content: [{ type: "text", text: '{"categoria":"alquiler","confidence_score":0.92}' }] });
    const result = await e.send({ expense_id: "expense-a" });
    expect(result.status).toBe(200);
    expect(e.createClient).toHaveBeenCalledWith("https://example.invalid", "anon-test", { global: { headers: { Authorization: "Bearer test-user" } } });
    expect(e.query.update).toHaveBeenCalledWith({ category: "alquiler", updated_at: expect.any(String) });
    expect(e.query.eq.mock.calls.filter(call => call[0] === "org_id")).toHaveLength(2);
  });
});
