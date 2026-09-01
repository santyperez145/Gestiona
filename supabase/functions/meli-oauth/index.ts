/**
 * meli-oauth — conecta una organización con MercadoLibre.
 *
 * Acciones (campo `action` del body):
 *   connect     → canjea el `code` del redirect por tokens y guarda la conexión
 *   refresh     → renueva el access_token con el refresh_token
 *   disconnect  → borra la conexión
 *
 * Los tokens se escriben con service_role en `meli_connections`, una tabla con
 * RLS y sin policies: nunca llegan al navegador. La UI lee la vista
 * `meli_connection_status`, que no los expone.
 *
 * Requiere estos secretos de Edge Function:
 *   MELI_CLIENT_ID, MELI_CLIENT_SECRET, MELI_REDIRECT_URI
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MELI_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

interface MeliTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  scope?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Cliente con el JWT del usuario: sirve para saber quién llama y validar rol.
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userRes } = await asUser.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "No autenticado" }, 401);

    const { action, code, orgId } = await req.json();
    if (!orgId) return json({ error: "orgId es requerido" }, 400);

    // Solo owner/admin de esa organización pueden tocar la conexión.
    const { data: membership } = await asUser
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Necesitás ser administrador de esta organización" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // ── disconnect ────────────────────────────────────────────────────────
    if (action === "disconnect") {
      await admin.from("meli_connections").delete().eq("org_id", orgId);
      return json({ ok: true });
    }

    const clientId = requireEnv("MELI_CLIENT_ID");
    const clientSecret = requireEnv("MELI_CLIENT_SECRET");

    let payload: Record<string, string>;

    if (action === "refresh") {
      const { data: conn } = await admin
        .from("meli_connections")
        .select("refresh_token")
        .eq("org_id", orgId)
        .maybeSingle();
      if (!conn?.refresh_token) return json({ error: "No hay conexión para renovar" }, 400);
      payload = {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
      };
    } else {
      if (!code) return json({ error: "code es requerido" }, 400);
      payload = {
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: requireEnv("MELI_REDIRECT_URI"),
      };
    }

    const tokenRes = await fetch(MELI_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(payload),
    });

    const body = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !body?.access_token) {
      const msg = body?.message ?? body?.error ?? `HTTP ${tokenRes.status}`;
      await admin.from("meli_connections").upsert(
        { org_id: orgId, last_error: String(msg).slice(0, 500), updated_at: new Date().toISOString() },
        { onConflict: "org_id" },
      );
      return json({ error: `MercadoLibre rechazó la solicitud: ${msg}` }, 400);
    }

    const tok = body as MeliTokenResponse;

    // Nombre de la cuenta, para que la UI muestre con cuál quedó conectada.
    let nickname: string | null = null;
    let siteId = "MLA";
    try {
      const meRes = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        nickname = me?.nickname ?? null;
        siteId = me?.site_id ?? "MLA";
      }
    } catch { /* accesorio */ }

    const { error: upErr } = await admin.from("meli_connections").upsert(
      {
        org_id: orgId,
        meli_user_id: tok.user_id,
        nickname,
        site_id: siteId,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: new Date(Date.now() + (tok.expires_in ?? 21600) * 1000).toISOString(),
        scopes: tok.scope ?? null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    if (upErr?.code === "23505") {
      return json({ error: "Esta cuenta de MercadoLibre ya está conectada a otra organización. Desconectala primero para no mezclar stock ni órdenes." }, 409);
    }
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, nickname, site_id: siteId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
