import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  claimsFromVerifiedToken, hasFreshTotp, hasPasswordLogin, hashDeviceToken,
  parseTrustedDeviceCommand, publicTrustedDeviceResult, randomDeviceToken, trustedDeviceRejection,
} from "../../supabase/functions/_shared/trustedDevice";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SESSION = "00000000-0000-4000-8000-000000000003";
const NOW = 1_797_120_000;
const payload = () => ({
  sub: USER, session_id: SESSION, role: "authenticated", aal: "aal2",
  iat: NOW - 10, exp: NOW + 3600,
  amr: [{ method: "totp", timestamp: NOW - 10 }, { method: "password", timestamp: NOW - 20 }],
});
// A synthetic transport payload, not a signed JWT: the helper is called only
// after Auth independently validates the real signature in the Edge handler.
const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

afterEach(() => vi.unstubAllGlobals());

describe("contrato de navegador recordado", () => {
  it("binds verified identity and session; rejects expiry, missing SID and service role", () => {
    expect(claimsFromVerifiedToken(token(payload()), USER, NOW)?.session_id).toBe(SESSION);
    expect(claimsFromVerifiedToken(token(payload()), OTHER, NOW)).toBeNull();
    for (const change of [
      { session_id: undefined }, { session_id: "not-a-session" },
      { role: "service_role" }, { exp: NOW }, { aal: "invented" }, { amr: undefined },
    ]) {
      expect(claimsFromVerifiedToken(token({ ...payload(), ...change }), USER, NOW)).toBeNull();
    }
    expect(claimsFromVerifiedToken("not.a.jwt", USER, NOW)).toBeNull();
  });

  it("allows fresh native TOTP, never AAL1, missing timestamps or expired MFA", () => {
    for (const method of ["totp", "mfa/totp"]) {
      const claims = claimsFromVerifiedToken(token({ ...payload(), amr: [{ method, timestamp: NOW - 300 }] }), USER, NOW)!;
      expect(hasFreshTotp(claims, NOW)).toBe(true);
      expect(hasFreshTotp({ ...claims, aal: "aal1" }, NOW)).toBe(false);
    }
    for (const amr of [
      [{ method: "totp", timestamp: NOW - 301 }], [{ method: "totp" }],
      ["totp"], [{ method: "totp", timestamp: NOW + 31 }],
      [{ method: "oauth", timestamp: NOW - 1 }],
    ]) {
      const claims = claimsFromVerifiedToken(token({ ...payload(), amr }), USER, NOW)!;
      expect(hasFreshTotp(claims, NOW)).toBe(false);
    }
  });

  it("requires password authentication from signed AMR; does not trust body flags", () => {
    const claims = claimsFromVerifiedToken(token(payload()), USER, NOW)!;
    expect(hasPasswordLogin(claims)).toBe(true);
    expect(hasPasswordLogin({ ...claims, amr: [{ method: "magiclink", timestamp: NOW }] })).toBe(false);
    expect(parseTrustedDeviceCommand({ action: "redeem", user_id: OTHER, fresh_mfa: true, aal: "aal2" })).toEqual({
      action: "redeem", token: null, deviceId: null, label: "Este navegador",
    });
    expect(claims).not.toHaveProperty("user_metadata");
  });

  it("rejects bad commands/credentials instead of treating arbitrary text as trust", () => {
    for (const body of [null, [], { action: "anything" }, { action: "register", token: "true" },
      { action: "register", label: "x".repeat(81) }, { action: "revoke", deviceId: "x" }]) {
      expect(parseTrustedDeviceCommand(body)).toBeNull();
    }
    expect(parseTrustedDeviceCommand({ action: "revoke", deviceId: SESSION })?.deviceId).toBe(SESSION);
    expect(parseTrustedDeviceCommand({ action: "revoke" })?.deviceId).toBeNull();
  });

  it("generates 256-bit credentials and sends only a deterministic SHA-256 digest to SQL", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const first = randomDeviceToken();
    const second = randomDeviceToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    const digest = await hashDeviceToken(first);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(first);
    expect(await hashDeviceToken(first)).toBe(digest);
    expect(await hashDeviceToken(second)).not.toBe(digest);
    await expect(hashDeviceToken("invalid")).rejects.toThrow("invalid_device_token");
  });

  it("strips raw tokens, hashes, user identity and provider details from every public result", () => {
    const sensitive = { token: "secret", token_hash: "hash", user_id: OTHER, password: "password", details: "SQL" };
    const expiry = "2026-10-11T12:00:00.000Z";
    for (const action of ["register", "redeem", "status"] as const) {
      expect(publicTrustedDeviceResult(action, { ...sensitive, allowed: true, expires_at: expiry, device_id: SESSION }))
        .toEqual({ allowed: true, expires_at: expiry, device_id: SESSION });
    }
    expect(publicTrustedDeviceResult("list", { ...sensitive, devices: [{ ...sensitive, id: SESSION, label: "Mi PC", expires_at: expiry }] }))
      .toEqual({ devices: [{ id: SESSION, label: "Mi PC", expires_at: expiry, created_at: null, last_used_at: null, revoked_at: null }], allowed: false, expires_at: null });
    expect(publicTrustedDeviceResult("revoke", { ...sensitive, revoked: true })).toEqual({ revoked: true });
    expect(publicTrustedDeviceResult("revoke_all", { ...sensitive, revoked: true })).toEqual({ revoked: true });
    expect(publicTrustedDeviceResult("list", { devices: [], allowed: true, expires_at: expiry, device_id: SESSION, ...sensitive }))
      .toEqual({ devices: [], allowed: true, expires_at: expiry, device_id: SESSION });
  });

  it("maps denied commands to safe specific errors without returning SQL/provider details", () => {
    for (const [reason, code] of [
      ["invalid_session", "AUTH_REQUIRED"], ["fresh_mfa_required", "MFA_REQUIRED"],
      ["mfa_required", "MFA_REQUIRED"], ["password_login_required", "PASSWORD_REQUIRED"],
      ["device_limit_reached", "DEVICE_LIMIT"], ["device_required", "INVALID_REQUEST"],
    ]) {
      const rejection = trustedDeviceRejection({ allowed: false, reason, details: "private SQL", token: "secret" });
      expect(rejection?.code).toBe(code);
      expect(JSON.stringify(rejection)).not.toMatch(/private SQL|secret/);
    }
    expect(trustedDeviceRejection({ allowed: false, reason: "device_not_trusted" })).toBeNull();
  });

  it("fails closed on malformed database outcomes", () => {
    expect(() => publicTrustedDeviceResult("status", null)).toThrow();
    expect(() => publicTrustedDeviceResult("status", { allowed: "true" })).toThrow();
    expect(() => publicTrustedDeviceResult("status", { allowed: true, expires_at: null })).toThrow();
    expect(() => publicTrustedDeviceResult("list", { devices: "all" })).toThrow();
    expect(publicTrustedDeviceResult("status", { allowed: false })).toEqual({ allowed: false, expires_at: null });
  });
});
