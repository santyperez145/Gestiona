/**
 * Resuelve el access token de MercadoPago de una organización.
 *
 * Orden de preferencia:
 *   1. `payment_connections` (OAuth) — el camino nuevo, renovable.
 *   2. `settings.mp_access_token` — el token pegado a mano, para no romper a
 *      los comercios que ya lo tenían configurado antes del OAuth.
 *
 * Si el token OAuth está por vencer se renueva solo: MercadoPago los vence a
 * los 180 días y, sin esto, un día los cobros dejarían de funcionar sin aviso.
 */
export interface MpCredentials {
  accessToken: string;
  /** De dónde salió, para poder diagnosticar. */
  source: "oauth" | "legacy";
  liveMode: boolean;
}

const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
/** Se renueva con esta anticipación al vencimiento. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

// deno-lint-ignore no-explicit-any
export async function getMpCredentials(admin: any, orgId: string): Promise<MpCredentials | null> {
  const { data: conn } = await admin
    .from("payment_connections")
    .select("access_token, refresh_token, expires_at, live_mode")
    .eq("org_id", orgId)
    .eq("provider", "mercadopago")
    .maybeSingle();

  if (conn?.access_token) {
    const venceEn = conn.expires_at ? new Date(conn.expires_at).getTime() - Date.now() : Infinity;

    if (venceEn > RENEW_BEFORE_MS || !conn.refresh_token) {
      return { accessToken: conn.access_token, source: "oauth", liveMode: conn.live_mode ?? true };
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
            refresh_token: conn.refresh_token,
          }),
        });
        const tok = await res.json().catch(() => null);
        if (res.ok && tok?.access_token) {
          await admin.from("payment_connections").update({
            access_token: tok.access_token,
            refresh_token: tok.refresh_token ?? conn.refresh_token,
            expires_at: new Date(Date.now() + (tok.expires_in ?? 15552000) * 1000).toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          }).eq("org_id", orgId).eq("provider", "mercadopago");
          return { accessToken: tok.access_token, source: "oauth", liveMode: conn.live_mode ?? true };
        }
        await admin.from("payment_connections")
          .update({ last_error: "No se pudo renovar el token" })
          .eq("org_id", orgId).eq("provider", "mercadopago");
      } catch { /* se usa el token actual mientras siga siendo válido */ }
    }

    // Aunque falle la renovación, el token viejo puede seguir sirviendo.
    return { accessToken: conn.access_token, source: "oauth", liveMode: conn.live_mode ?? true };
  }

  // ── Compatibilidad: token pegado a mano ────────────────────────────────
  const { data: settings } = await admin
    .from("settings")
    .select("mp_access_token, mp_enabled")
    .eq("org_id", orgId)
    .maybeSingle();

  if (settings?.mp_enabled && settings?.mp_access_token) {
    return { accessToken: settings.mp_access_token, source: "legacy", liveMode: true };
  }

  return null;
}
