/** Contracts for remembered devices. These are not Supabase AAL2 sessions. */
export const TRUSTED_DEVICE_ACTIONS = [
  "register", "redeem", "status", "list", "revoke", "revoke_all",
] as const;
export type TrustedDeviceAction = typeof TRUSTED_DEVICE_ACTIONS[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MFA_MAX_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export interface TrustedDeviceClaims {
  sub: string;
  session_id: string;
  role: "authenticated";
  aal: "aal1" | "aal2";
  iat: number;
  exp: number;
  amr: Array<{ method: string; timestamp: number }>;
}

/** Call only AFTER Auth has verified the JWT signature and returned this user. */
export function claimsFromVerifiedToken(
  token: string,
  verifiedUserId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedDeviceClaims | null {
  try {
    if (token.length > 16_384) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), c => c.charCodeAt(0));
    const claims = object(JSON.parse(new TextDecoder().decode(bytes)));
    if (!claims || claims.sub !== verifiedUserId || !UUID.test(verifiedUserId) ||
      typeof claims.session_id !== "string" || !UUID.test(claims.session_id) ||
      claims.role !== "authenticated" || !["aal1", "aal2"].includes(String(claims.aal)) ||
      typeof claims.iat !== "number" || !Number.isFinite(claims.iat) ||
      claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds ||
      !Array.isArray(claims.amr)) return null;

    const amr = claims.amr.flatMap(entry => {
      const method = object(entry);
      return method && typeof method.method === "string" && typeof method.timestamp === "number" &&
        Number.isFinite(method.timestamp) && method.timestamp >= 0 && method.timestamp <= nowSeconds + CLOCK_SKEW_SECONDS
        ? [{ method: method.method, timestamp: method.timestamp }]
        : [];
    });
    // Keep only the verified claims SQL actually needs; never forward user metadata.
    return {
      sub: verifiedUserId, session_id: claims.session_id, role: "authenticated",
      aal: claims.aal as "aal1" | "aal2", iat: claims.iat, exp: claims.exp, amr,
    };
  } catch {
    return null;
  }
}

export function hasFreshTotp(claims: TrustedDeviceClaims, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return claims.aal === "aal2" && claims.amr.some(entry =>
    ["totp", "mfa/totp"].includes(entry.method) &&
    entry.timestamp >= nowSeconds - MFA_MAX_AGE_SECONDS &&
    entry.timestamp <= nowSeconds + CLOCK_SKEW_SECONDS);
}

export function hasPasswordLogin(claims: TrustedDeviceClaims): boolean {
  return claims.amr.some(entry => entry.method === "password");
}

export interface TrustedDeviceCommand {
  action: TrustedDeviceAction;
  token: string | null;
  deviceId: string | null;
  label: string;
}

export function parseTrustedDeviceCommand(value: unknown): TrustedDeviceCommand | null {
  const body = object(value);
  if (!body || !TRUSTED_DEVICE_ACTIONS.includes(body.action as TrustedDeviceAction)) return null;
  if (body.token !== undefined && body.token !== null &&
    (typeof body.token !== "string" || !DEVICE_TOKEN.test(body.token))) return null;
  if (body.deviceId !== undefined && body.deviceId !== null &&
    (typeof body.deviceId !== "string" || !UUID.test(body.deviceId))) return null;
  if (body.label !== undefined && (typeof body.label !== "string" || body.label.length > 80)) return null;
  const action = body.action as TrustedDeviceAction;
  return {
    action, token: typeof body.token === "string" ? body.token : null,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
    label: typeof body.label === "string" ? body.label.trim() : "Este navegador",
  };
}

function date(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Explicit allowlist: DB/provider details and credential hashes never leave Edge. */
export function publicTrustedDeviceResult(action: TrustedDeviceAction, value: unknown): Record<string, unknown> {
  const result = object(value);
  if (!result) throw new Error("invalid_trusted_device_result");
  if (action === "list") {
    if (!Array.isArray(result.devices)) throw new Error("invalid_trusted_device_result");
    if (result.allowed === true && (!date(result.expires_at) || typeof result.device_id !== "string" || !UUID.test(result.device_id))) {
      throw new Error("invalid_trusted_device_result");
    }
    const devices = result.devices.slice(0, 20).flatMap(value => {
      const item = object(value);
      if (!item || typeof item.id !== "string" || !UUID.test(item.id)) return [];
      return [{
        id: item.id, label: typeof item.label === "string" ? item.label.slice(0, 80) : "Navegador",
        created_at: date(item.created_at), last_used_at: date(item.last_used_at),
        expires_at: date(item.expires_at), revoked_at: date(item.revoked_at),
      }];
    });
    return {
      devices, allowed: result.allowed === true, expires_at: date(result.expires_at),
      ...(typeof result.device_id === "string" && UUID.test(result.device_id) ? { device_id: result.device_id } : {}),
    };
  }
  if (action === "revoke" || action === "revoke_all") {
    return { revoked: result.revoked === true };
  }
  if (typeof result.allowed !== "boolean") throw new Error("invalid_trusted_device_result");
  const expiry = date(result.expires_at);
  if (result.allowed && !expiry) throw new Error("invalid_trusted_device_result");
  return {
    allowed: result.allowed, expires_at: expiry,
    ...(typeof result.device_id === "string" && UUID.test(result.device_id) ? { device_id: result.device_id } : {}),
  };
}

export function trustedDeviceRejection(value: unknown): { code: string; error: string; status: number } | null {
  const result = object(value);
  if (result?.allowed !== false) return null;
  const reasons: Record<string, { code: string; error: string; status: number }> = {
    invalid_session: { code: "AUTH_REQUIRED", error: "Tu sesión venció. Volvé a iniciar sesión.", status: 401 },
    fresh_mfa_required: { code: "MFA_REQUIRED", error: "Ingresá un código reciente de tu app para continuar.", status: 403 },
    mfa_required: { code: "MFA_REQUIRED", error: "Verificá tu acceso con el código de tu app para continuar.", status: 403 },
    mfa_not_enrolled: { code: "MFA_REQUIRED", error: "Configurá y verificá tu app de autenticación para recordar este navegador.", status: 403 },
    password_login_required: { code: "PASSWORD_REQUIRED", error: "Iniciá sesión con tu contraseña para usar el navegador recordado.", status: 403 },
    device_limit_reached: { code: "DEVICE_LIMIT", error: "Revocá algún navegador recordado antes de agregar otro.", status: 429 },
    invalid_credential: { code: "INVALID_REQUEST", error: "La credencial del navegador no es válida. Usá tu código de acceso.", status: 400 },
    device_required: { code: "INVALID_REQUEST", error: "Seleccioná el navegador que querés revocar.", status: 400 },
  };
  return typeof result.reason === "string" ? reasons[result.reason] ?? null : null;
}

export function randomDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashDeviceToken(token: string): Promise<string> {
  if (!DEVICE_TOKEN.test(token)) throw new Error("invalid_device_token");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
