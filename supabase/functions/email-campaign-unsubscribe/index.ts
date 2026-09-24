/**
 * unsubscribe-email-campaign — link público de baja para campañas.
 *
 * La URL que se inyecta en el footer de cada mail de campaña es
 * `${SUPABASE_URL}/functions/v1/email-campaign-unsubscribe?token=...`.
 * Es pública porque llega en un mail a un contacto sin sesión, y valida el
 * token contra el RPC `process_email_campaign_unsubscribe` (idempotente).
 *
 * GET  → página mínima de confirmación (HTML, sin infraestructura expuesta).
 * POST → RFC 8058 one-click (List-Unsubscribe-Post), sólo el token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, list-unsubscribe",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const html = (body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Baja de campañas</title>` +
    `<style>body{font-family:system-ui,sans-serif;background:#f5f6f8;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}` +
    `main{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px;max-width:440px;text-align:center}` +
    `h1{font-size:20px;margin:0 0 12px}p{color:#555;line-height:1.6;margin:0 0 16px;font-size:14px}` +
    `button{background:#173aef;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}` +
    `a{color:#173aef}</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return html("<h1>Falta el enlace de baja</h1><p>El enlace no trae el código de baja. Reenvialo desde el mail original.</p>", 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const ua = req.headers.get("user-agent") || null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // GET sin confirmación → página de confirmación. El usuario tiene que hacer
  // click en un botón: cualquier prefetch de cliente de correo no da de baja
  // sin intención. POST directo (RFC 8058) baja sin página.
  const confirmarDirecto =
    req.method === "POST" || url.searchParams.get("confirmar") === "1";

  if (!confirmarDirecto) {
    return html(
      `<h1>Cancelar suscripción</h1>` +
      `<p>Vas a dejar de recibir campañas por email de este comercio. Los avisos de tus pedidos siguen llegando normalmente.</p>` +
      `<form method="POST" action="?token=${encodeURIComponent(token)}">` +
      `<input type="hidden" name="token" value="${token}">` +
      `<button type="submit">Confirmar baja</button></form>` +
      `<p style="font-size:12px;margin-top:16px"><a href="/">Ir al sitio</a></p>`,
    );
  }

  const { data, error } = await admin.rpc("process_email_campaign_unsubscribe", {
    p_token: token,
    p_user_agent: ua,
    p_ip: ip,
  });

  if (error) {
    console.error("email-campaign-unsubscribe rpc:", error);
    return html("<h1>No pudimos procesar la baja</h1><p>Probá de nuevo en unos minutos; si sigue fallando, avisá al comercio.</p>", 500);
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string; email?: string };
  if (!result.ok) {
    const motivo = result.error === "token_expired"
      ? "El enlace venció. Pedile al comercio que te reenvíe la campaña."
      : "El enlace no es válido o ya fue usado.";
    return html(`<h1>Enlace no válido</h1><p>${motivo}</p>`, 404);
  }

  return json({
    ok: true,
    email: result.email ?? null,
    message: "Dada de baja de campañas de email.",
  });
});