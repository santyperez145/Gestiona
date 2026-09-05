// Sends an invitation email to a team member.
// Called from TeamPage right after creating the org_invitation row.
//
// Body: { invitationId: string }
//
// The email contains a link to /invitacion/<token> where the user
// completes signup and is auto-added to the org with the given role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail } from "../_shared/smtpSender.ts";
import { emailFailure } from "../_shared/emailErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Administrador",
  vendedor: "Vendedor",
  viewer: "Viewer (solo lectura)",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const remitente = await remitenteDe("default");
    const fromEmail = Deno.env.get("FROM_EMAIL") || remitente.from;

    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { invitationId } = await req.json();
    if (!UUID.test(String(invitationId ?? ""))) return json({ error: "La invitación no es válida" }, 400);

    // Load the invitation + verify the caller is admin of the org
    const { data: inv } = await admin
      .from("org_invitations")
      .select("id, email, role, token, expires_at, accepted_at, org_id, organizations(name)")
      .eq("id", invitationId)
      .maybeSingle();
    if (!inv) return json({ error: "Invitación no encontrada" }, 404);
    if (inv.accepted_at) return json({ error: "Esta invitación ya fue aceptada" }, 400);

    const { data: mem } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", inv.org_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!mem || !["owner", "admin"].includes(mem.role)) {
      return json({ error: "Solo el admin de la organización puede enviar invitaciones" }, 403);
    }

    const orgName = (inv.organizations as { name?: string } | null)?.name || "tu organización";
    // Nunca se acepta una URL del navegador: una invitación con base arbitraria
    // convertiría el correo legítimo en un vector de phishing.
    const configuredBase = String(Deno.env.get("PUBLIC_BASE_URL") || "https://nerqia.app");
    const baseUrl = configuredBase.replace(/\/+$/, "");
    const inviteUrl = `${baseUrl}/invitacion/${inv.token}`;
    const expiresAt = new Date(inv.expires_at).toLocaleDateString("es-AR");

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Te invitaron a ${orgName} en Nerqia</title>
</head>
<body style="margin:0;padding:0;background:#f5f7ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#172033;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f7ff;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e9f4;box-shadow:0 18px 50px rgba(39,35,91,.10);">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <div style="display:inline-block;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#5b35f5,#7c5cff);text-align:center;line-height:48px;font-size:23px;font-weight:bold;color:#fff;">N</div>
              <h1 style="margin:16px 0 4px;font-size:22px;color:#172033;font-weight:700;">Te invitaron a colaborar</h1>
              <p style="margin:0;color:#667085;font-size:14px;">en <strong style="color:#5b35f5;">${esc(orgName)}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="color:#344054;font-size:15px;line-height:1.6;margin:0 0 16px;">
                Fuiste invitado a unirte como <strong style="color:#5b35f5;">${esc(ROLE_LABEL[inv.role] || inv.role)}</strong> en <strong>${esc(orgName)}</strong> en Nerqia.
              </p>
              <p style="color:#667085;font-size:13px;line-height:1.6;margin:0 0 24px;">
                Hacé click en el botón de abajo para crear tu cuenta y empezar a colaborar. Esta invitación expira el <strong>${expiresAt}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${esc(inviteUrl)}" style="display:inline-block;background:linear-gradient(135deg,#5b35f5,#7c5cff);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 8px 20px rgba(91,53,245,.22);">
                      Aceptar invitación
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:11px;line-height:1.6;margin:24px 0 0;text-align:center;">
                O copiá este link en tu navegador:<br>
                <span style="font-family:monospace;color:#667085;word-break:break-all;font-size:11px;">${esc(inviteUrl)}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#fafaff;border-top:1px solid #ecebff;">
              <p style="color:#64748b;font-size:11px;line-height:1.6;margin:0;text-align:center;">
                ¿No esperabas esta invitación? Ignorá este email — no se hace nada hasta que aceptes.<br>
                Nerqia © ${new Date().getFullYear()} — Sistema de Gestión Integral
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const result = await sendEmail(remitente.smtp, resendKey ?? "", fromEmail, {
      to: inv.email,
      subject: `Invitación para colaborar en ${orgName} — Nerqia`,
      html,
    }, {
      org_id: inv.org_id,
      invitation_id: inv.id,
      message_type: "team_invite",
    }, { idempotencyKey: `team-invite/${inv.id}` });

    if (!result.ok) return json(emailFailure(result, "merchant", "send-team-invite"), 502);

    return json({ ok: true, sent_to: inv.email });
  } catch (e) {
    console.error("send-team-invite error:", e);
    return json({ error: "No se pudo preparar la invitación. Volvé a intentar.", code: "INVITE_EMAIL_FAILED" }, 500);
  }
});
