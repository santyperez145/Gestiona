import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Baja uno-clic de campañas de email.
 *
 * La campaña masiva enviaba el placeholder `{{unsubscribe_url}}` literal:
 * el contacto no podía darse de baja, lo que viola CAN-SPAM / Ley 26.652 y
 * quema el dominio de envío con quejas. Esta guarda falla si:
 *   1. `send-email-campaign` deja de generar y guardar un token por email;
 *   2. deja de reemplazar `{{unsubscribe_url}}` con el link real;
 *   3. desaparece la Edge Function pública que procesa la baja;
 *   4. el RPC de baja deja de escribir en `email_unsubscribes`.
 */
describe("baja uno-clic de campañas", () => {
  const migracion = read("supabase/migrations/20260924000100_email_campaign_unsubscribe.sql");
  const sender = read("supabase/functions/send-email-campaign/index.ts");
  const endpoint = read("supabase/functions/email-campaign-unsubscribe/index.ts");

  it("la migración crea tokens de baja con expiración y RPC público idempotente", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.email_campaign_unsubscribe_tokens");
    expect(migracion).toContain("expires_at    timestamptz NOT NULL DEFAULT (now() + interval '90 days')");
    expect(migracion).toContain("ON CONFLICT (org_id, email) DO UPDATE");
    // La tabla no es legible desde el navegador: sólo service_role.
    expect(migracion).toContain("REVOKE ALL ON public.email_campaign_unsubscribe_tokens FROM PUBLIC, anon, authenticated");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.process_email_campaign_unsubscribe");
  });

  it("el sender genera token por destinatario y reemplaza el placeholder", () => {
    // La generación de tokens vive en la Edge de campañas, junto al envío:
    // smtpSender es genérico (transaccional), y el token necesita campaign_id.
    expect(sender).toContain("email_campaign_unsubscribe_tokens");
    expect(sender).toMatch(/replace\(\/\\{\\{unsubscribe_url\\}\\}\/gi/);
    // El token entra ANTES de enviar, para que una baja post-reintento siga válida.
    // Se busca dentro del bloque de envío real (después del camino testOnly).
    const upsertIdx = sender.indexOf('from("email_campaign_unsubscribe_tokens")');
    const sendIdx = sender.indexOf("await sendEmail(", upsertIdx);
    expect(upsertIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(upsertIdx);
  });

  it("la Edge Function pública procesa la baja vía RPC y sin secretos al cliente", () => {
    expect(endpoint).toContain('rpc("process_email_campaign_unsubscribe"');
    expect(endpoint).not.toContain("SERVICE_ROLE_KEY!); //");
    // La página de confirmación no filtra el email del contacto.
    expect(endpoint).not.toMatch(/<h1>[^<]*\$\{result\.email/);
  });

  it("el RPC agrega la baja a email_unsubscribes para campañas futuras", () => {
    expect(migracion).toContain("INSERT INTO public.email_unsubscribes");
  });
});