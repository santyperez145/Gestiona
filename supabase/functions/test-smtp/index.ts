/**
 * Administra el SMTP privado de una organización.
 *
 * La contraseña entra por esta Edge Function y nunca vuelve al navegador. La
 * tabla privada usa RLS sin policies; Ajustes sólo lee una vista saneada.
 * Guardar prueba primero el envío al email de la persona autenticada, para no
 * persistir una conexión que todavía no funciona.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME = /^(?=.{1,253}$)(?!.*\.\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PORTS = new Set([25, 465, 587, 2465, 2525, 2587]);

type Body = {
  action?: "save_and_test" | "revoke";
  orgId?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  secure?: boolean;
  fromName?: string;
  fromEmail?: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function sendConnectionTest(config: {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  fromName: string;
  fromEmail: string;
}, destination: string) {
  const client = new SMTPClient({
    connection: {
      hostname: config.host,
      port: config.port,
      tls: config.secure,
      auth: { username: config.user, password: config.pass },
    },
  });
  try {
    await client.send({
      from: `"${config.fromName || config.fromEmail}" <${config.fromEmail}>`,
      to: destination,
      subject: "Conexión de correo verificada — Gestiona",
      content: "La conexión SMTP de tu organización quedó verificada.",
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;background:#f5f7fb">
          <div style="max-width:520px;margin:0 auto;background:white;border:1px solid #e5e7eb;border-radius:14px;padding:32px">
            <h2 style="color:#172554;margin:0 0 12px">Conexión verificada</h2>
            <p style="color:#334155;line-height:1.6">Gestiona pudo enviar este correo con el servidor de tu organización.</p>
            <p style="color:#64748b;font-size:13px">Servidor: ${config.host}:${config.port}</p>
          </div>
        </div>`,
    });
  } finally {
    try {
      await client.close();
    } catch { /* la respuesta útil es la del envío, no la del cierre */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null) as Body | null;
  const orgId = clean(body?.orgId, 36);
  if (!UUID.test(orgId) || !["save_and_test", "revoke"].includes(body?.action || "")) {
    return response({ error: "Organización y acción válidas son obligatorias" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return response({ error: "Servicio no configurado" }, 503);
  const admin = createClient(url, serviceRole);

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (membershipError) {
    console.error("test-smtp membership:", membershipError);
    return response({ error: "No se pudo verificar el permiso" }, 500);
  }
  if (!membership) {
    return response({ error: "Sólo dueños o administradores pueden gestionar el correo" }, 403);
  }

  if (body?.action === "revoke") {
    const { error } = await admin.from("merchant_smtp_connections").delete().eq("org_id", orgId);
    if (error) return response({ error: "No se pudo desconectar el correo" }, 500);
    await admin.from("integration_logs").insert({
      org_id: orgId,
      integration: "smtp",
      event: "credentials_revoked",
      status: "warning",
      message: "Un administrador desconectó el SMTP propio.",
    });
    return response({ configured: false });
  }

  const host = clean(body?.host, 253).toLowerCase();
  const port = Number(body?.port);
  const user = clean(body?.user, 320);
  let pass = typeof body?.pass === "string" ? body.pass : "";
  const fromName = clean(body?.fromName, 120).replace(/[\r\n<>]/g, "");
  const fromEmail = clean(body?.fromEmail, 320).toLowerCase();
  const secure = body?.secure === true;

  if (!HOSTNAME.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return response({ error: "Ingresá un hostname SMTP público válido" }, 400);
  }
  if (!PORTS.has(port)) {
    return response({ error: "Usá un puerto SMTP estándar: 25, 465, 587, 2465, 2525 o 2587" }, 400);
  }
  // Una actualización no obliga a traer la clave de vuelta al navegador: si
  // el campo llega vacío se conserva la existente, sólo dentro del backend.
  if (!pass) {
    const { data: existing, error: existingError } = await admin
      .from("merchant_smtp_connections")
      .select("password")
      .eq("org_id", orgId)
      .maybeSingle();
    if (existingError) return response({ error: "No se pudo leer la conexión existente" }, 500);
    pass = existing?.password || "";
  }
  if (!user || pass.length < 8 || pass.length > 2048 || !EMAIL.test(fromEmail)) {
    return response({ error: "Completá usuario, credencial y email de origen válidos" }, 400);
  }
  if (!auth.user.email) return response({ error: "Tu cuenta no tiene email para recibir la prueba" }, 409);

  try {
    await sendConnectionTest({ host, port, user, pass, secure, fromName, fromEmail }, auth.user.email);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("test-smtp connection:", detail);
    return response({ error: "El servidor rechazó la prueba. Revisá host, puerto y credencial." }, 502);
  }

  const { error: saveError } = await admin.from("merchant_smtp_connections").upsert({
    org_id: orgId,
    host,
    port,
    username: user,
    password: pass,
    secure,
    from_name: fromName || null,
    from_email: fromEmail,
    updated_by: auth.user.id,
  }, { onConflict: "org_id" });
  if (saveError) {
    console.error("test-smtp save:", saveError);
    return response({ error: "La prueba llegó, pero no se pudo guardar la conexión" }, 500);
  }

  await admin.from("integration_logs").insert({
    org_id: orgId,
    integration: "smtp",
    event: "credentials_verified",
    status: "ok",
    message: `SMTP verificado en ${host}:${port}.`,
  });

  return response({
    configured: true,
    host,
    port,
    username: user,
    secure,
    fromName: fromName || null,
    fromEmail,
  });
});
