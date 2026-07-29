/**
 * mp-connect — conecta la cuenta de MercadoPago de un comercio por OAuth.
 *
 * Modelo de plataforma, igual que Tiendanube o Empretienda: existe UNA
 * aplicación (la nuestra) y cada comercio autoriza su propia cuenta con un
 * clic. Nunca vemos sus credenciales: recibimos un token delegado que el
 * comercio puede revocar desde MercadoPago cuando quiera.
 *
 * Acciones:
 *   start      → devuelve la URL de autorización con un `state` anti-CSRF
 *   callback    → canjea el `code` por tokens y guarda la conexión
 *   refresh     → renueva el token (MP los vence a los 180 días)
 *   disconnect  → borra la conexión
 *
 * Secretos requeridos:
 *   MP_APP_ID, MP_APP_SECRET, MP_OAUTH_REDIRECT_URI
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const AUTH_URL = "https://auth.mercadopago.com.ar/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";

interface MpToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  public_key?: string;
  live_mode?: boolean;
  scope?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userRes } = await asUser.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "No autenticado" }, 401);

    const { action, orgId, code, state, returnUrl } = await req.json();
    if (!orgId) return json({ error: "orgId es requerido" }, 400);

    // Solo owner/admin pueden tocar el cobro de la organización.
    const { data: membership } = await asUser
      .from("memberships").select("role")
      .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Necesitás ser administrador de esta organización" }, 403);
    }

    // ── disconnect ────────────────────────────────────────────────────────
    if (action === "disconnect") {
      await admin.from("payment_connections")
        .delete().eq("org_id", orgId).eq("provider", "mercadopago");
      return json({ ok: true });
    }

    const appId = requireEnv("MP_APP_ID");
    const appSecret = requireEnv("MP_APP_SECRET");
    const redirectUri = requireEnv("MP_OAUTH_REDIRECT_URI");

    // ── start ─────────────────────────────────────────────────────────────
    if (action === "start") {
      // `state` de un solo uso: al volver verificamos que el flujo lo inició
      // esta app para esta organización. Sin esto, alguien podría inducir a un
      // comercio a conectar una cuenta ajena.
      const st = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await admin.from("oauth_states").insert({
        state: st, org_id: orgId, provider: "mercadopago",
        user_id: userId, redirect_to: returnUrl ?? null,
      });
      await admin.rpc("purge_expired_oauth_states");

      const url = `${AUTH_URL}?client_id=${encodeURIComponent(appId)}` +
        `&response_type=code&platform_id=mp` +
        `&state=${encodeURIComponent(st)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}`;
      return json({ url });
    }

    // ── callback ──────────────────────────────────────────────────────────
    if (action === "callback") {
      if (!code || !state) return json({ error: "code y state son requeridos" }, 400);

      const { data: st } = await admin
        .from("oauth_states").select("*").eq("state", state).maybeSingle();

      if (!st || st.org_id !== orgId || st.provider !== "mercadopago") {
        return json({ error: "El estado de la conexión no es válido. Volvé a intentar." }, 400);
      }
      if (new Date(st.expires_at).getTime() < Date.now()) {
        await admin.from("oauth_states").delete().eq("state", state);
        return json({ error: "La conexión expiró. Volvé a intentar." }, 400);
      }
      // De un solo uso.
      await admin.from("oauth_states").delete().eq("state", state);

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: appId,
          client_secret: appSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tok = await res.json().catch(() => null) as MpToken | null;

      if (!res.ok || !tok?.access_token) {
        const msg = (tok as any)?.message ?? (tok as any)?.error ?? `HTTP ${res.status}`;
        return json({ error: `MercadoPago rechazó la conexión: ${msg}` }, 400);
      }

      // Datos de la cuenta, para mostrar con cuál quedó vinculada.
      let nickname: string | null = null;
      let email: string | null = null;
      try {
        const me = await fetch("https://api.mercadopago.com/users/me", {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        if (me.ok) {
          const u = await me.json();
          nickname = u?.nickname ?? null;
          email = u?.email ?? null;
        }
      } catch { /* accesorio */ }

      const { error: upErr } = await admin.from("payment_connections").upsert({
        org_id: orgId,
        provider: "mercadopago",
        external_id: String(tok.user_id),
        nickname, email,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        public_key: tok.public_key ?? null,
        expires_at: new Date(Date.now() + (tok.expires_in ?? 15552000) * 1000).toISOString(),
        scopes: tok.scope ?? null,
        live_mode: tok.live_mode ?? true,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id,provider" });
      if (upErr) return json({ error: upErr.message }, 500);

      // `settings.mp_enabled` sigue siendo el interruptor que mira el resto de
      // la app, así que se enciende al conectar.
      await admin.from("settings").update({ mp_enabled: true }).eq("org_id", orgId);

      return json({ ok: true, nickname, email, live_mode: tok.live_mode ?? true });
    }

    // ── refresh ───────────────────────────────────────────────────────────
    if (action === "refresh") {
      const { data: conn } = await admin
        .from("payment_connections").select("refresh_token")
        .eq("org_id", orgId).eq("provider", "mercadopago").maybeSingle();
      if (!conn?.refresh_token) return json({ error: "No hay conexión para renovar" }, 400);

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
      const tok = await res.json().catch(() => null) as MpToken | null;
      if (!res.ok || !tok?.access_token) {
        const msg = (tok as any)?.message ?? `HTTP ${res.status}`;
        await admin.from("payment_connections")
          .update({ last_error: String(msg).slice(0, 500) })
          .eq("org_id", orgId).eq("provider", "mercadopago");
        return json({ error: `No se pudo renovar: ${msg}` }, 400);
      }

      await admin.from("payment_connections").update({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? conn.refresh_token,
        expires_at: new Date(Date.now() + (tok.expires_in ?? 15552000) * 1000).toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("org_id", orgId).eq("provider", "mercadopago");

      return json({ ok: true });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    console.error("mp-connect error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
