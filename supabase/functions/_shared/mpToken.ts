/**
 * Resuelve el access token de MercadoPago de una organización.
 *
 * La única autoridad es `payment_connections` (OAuth): es renovable, vive en
 * una tabla privada y conserva la relación marketplace necesaria para cobrar
 * la comisión de Nerqia. El token pegado a mano se retiró después de medir
 * cero valores reales en `settings`.
 *
 * Los tokens viven cifrados en reposo (envelope `nerqia:v1`); se descifran sólo
 * dentro de la Edge con service_role.
 *
 * Si el token OAuth está por vencer se renueva solo: MercadoPago los vence a
 * los 180 días y, sin esto, un día los cobros dejarían de funcionar sin aviso.
 */
import { cifrarSecreto, descifrarSecreto } from "./secretos.ts";

export interface MpCredentials {
  accessToken: string;
  liveMode: boolean;
}

const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
/** Se renueva con esta anticipación al vencimiento. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

// deno-lint-ignore no-explicit-any
export async function getMpCredentials(admin: any, orgId: string): Promise<MpCredentials | null> {
  const { data: conn, error: connectionError } = await admin
    .from("payment_connections")
    .select("access_token, refresh_token, expires_at, live_mode")
    .eq("org_id", orgId)
    .eq("provider", "mercadopago")
    .maybeSingle();

  if (connectionError) throw connectionError;

  // Los tokens viven cifrados en reposo (envelope nerqia:v1): se descifran acá,
  // dentro de la Edge con service_role, y nunca en el navegador.
  const accessToken = conn?.access_token ? await descifrarSecreto(admin, conn.access_token) : null;
  const refreshToken = conn?.refresh_token ? await descifrarSecreto(admin, conn.refresh_token) : null;

  if (accessToken) {
    const venceEn = conn.expires_at ? new Date(conn.expires_at).getTime() - Date.now() : Infinity;

    if (venceEn > RENEW_BEFORE_MS || !refreshToken) {
      return { accessToken, liveMode: conn.live_mode ?? true };
    }

    // Renovación silenciosa.
    const appId = Deno.env.get("MP_APP_ID");
    const appSecret = Deno.env.get("MP_APP_SECRET");
    if (appId && appSecret) {
      try {
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: appId,
            client_secret: appSecret,
            refresh_token: refreshToken,
          }),
        });
        const tok = await res.json().catch(() => null);
        if (res.ok && tok?.access_token) {
          await admin.from("payment_connections").update({
            access_token: await cifrarSecreto(admin, tok.access_token),
            refresh_token: await cifrarSecreto(admin, tok.refresh_token ?? refreshToken),
            expires_at: new Date(Date.now() + (tok.expires_in ?? 15552000) * 1000).toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          }).eq("org_id", orgId).eq("provider", "mercadopago");
          return { accessToken: tok.access_token, liveMode: conn.live_mode ?? true };
        }
        await admin.from("payment_connections")
          .update({ last_error: "No se pudo renovar el token" })
          .eq("org_id", orgId).eq("provider", "mercadopago");
      } catch { /* se usa el token actual mientras siga siendo válido */ }
    }

    // Aunque falle la renovación, el token viejo puede seguir sirviendo.
    return { accessToken, liveMode: conn.live_mode ?? true };
  }

  return null;
}
