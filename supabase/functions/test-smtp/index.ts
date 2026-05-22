/**
 * test-smtp — Tests SMTP connection by sending a test email.
 * Called from SettingsPage "Probar SMTP" button.
 *
 * POST body: { host, port, user, pass, secure }
 * Sends a test email to the SMTP user's address itself.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.1.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { host, port, user, pass, secure } = await req.json() as {
      host: string; port: number; user: string; pass: string; secure: boolean;
    };

    if (!host || !user) {
      return new Response(JSON.stringify({ error: "host y user son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new SMTPClient({
      connection: {
        hostname: host,
        port: port || 587,
        tls: secure || false,
        auth: { username: user, password: pass || "" },
      },
    });

    await client.send({
      from: user,
      to: user,
      subject: "✅ Test SMTP — Gestiona",
      content: "Conexión SMTP verificada correctamente desde Gestiona.",
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;background:#f5f5f5;">
          <div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:32px;">
            <h2 style="color:#d4a843;margin:0 0 12px;">✅ SMTP Configurado</h2>
            <p style="color:#333;">Esta es una prueba de conexión SMTP desde <strong>Gestiona</strong>.</p>
            <p style="color:#666;font-size:13px;">Si recibiste este correo, tu configuración SMTP está funcionando correctamente.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
            <p style="color:#999;font-size:11px;">Servidor: ${host}:${port || 587} — ${secure ? "SSL" : "STARTTLS"}</p>
          </div>
        </div>
      `,
    });

    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("test-smtp error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
