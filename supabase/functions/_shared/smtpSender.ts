/**
 * smtpSender.ts — Unified email sender: own SMTP first, Resend fallback.
 *
 * Uses denomailer (pure Deno SMTP client, no npm required).
 * Repository: https://deno.land/x/denomailer
 *
 * Priority:
 *   1. Own SMTP (if the organization has a private server-side connection)
 *   2. Resend API (if RESEND_API_KEY env var set)
 *   3. Error — no email provider configured
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  fromName: string;
  fromEmail: string;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    mimeType?: string;
  }>;
}

export interface SendResult {
  ok: boolean;
  provider: "smtp" | "resend" | "none";
  messageId?: string;
  error?: string;
}

export interface EmailDeliveryOptions {
  /**
   * Identidad estable del evento, no del intento. Resend conserva el resultado
   * durante 24 h; el ledger de la aplicación sigue siendo la autoridad durable
   * y también protege el camino SMTP.
   */
  idempotencyKey?: string;
}

/** Send via own SMTP server using denomailer (pure Deno). */
async function sendViaSmtp(cfg: SmtpConfig, payload: EmailPayload): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      tls: cfg.secure,
      auth: {
        username: cfg.user,
        password: cfg.pass,
      },
    },
  });

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  for (const recipient of recipients) {
    const mail: Record<string, unknown> = {
      from: cfg.fromEmail
        ? `"${cfg.fromName || cfg.fromEmail}" <${cfg.fromEmail}>`
        : cfg.user,
      to: recipient,
      subject: payload.subject,
      content: payload.text || " ",
      html: payload.html,
    };

    if (payload.attachments?.length) {
      mail.attachments = payload.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: "base64",
        mimeType: a.mimeType || "application/octet-stream",
      }));
    }

    // denomailer declara un tipo más estricto que el objeto que construimos
    // dinámicamente al agregar adjuntos. Los campos requeridos se arman arriba;
    // el doble cast sólo cruza esa diferencia de declaraciones de la librería.
    await client.send(mail as unknown as Parameters<typeof client.send>[0]);
  }

  await client.close();
}

/** Send via Resend HTTP API. */
async function sendViaResend(
  apiKey: string,
  from: string,
  payload: EmailPayload,
  metadata?: Record<string, string>,
  idempotencyKey?: string,
): Promise<string | undefined> {
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  const body: Record<string, unknown> = {
    from,
    to: recipients,
    subject: payload.subject,
    html: payload.html,
  };
  if (metadata) body.metadata = metadata;
  if (payload.attachments?.length) {
    body.attachments = payload.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      type: a.mimeType || "application/octet-stream",
      disposition: "attachment",
    }));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err.message as string) || `Resend HTTP ${res.status}`);
  }

  const sent = await res.json().catch(() => ({})) as Record<string, unknown>;
  return typeof sent.id === "string" ? sent.id : undefined;
}

/**
 * Main send function.
 * Tries SMTP first if smtpCfg provided, then Resend, then throws.
 *
 * @param smtpCfg      - SMTP config from settings (null = not configured)
 * @param resendApiKey - RESEND_API_KEY from env (empty = not configured)
 * @param resendFrom   - "from" address for Resend (e.g. "Gestiona <noreply@gestiona.app>")
 * @param payload      - Email content
 * @param metadata     - Optional Resend webhook metadata
 * @param options      - Delivery controls such as a stable idempotency key
 */
/**
 * Traduce los rechazos que tienen una causa concreta y accionable.
 *
 * ⚠️ Existe por un caso real: Gmail contesta «535: 5.7.8 Username and Password
 * not accepted … BadCredentials», que es exacto y no dice qué hacer. Y ese
 * código tiene dos causas que explican casi todos los casos:
 *
 *   1. La contraseña de aplicación se pegó **con los espacios** que muestra
 *      Google. Va sin espacios.
 *   2. La contraseña es de **otra cuenta** de Google que la del usuario
 *      configurado. Con varias sesiones abiertas es lo más fácil de errar.
 *
 * 📌 Se conserva el texto original abajo: traducir sin mostrar el original es
 * cómo se pierde el caso que no entraba en ninguna de las dos.
 */
