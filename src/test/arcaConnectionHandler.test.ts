import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "supabase/functions/afip-authorize/index.ts"), "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const executable = ts.transpileModule(ast.statements.filter(statement => !ts.isImportDeclaration(statement))
  .map(statement => statement.getFullText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
class ReadError extends Error { constructor(public code: string, message: string) { super(message); } }
let handler: (request: Request) => Promise<Response>, authenticated: boolean, member: boolean, allowed: boolean;
let staff: string | null;
let platformCuit: string;
let context: { data: unknown; error: unknown }, resolveFailure: boolean, providerFailure: string | null;
let pointFailure: boolean;
const rpc = vi.fn(), provider = vi.fn(), reads: string[] = [];
const cred = { cuit: "20123456786", punto_venta: 12, tipo_emisor: "responsable_inscripto", environment: "homologacion",
  modo: "delegado", certificate: "ZZ unused", private_key: "ZZ unused", conexion_version: 7,
  ta_token: "ZZ test TA", ta_sign: "ZZ test sign", ta_expires_at: "2099-01-01T00:00:00Z" };
beforeEach(() => {
  authenticated = true; member = true; allowed = true; staff = null; platformCuit = cred.cuit; context = { data: { ok: true }, error: null };
  resolveFailure = false; providerFailure = null; pointFailure = false; reads.length = 0;
  rpc.mockReset().mockImplementation(async (name: string) => name === "has_permission" ? { data: allowed, error: null } : context);
  provider.mockReset().mockImplementation(async () => {
    if (providerFailure) throw new Error(providerFailure);
    return new Response("ZZ provider fixture", { status: 200 });
  });
  const admin = { rpc, auth: { getUser: async () => ({ data: { user: authenticated ? { id: "zz-actor" } : null } }) },
    from: (table: string) => { reads.push(table); const query = { select: () => query, eq: () => query, in: () => query,
      maybeSingle: async () => ({ data: table === "memberships" ? member ? { role: "owner" } : null
        : table === "platform_admins" ? staff ? { user_id: "zz-actor", role: staff } : null : { cuit: platformCuit }, error: null }) }; return query; } };
  new Function("createClient", "Deno", "resolverCredencialesAfip", "esLlamadaDeCron", "ArcaReadError", "assertEnabledPoint", "puntosHabilitadosCae", "leerUltimoAutorizadoWsfe", "fetch", "console", executable)(
    () => admin, { env: { get: () => "ZZ test environment" }, serve: (serve: typeof handler) => { handler = serve; } },
    async () => resolveFailure ? { error: "ZZ secret database error" } : { cred }, () => false, ReadError,
    () => { if (pointFailure) throw new ReadError("point_not_enabled", "Punto de venta no habilitado"); },
    () => (pointFailure ? [3] : [12]),
    () => 0, provider, { error: vi.fn() },
  );
});
const request = () => new Request("https://example.invalid/arca", { method: "POST", headers: { Authorization: "Bearer ZZ test" },
  body: JSON.stringify({ action: "verificar_delegacion", org_id: "zz-org" }) });

describe("actual ARCA verification handler with controlled dependencies", () => {
  it("checks CAE point and issuer class, then persists the exact connection revision without issuing", async () => {
    const response = await handler(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, environment: "homologacion", punto_venta: 12, puntos_habilitados: [12] });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[0][1].headers.SOAPAction).toContain("FEParamGetPtosVenta");
    expect(provider.mock.calls[1][1].body).toContain("<ar:CbteTipo>6</ar:CbteTipo>");
    expect(rpc).toHaveBeenCalledWith("afip_confirmar_contexto", { p_org: "zz-org", p_version: 7, p_environment: "homologacion", p_ok: true, p_detalle: null, p_revisor: null });
    expect(reads).toEqual(["memberships", "platform_admins", "afip_platform_credentials"]);
    expect(provider.mock.calls.map(call => call[1].body).join(" ")).not.toContain("FECAESolicitar");
  });
  it.each(["unauthenticated", "nonmember", "denied override"])("denies %s before any provider request", async mode => {
    if (mode === "unauthenticated") authenticated = false;
    if (mode === "nonmember") member = false;
    if (mode === "denied override") allowed = false;
    expect((await handler(request())).status).toBe(mode === "unauthenticated" ? 401 : 403);
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not expose missing configuration details", async () => {
    resolveFailure = true; const response = await handler(request());
    expect(await response.text()).not.toContain("secret"); expect(provider).not.toHaveBeenCalled();
  });
  it("does not let a merchant confirm a third-party delegation instead of requesting activation", async () => {
    platformCuit = "30712345671";
    expect((await handler(request())).status).toBe(403); expect(provider).not.toHaveBeenCalled();
  });
  it("lets real Platform staff review without granting tenant membership or requiring tenant permission", async () => {
    member = false; allowed = false; staff = "superadmin";
    const data = await (await handler(request())).json(); expect(data.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("afip_confirmar_contexto", expect.objectContaining({ p_revisor: "zz-actor" }));
    expect(reads).not.toContain("invoices");
  });
  it.each(["support", "finance"])("does not grant fiscal review to Platform %s", async role => {
    member = false; allowed = false; staff = role;
    expect((await handler(request())).status).toBe(403); expect(provider).not.toHaveBeenCalled();
  });
  it("revokes only the matching context after a rejected point, without querying the last number", async () => {
    pointFailure = true; const data = await (await handler(request())).json();
    expect(data.ok).toBe(false); expect(data.code).toBe("point_not_enabled"); expect(provider).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("afip_confirmar_contexto", expect.objectContaining({ p_version: 7, p_ok: false }));
  });
  it("does not revoke a verified connection or leak details on transient outages", async () => {
    providerFailure = "ZZ secret network failure"; const data = await (await handler(request())).json();
    expect(data.ok).toBe(false); expect(data.code).toBe("provider_unavailable"); expect(data.error).not.toContain("secret");
    expect(rpc).not.toHaveBeenCalledWith("afip_confirmar_contexto", expect.anything());
  });
  it("does not report verification if persistence fails or the configuration changed", async () => {
    for (const failure of [{ data: { ok: false, code: "configuration_changed" }, error: null }, { data: null, error: { code: "XX000", message: "ZZ secret" } }]) {
      context = failure; const data = await (await handler(request())).json(); expect(data.ok).toBe(false); expect(data.error).not.toContain("secret");
    }
  });
});
