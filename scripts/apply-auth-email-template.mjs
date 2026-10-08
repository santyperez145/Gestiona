/**
 * Publica la plantilla de alta en Supabase Auth alojado y, si hace falta,
 * configura el remitente transaccional de Resend. --apply --template-only
 * permite publicar sólo el contenido cuando todavía falta la clave SMTP.
 * Sin --apply sólo valida el archivo local. Nunca imprime ni persiste claves.
 *
 * Credenciales (variables de entorno, nunca argumentos):
 *   SUPABASE_ACCESS_TOKEN     Personal access token con auth_config_write
 *   NERQIA_AUTH_SMTP_KEY      API key dedicada de Resend (sólo envío)
 */
import { readFile } from "node:fs/promises";

const projectRef = "hummeopatkniwkyrrhwc";
const fromEmail = "noreply@nerqia.app";
const subject = "Confirmá tu correo · Nerqia";
const template = await readFile(new URL("../supabase/templates/confirmation.html", import.meta.url), "utf8");

for (const marker of ["{{ .ConfirmationURL }}", "store_customer", "creator", "Nerqia"]) {
  if (!template.includes(marker)) throw new Error(`Falta ${marker} en la plantilla de confirmación`);
}
if (!process.argv.includes("--apply")) {
  console.log("Plantilla de confirmación Nerqia válida. No se modificó Supabase alojado.");
  process.exit(0);
}

const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
const smtpKey = process.env.NERQIA_AUTH_SMTP_KEY;
const templateOnly = process.argv.includes("--template-only");
if (!managementToken) throw new Error("Falta SUPABASE_ACCESS_TOKEN en el entorno.");

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${managementToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    // La respuesta del proveedor podría contener detalles sensibles.
    throw new Error(`Supabase Management API rechazó ${method} (HTTP ${response.status}).`);
  }
  return response.json();
}

const previous = await request("GET");
const smtpReady =
  previous.smtp_host === "smtp.resend.com" &&
  previous.smtp_admin_email?.toLowerCase() === fromEmail;
if (!templateOnly && !smtpReady && !smtpKey) {
  throw new Error(
    "Auth SMTP no está configurado con el remitente Nerqia. " +
    "Definí NERQIA_AUTH_SMTP_KEY (clave dedicada de Resend) antes de publicar.",
  );
}

const payload = {
  mailer_subjects_confirmation: subject,
  mailer_templates_confirmation_content: template,
  ...(!templateOnly && smtpKey ? {
    external_email_enabled: true,
    mailer_autoconfirm: false,
    smtp_admin_email: fromEmail,
    smtp_sender_name: "Nerqia",
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: smtpKey,
  } : {}),
};

await request("PATCH", payload);
const applied = await request("GET");
if (
  applied.mailer_subjects_confirmation !== subject ||
  applied.mailer_templates_confirmation_content !== template ||
  (!templateOnly && (
    applied.smtp_host !== "smtp.resend.com" ||
    applied.smtp_admin_email?.toLowerCase() !== fromEmail
  ))
) {
  throw new Error("La lectura posterior no coincide con la plantilla/remitente esperados.");
}
console.log(templateOnly
  ? "Supabase Auth: contenido y asunto Nerqia verificados; remitente SMTP pendiente."
  : "Supabase Auth: plantilla y remitente Nerqia verificados por lectura posterior.");
console.log("Pendiente: probar un alta real, entrega, enlace de confirmación y rebotes.");
