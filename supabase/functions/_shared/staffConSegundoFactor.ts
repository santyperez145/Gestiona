/**
 * El staff de plataforma opera con segundo factor (2026-11-05).
 *
 * El staff ve y opera sobre todos los comercios. Hasta hoy alcanzaba la
 * contraseña: el MFA se pedía en el panel, pero una sesión AAL1 llamaba a la
 * API igual. La base ya rechaza a un staff AAL1 en is_platform_admin /
 * has_platform_role (20261105000800); las funciones que verifican el rol con
 * la llave de servicio no pasan por esa sesión y usan esto.
 *
 * Llamar sólo DESPUÉS de que Auth verificó el token (getUser / requireUser).
 */
import { claimsFromVerifiedToken } from "./trustedDevice.ts";

export function sesionConSegundoFactor(req: Request, verifiedUserId: string): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const claims = claimsFromVerifiedToken(token, verifiedUserId);
  return claims?.aal === "aal2";
}

export const MENSAJE_SIN_SEGUNDO_FACTOR =
  "Para operar como staff de plataforma tenés que entrar con el segundo factor (código de tu app).";