function pistaDelRechazo(motivo: string, usuario: string): string {
  if (/535|BadCredentials|Username and Password not accepted/i.test(motivo)) {
    return `El servidor rechazó el usuario y la contraseña de ${usuario}. `
      + "Casi siempre es una de dos: la contraseña de aplicación se pegó con los "
      + "espacios que muestra Google (va sin espacios), o es de otra cuenta de "
      + `Google distinta de ${usuario}. Detalle del servidor: ${motivo}`;
  }
  if (/534|Application-specific password required/i.test(motivo)) {
    return "Google pide una contraseña de aplicación, no la de la cuenta. Se crea "
      + `con la verificación en dos pasos activa. Detalle del servidor: ${motivo}`;
  }
  return `El servidor de correo rechazó el envío: ${motivo}`;
}

export async function sendEmail(
  smtpCfg: SmtpConfig | null,
  resendApiKey: string,
  resendFrom: string,
  payload: EmailPayload,
  metadata?: Record<string, string>,
  options?: EmailDeliveryOptions,
): Promise<SendResult> {
  /**
   * ⚠️ El error del SMTP ya no se pierde.
   *
   * Antes esto hacía `console.error` y caía a Resend, así que lo que llegaba a
   * la pantalla era el error de **Resend**. Con un remitente de Gmail, Resend
   * contesta «the gmail.com domain is not verified» — un error verdadero, sobre
   * el proveedor equivocado, que manda a verificar un dominio que no tiene nada
   * que ver con lo que falló.
   *
   * 📌 Un error de un proveedor que ni siquiera era el elegido es peor que un
   * error genérico: hace perder el tiempo en el lugar que no es. Encontrado el
   * 2026-08-28 con `SMTP_PASSWORD` ya cargada.
   */
  let errorDelSmtp: string | null = null;

  // 1. Try SMTP
  if (smtpCfg?.host && smtpCfg?.user) {
    try {
      await sendViaSmtp(smtpCfg, payload);
      return { ok: true, provider: "smtp" };
    } catch (e) {
      errorDelSmtp = e instanceof Error ? e.message : String(e);
      console.error("SMTP send failed:", e);
      // Se sigue intentando por Resend, pero el motivo de arriba se conserva.
    }
  }

  // 2. Try Resend
  if (resendApiKey) {
    try {
      const messageId = await sendViaResend(
        resendApiKey,
        resendFrom,
        payload,
        metadata,
        options?.idempotencyKey,
      );
      return { ok: true, provider: "resend", messageId };
    } catch (e) {
      console.error("Resend send failed:", e);
      // Si el envío elegido era el SMTP, el motivo útil es el suyo: Resend
      // era el respaldo y con este remitente no podía funcionar igual.
      if (errorDelSmtp) {
        return {
          ok: false, provider: "smtp",
          error: pistaDelRechazo(errorDelSmtp, smtpCfg?.user ?? "el usuario configurado"),
        };
      }
      return { ok: false, provider: "resend", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Sin Resend configurado, el motivo del SMTP es lo único que hay.
  if (errorDelSmtp) {
    return {
      ok: false, provider: "smtp",
      error: pistaDelRechazo(errorDelSmtp, smtpCfg?.user ?? "el usuario configurado"),
    };
  }

  // 3. No provider
  return {
    ok: false,
    provider: "none",
    error: "No hay proveedor de email configurado. Configurá SMTP en Ajustes o agregá RESEND_API_KEY.",
  };
}

/**
 * Carga la conexión privada de un comercio.
 *
 * `settings` no puede alojar secretos porque todo miembro del tenant lee su
 * fila. Esta consulta usa service_role y la tabla subyacente tiene RLS sin una
 * sola policy de navegador. La contraseña sólo existe dentro de la Edge que va
 * a enviar el correo.
 */
export async function smtpDeOrganizacion(orgId: string): Promise<SmtpConfig | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole || !orgId) return null;

  const admin = createClient(url, serviceRole);
  const { data, error } = await admin
    .from("merchant_smtp_connections")
    .select("host,port,username,password,secure,from_name,from_email")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    // Durante un deploy la Edge puede adelantarse a la migración. En ese único
    // caso se conserva el fallback a Resend; cualquier otro error queda visible.
    if (["42P01", "PGRST205"].includes(error.code || "")) {
      console.warn("smtpDeOrganizacion: la tabla privada todavía no existe");
      return null;
    }
    throw error;
  }
  if (!data) return null;

  return {
    host: data.host,
    port: data.port || 587,
    user: data.username,
    pass: data.password,
    secure: data.secure === true,
    fromName: data.from_name || "",
    fromEmail: data.from_email || data.username,
  };
}
