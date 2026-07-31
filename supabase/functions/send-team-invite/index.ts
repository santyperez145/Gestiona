// Sends an invitation email to a team member.
// Called from TeamPage right after creating the org_invitation row.
//
// Body: { invitationId: string }
//
// The email contains a link to /invitacion/<token> where the user
// completes signup and is auto-added to the org with the given role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "Gestiona <noreply@gestiona.app>";

    if (!resendKey) {
      return json({ error: "Resend no está configurado en la plataforma" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { invitationId, appUrl } = await req.json();
    if (!invitationId) return json({ error: "invitationId requerido" }, 400);

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
    const baseUrl = appUrl || req.headers.get("origin") || "https://exentryimports.vercel.app";
    const inviteUrl = `${baseUrl}/invitacion/${inv.token}`;
    const expiresAt = new Date(inv.expires_at).toLocaleDateString("es-AR");

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Te invitaron a ${orgName} en Gestiona</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0f0f1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid rgba(212,168,67,0.15);">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#d4a843,#e0b755);text-align:center;line-height:48px;font-size:24px;font-weight:bold;color:#1a1a2e;">G</div>
              <h1 style="margin:16px 0 4px;font-size:22px;color:#fff;font-weight:700;">Te invitaron a colaborar</h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;">en <strong style="color:#d4a843;">${orgName}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px;">
                Fuiste invitado a unirte como <strong style="color:#d4a843;">${ROLE_LABEL[inv.role] || inv.role}</strong> en <strong>${orgName}</strong> en Gestiona — sistema de gestión integral para negocios.
              </p>
              <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 24px;">
                Hacé click en el botón de abajo para crear tu cuenta y empezar a colaborar. Esta invitación expira el <strong>${expiresAt}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#d4a843,#e0b755);color:#1a1a2e;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(212,168,67,0.3);">
                      Aceptar invitación
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:11px;line-height:1.6;margin:24px 0 0;text-align:center;">
                O copiá este link en tu navegador:<br>
                <span style="font-family:monospace;color:#94a3b8;word-break:break-all;font-size:11px;">${inviteUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:rgba(212,168,67,0.04);border-top:1px solid rgba(212,168,67,0.1);">
              <p style="color:#64748b;font-size:11px;line-height:1.6;margin:0;text-align:center;">
                ¿No esperabas esta invitación? Ignorá este email — no se hace nada hasta que aceptes.<br>
                Gestiona © ${new Date().getFullYear()} — Sistema de Gestión Integral
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: inv.email,
        subject: `Invitación para colaborar en ${orgName} — Gestiona`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error("Resend error:", errBody);
      return json({ error: "No se pudo enviar el email" }, 500);
    }

    return json({ ok: true, sent_to: inv.email });
  } catch (e) {
    console.error("send-team-invite error:", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});
