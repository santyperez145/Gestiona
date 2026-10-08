import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import handler, { allowedTrustOrigin, publicTrustResult, readTrustCookie, trustCookie, trustedProxyConfigured, TRUST_COOKIE } from "../../api/trusted-device";

const token = "a".repeat(43);
const deviceId = "11111111-1111-4111-8111-111111111111";
const proxySecret = "test-only-server-key-".padEnd(64, "x");
const now = Date.now();
const expires = new Date(now + 7 * 86400000).toISOString();
const request = (body = { action: "register" }, overrides: Record<string, string> = {}, host = "nerqia.app") =>
  new Request(`https://${host}/api/trusted-device`, {
    method: "POST", headers: {
      Origin: `https://${host}`, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
      Authorization: "Bearer signed.user.jwt", ...overrides,
    }, body: JSON.stringify(body),
  });

describe("first-party trusted device proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITE_SUPABASE_URL", "https://hummeopatkniwkyrrhwc.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("NERQIA_TRUST_PROXY_SECRET", proxySecret);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("rejects store domains, missing origin and cross-site requests", async () => {
    expect(allowedTrustOrigin(request(undefined, {}, "merchant.nerqia.app"))).toBe(false);
    expect(allowedTrustOrigin(request(undefined, { Origin: "https://merchant.nerqia.app" }))).toBe(false);
    expect(allowedTrustOrigin(request(undefined, { "Sec-Fetch-Site": "same-site" }))).toBe(false);
    const response = await handler(request(undefined, { Origin: "https://attacker.test" }));
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed if the server-only key is absent or unsuitable for the private hop", async () => {
    vi.stubEnv("NERQIA_TRUST_PROXY_SECRET", "");
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(trustedProxyConfigured("short")).toBe(false);
    expect(trustedProxyConfigured(`${proxySecret}\n`)).toBe(false);
    expect(trustedProxyConfigured(proxySecret)).toBe(true);
  });

  it("does not require or forward a private key supplied by the browser", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ allowed: false })));
    expect((await handler(request({ action: "status" }))).status).toBe(200);
    expect((await handler(request({ action: "status" }, { "X-Nerqia-Trust-Proxy": "forged" }))).status).toBe(200);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options!.headers).toHaveProperty("X-Nerqia-Trust-Proxy", proxySecret);
    }
  });

  it("creates a host-only secure cookie, never a JSON/storage secret", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ allowed: true, expires_at: expires, device_id: deviceId, token, secret: "leak", token_hash: "hash" })));
    const response = await handler(request());
    const json = await response.json();
    expect(json).toEqual({ trusted: true, expiresAt: expires, currentDeviceId: deviceId });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${TRUST_COOKIE}=${token}`);
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(cookie).not.toContain("Domain=");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options!.headers).not.toHaveProperty("Origin");
    expect(options!.headers).toHaveProperty("X-Nerqia-Trust-Proxy", proxySecret);
  });

  it("redeems only the HttpOnly cookie, ignores a browser-supplied token", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ allowed: true, expires_at: expires })));
    const response = await handler(request({ action: "redeem", token: "forged" } as never, { Cookie: `${TRUST_COOKIE}=${token}` }));
    expect(response.status).toBe(200);
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(options!.body)).token).toBe(token);
    expect(response.headers.get("set-cookie")).toBeNull(); // No sliding extension on a new login.
  });

  it("clears an expired credential and current-device revocation", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ allowed: false })));
    const response = await handler(request({ action: "redeem" }, { Cookie: `${TRUST_COOKIE}=${token}` }));
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ allowed: false })));
    expect((await handler(request({ action: "revoke_all" }))).headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("fails closed on backend faults and strips private errors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "postgres private credential failure", token }), { status: 500 }));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "TRUST_UNAVAILABLE" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not create an empty or invalid trust cookie on provider success", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ allowed: true, expires_at: expires, token: "invalid" })));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("limits cookie lifetime to seven days and rejects expired values", () => {
    expect(trustCookie(token, expires, now)).toContain("Max-Age=604800");
    expect(() => trustCookie(token, new Date(now).toISOString(), now)).toThrow();
    expect(readTrustCookie(`${TRUST_COOKIE}=${token}; ${TRUST_COOKIE}=${token}`)).toBeNull();
    expect(readTrustCookie(`${TRUST_COOKIE}=bad%0A`)).toBeNull();
    expect(readTrustCookie(`other=x; ${TRUST_COOKIE}=${token}`)).toBe(token);
  });

  it("whitelists safe device metadata only", () => {
    expect(publicTrustResult({ allowed: false, devices: [{ id: deviceId, label: "Equipo", created_at: expires, last_used_at: expires, expires_at: expires, token_hash: "hidden", user_id: "hidden" }] }))
      .toEqual({ trusted: false, devices: [{ id: deviceId, label: "Equipo", createdAt: expires, lastUsedAt: expires, expiresAt: expires }] });
  });
});
