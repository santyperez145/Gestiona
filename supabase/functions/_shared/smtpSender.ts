/**
 * smtpSender.ts — Unified email sender: own SMTP first, Resend fallback.
 *
 * Uses denomailer (pure Deno SMTP client, no npm required).
 * Repository: https://deno.land/x/denomailer
 *
 * Priority:
 *   1. Own SMTP (if smtp_host + smtp_user configured in org settings)
 *   2. Resend API (if RESEND_API_KEY env var set)
 *   3. Error — no email provider configured
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
  error?: string;
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

    await client.send(mail as Parameters<typeof client.send>[0]);
  }

  await client.close();
}

/** Send via Resend HTTP API. */
async function sendViaResend(
  apiKey: string,
  from: string,
  payload: EmailPayload,
  metadata?: Record<string, string>,
): Promise<void> {
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err.message as string) || `Resend HTTP ${res.status}`);
  }
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
 */
export async function sendEmail(
  smtpCfg: SmtpConfig | null,
  resendApiKey: string,
  resendFrom: string,
  payload: EmailPayload,
  metadata?: Record<string, string>,
): Promise<SendResult> {
  // 1. Try SMTP
  if (smtpCfg?.host && smtpCfg?.user) {
    try {
      await sendViaSmtp(smtpCfg, payload);
      return { ok: true, provider: "smtp" };
    } catch (e) {
      console.error("SMTP send failed:", e);
      // Fall through to Resend
    }
  }

  // 2. Try Resend
  if (resendApiKey) {
    try {
      await sendViaResend(resendApiKey, resendFrom, payload, metadata);
      return { ok: true, provider: "resend" };
    } catch (e) {
      console.error("Resend send failed:", e);
      return { ok: false, provider: "resend", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 3. No provider
  return {
    ok: false,
    provider: "none",
    error: "No hay proveedor de email configurado. Configurá SMTP en Ajustes o agregá RESEND_API_KEY.",
  };
}

/**
 * Load SMTP config from settings row (as returned by Supabase).
 * Returns null if SMTP is not fully configured.
 */
export function parseSmtpConfig(settings: Record<string, unknown> | null): SmtpConfig | null {
  if (!settings?.smtp_host || !settings?.smtp_user) return null;
  return {
    host: settings.smtp_host as string,
    port: (settings.smtp_port as number) || 587,
    user: settings.smtp_user as string,
    pass: (settings.smtp_pass as string) || "",
    secure: (settings.smtp_secure as boolean) || false,
    fromName: (settings.smtp_from_name as string) || "",
    fromEmail: (settings.smtp_from_email as string) || (settings.smtp_user as string),
  };
}
