/**
 * drip-unsubscribe — Public endpoint for one-click unsubscribe from drip campaigns.
 *
 * Routes:
 *   GET  /functions/v1/drip-unsubscribe?token=...   → confirmation HTML page
 *   POST /functions/v1/drip-unsubscribe             → RFC 8058 one-click
 *                                                     (body: List-Unsubscribe=One-Click)
 *
 * Both call the `process_drip_unsubscribe` RPC.
 *
 * This function is intentionally public (no JWT required) because email
 * recipients must be able to opt-out without logging in. The RPC uses
 * security definer + token-based auth (90-day expiry).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function htmlPage(title: string, body: string, ok = true) {
  const accent = ok ? "#10b981" : "#ef4444";
  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0b0d12; color:#e2e8f0; margin:0; padding:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:#11141b; border:1px solid #1f2532; border-radius:12px; padding:36px 32px; max-width:420px; text-align:center; box-shadow:0 8px 32px rgba(0,0,0,.3); }
  .icon { width:48px; height:48px; border-radius:50%; background:${accent}1a; color:${accent}; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:24px; }
  h1 { font-size:18px; margin:0 0 10px; font-weight:600; color:#f1f5f9; }
  p { font-size:14px; line-height:1.55; color:#94a3b8; margin:0 0 8px; }
  .email { color:${accent}; font-weight:500; }
  .small { font-size:12px; color:#64748b; margin-top:18px; }
</style></head>
<body>
  <div class="card">
    <div class="icon">${ok ? "✓" : "!"}</div>
    <h1>${title}</h1>
    ${body}
    <p class="small">Si recibís este email por error, podés ignorarlo. Este enlace es válido durante 90 días.</p>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const url = new URL(req.url);
  const userAgent = req.headers.get("user-agent");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // Extract token from query or body
  let token = url.searchParams.get("token");
  let isOneClickPost = false;

  if (!token && req.method === "POST") {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      token = form.get("token") as string | null;
      // RFC 8058 one-click: body contains "List-Unsubscribe=One-Click"
      isOneClickPost = (form.get("List-Unsubscribe") as string | null) === "One-Click";
    } else {
      const body = await req.json().catch(() => ({})) as { token?: string };
      token = body.token ?? null;
    }
  }

  if (!token) {
    if (isOneClickPost) {
      return new Response("Bad Request: missing token", { status: 400, headers: corsHeaders });
    }
    return new Response(
      htmlPage("Token faltante", "<p>El enlace de baja no contiene un token válido.</p>", false),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  try {
    const { data, error } = await sb.rpc("process_drip_unsubscribe", {
      p_token: token,
      p_user_agent: userAgent,
      p_ip: ip,
    });

    if (error) throw error;

    const result = data as { ok: boolean; error?: string; email?: string };

    // RFC 8058 one-click: return 200 with no body
    if (isOneClickPost) {
      return new Response("", { status: 200, headers: corsHeaders });
    }

    if (!result?.ok) {
      const msg = result?.error === "token_expired"
        ? "Este enlace ha expirado. Si querés desuscribirte, respondé al email directamente o contactá al remitente."
        : "No pudimos encontrar tu suscripción. Es posible que ya te hayas dado de baja.";
      return new Response(
        htmlPage("No se pudo procesar", `<p>${msg}</p>`, false),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    return new Response(
      htmlPage(
        "Suscripción cancelada",
        `<p>Listo — <span class="email">${result.email}</span> ya no recibirá más emails de esta secuencia.</p>
         <p>Tu preferencia fue registrada y se aplicará a futuras campañas del mismo remitente.</p>`,
        true,
      ),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Unsubscribe error:", msg);
    return new Response(
      htmlPage("Error interno", "<p>Ocurrió un error al procesar la baja. Por favor, intentá de nuevo más tarde.</p>", false),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
    );
  }
});
