/** First-party cookie boundary. The browser never receives the device secret. */
export const config = { runtime: "edge" };

export const TRUST_COOKIE = "__Host-nerqia-mfa-device";
const ACTIONS = new Set(["register", "redeem", "status", "list", "revoke", "revoke_all"]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Origin, Cookie, Authorization",
  "X-Robots-Tag": "noindex, nofollow",
};

function reply(body: unknown, status = 200, cookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...PRIVATE_HEADERS, ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });
}

export function readTrustCookie(header: string | null): string | null {
  const values = (header ?? "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${TRUST_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(TRUST_COOKIE.length + 1);
  return TOKEN.test(value) ? value : null;
}

export function trustCookie(value: string, expiresAt: string, now = Date.now()): string {
  const remaining = Math.min(604800, Math.floor((Date.parse(expiresAt) - now) / 1000));
  if (!TOKEN.test(value) || !Number.isFinite(remaining) || remaining <= 0) throw new Error("Invalid trust credential");
  return `${TRUST_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${remaining}; Expires=${new Date(expiresAt).toUTCString()}`;
}

const clearCookie = () => `${TRUST_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export function allowedTrustOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Never share credentials with merchant subdomains or custom storefronts.
  const knownHost = url.hostname === "nerqia.app" || url.hostname === process.env.VERCEL_URL;
  return (local || (knownHost && url.protocol === "https:"))
    && request.headers.get("Origin") === url.origin
    && !["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site") ?? "");
}

export function trustedProxyConfigured(secret = process.env.NERQIA_TRUST_PROXY_SECRET ?? ""): boolean {
  // This key belongs to the Vercel -> Edge hop, never to a browser request.
  return secret.length >= 32 && secret.length <= 4096 && /^[\x21-\x7e]+$/.test(secret);
}

/** Whitelist the response rather than spreading upstream JSON (which can contain token). */
export function publicTrustResult(data: Record<string, unknown>) {
  return {
    trusted: data.allowed === true,
    ...(typeof data.expires_at === "string" ? { expiresAt: data.expires_at } : {}),
    ...(typeof data.device_id === "string" && UUID.test(data.device_id) ? { currentDeviceId: data.device_id } : {}),
    ...(Array.isArray(data.devices) ? {
      devices: data.devices.slice(0, 20).map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""), label: String(item.label ?? "Navegador").slice(0, 80),
        createdAt: String(item.created_at ?? ""), lastUsedAt: String(item.last_used_at ?? ""),
        expiresAt: String(item.expires_at ?? ""),
      })),
    } : {}),
  };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (!allowedTrustOrigin(request)) return reply({ code: "ORIGIN_NOT_ALLOWED" }, 403);
  if (!trustedProxyConfigured()) return reply({ code: "TRUST_UNAVAILABLE" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) || authorization.length > 12000) {
    return reply({ code: "AUTH_REQUIRED" }, 401);
  }
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return reply({ code: "INVALID_REQUEST" }, 400);
  let body: { action?: string; deviceId?: string };
  try {
    const text = await request.text();
    if (text.length > 2048) return reply({ code: "INVALID_REQUEST" }, 413);
    body = JSON.parse(text);
    if (!body || !ACTIONS.has(body.action ?? "") || (body.deviceId && !UUID.test(body.deviceId))) throw new Error("Invalid action");
  } catch {
    return reply({ code: "INVALID_REQUEST" }, 400);
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl) || !supabaseKey) return reply({ code: "TRUST_UNAVAILABLE" }, 503);
  const token = readTrustCookie(request.headers.get("Cookie"));
  try {
    const upstream = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/trusted-device`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: supabaseKey,
        "Content-Type": "application/json",
        "X-Nerqia-Trust-Proxy": process.env.NERQIA_TRUST_PROXY_SECRET ?? "",
      },
      body: JSON.stringify({ action: body.action, deviceId: body.deviceId, token, label: "Navegador recordado" }),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    const data = await upstream.json() as Record<string, unknown>;
    if (!upstream.ok) {
      const safeCodes = new Set(["AUTH_REQUIRED", "MFA_REQUIRED", "PASSWORD_REQUIRED", "TRUST_UNAVAILABLE", "INVALID_REQUEST", "RATE_LIMITED", "DEVICE_LIMIT"]);
      const code = safeCodes.has(String(data.code)) ? String(data.code) : "TRUST_UNAVAILABLE";
      return reply({ code }, [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 503);
    }
    const result = publicTrustResult(data);
    let cookie: string | undefined;
    if (body.action === "register") {
      if (!result.trusted || typeof data.token !== "string" || !result.expiresAt) return reply({ code: "TRUST_UNAVAILABLE" }, 503);
      cookie = trustCookie(data.token, result.expiresAt);
    } else if (body.action === "revoke_all" || (body.action === "revoke" && !body.deviceId)) {
      cookie = clearCookie();
    } else if (["redeem", "status"].includes(body.action!) && !result.trusted && token) {
      cookie = clearCookie();
    }
    return reply(result, 200, cookie);
  } catch {
    // Do not log Request/Response: they carry session and device credentials.
    console.error("trusted-device: upstream unavailable");
    return reply({ code: "TRUST_UNAVAILABLE" }, 503);
  }
}
