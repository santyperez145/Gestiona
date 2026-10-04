import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  claimsFromVerifiedToken, hasFreshTotp, hasPasswordLogin, hashDeviceToken,
  parseTrustedDeviceCommand, publicTrustedDeviceResult, randomDeviceToken, trustedDeviceRejection,
} from "../_shared/trustedDevice.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function failure(code: string, error: string, status: number): Response {
  return json({ code, error }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // This is a backend-to-backend transport. Only the first-party proxy may
  // deliver credentials to a cookie; no browser CORS or readable secret API.
  if (req.headers.has("Origin")) return failure("ORIGIN_NOT_ALLOWED", "Usá el acceso de Nerqia para continuar.", 403);
  if (req.method !== "POST") return failure("INVALID_REQUEST", "Esta operación requiere una solicitud de acceso válida.", 405);
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return failure("INVALID_REQUEST", "La solicitud de acceso no tiene un formato válido.", 415);
  }
  if (Number(req.headers.get("Content-Length") ?? 0) > 4096) {
    return failure("INVALID_REQUEST", "La solicitud de acceso es demasiado grande.", 413);
  }
  const bearer = req.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9._-]+)$/i)?.[1];
  if (!bearer || bearer.length > 16_384) return failure("AUTH_REQUIRED", "Iniciá sesión para verificar este navegador.", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return failure("TRUST_UNAVAILABLE", "No pudimos verificar el navegador. Podés ingresar con tu código.", 503);

  try {
    const text = await req.text();
    if (text.length > 4096) return failure("INVALID_REQUEST", "La solicitud de acceso es demasiado grande.", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return failure("INVALID_REQUEST", "La solicitud de acceso no es válida.", 400); }
    const command = parseTrustedDeviceCommand(body);
    if (!command) return failure("INVALID_REQUEST", "Revisá la operación de seguridad solicitada.", 400);

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Auth validates the signature/expiry. Only then may we read signed claims;
    // never substitute claims, user ID, or an AAL flag supplied in JSON.
    const { data: { user }, error: userError } = await admin.auth.getUser(bearer);
    if (userError || !user?.id) return failure("AUTH_REQUIRED", "Tu sesión venció. Volvé a iniciar sesión.", 401);
    const claims = claimsFromVerifiedToken(bearer, user.id);
    if (!claims) return failure("AUTH_REQUIRED", "No pudimos validar tu sesión. Volvé a iniciar sesión.", 401);

    if (command.action === "register") {
      const liveTotp = user.factors?.some(factor => factor.status === "verified" && factor.factor_type === "totp");
      if (!hasFreshTotp(claims) || !liveTotp) {
        return failure("MFA_REQUIRED", "Ingresá un código reciente de tu app para recordar este navegador.", 403);
      }
    }
    if (command.action === "redeem") {
      if (!hasPasswordLogin(claims)) {
        return failure("PASSWORD_REQUIRED", "Iniciá sesión con tu contraseña para usar el navegador recordado.", 403);
      }
      if (!command.token) return json({ allowed: false, expires_at: null });
    }

    const newToken = command.action === "register" ? randomDeviceToken() : null;
    const [tokenHash, newTokenHash] = await Promise.all([
      command.token ? hashDeviceToken(command.token) : Promise.resolve(null),
      newToken ? hashDeviceToken(newToken) : Promise.resolve(null),
    ]);
    const { data, error } = await admin.rpc("trusted_device_command", {
      p_action: command.action, p_claims: claims, p_token_hash: tokenHash,
      p_new_token_hash: newTokenHash, p_device_id: command.deviceId, p_label: command.label,
    });
    if (error) {
      // Log only operation and machine code, never request/claims/credentials
      // or a provider message that may include SQL parameter values.
      console.error("trusted-device command failed", { action: command.action, code: error.code ?? "unknown" });
      if (error.code === "42501") {
        return failure("MFA_REQUIRED", "Verificá tu acceso con un código reciente e intentá nuevamente.", 403);
      }
      if (error.code === "22023" || error.code === "23514") {
        return failure("INVALID_REQUEST", "La operación de seguridad no es válida. Revisala e intentá nuevamente.", 400);
      }
      return failure("TRUST_UNAVAILABLE", "No pudimos verificar el navegador. Podés ingresar con tu código.", 503);
    }
    const rejection = trustedDeviceRejection(data);
    if (rejection) return failure(rejection.code, rejection.error, rejection.status);
    const result = publicTrustedDeviceResult(command.action, data);
    // Raw random credential only crosses this server transport once. The
    // first-party proxy must strip it and set a Secure HttpOnly host-only cookie.
    return json({ ...result, ...(newToken && result.allowed === true ? { token: newToken } : {}) });
  } catch {
    console.error("trusted-device transport failed");
    return failure("TRUST_UNAVAILABLE", "No pudimos verificar el navegador. Podés ingresar con tu código.", 503);
  }
});
