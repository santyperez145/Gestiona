import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Baja uno-clic de campañas de email.
 *
 * La baja debe existir antes del envío y seguir válida en un reintento.
 * Esta guarda falla si:
 *   1. `send-email-campaign` deja de generar y guardar un token por email;
 *   2. deja de reemplazar `{{unsubscribe_url}}` con el link real;
 *   3. desaparece la Edge Function pública que procesa la baja;
 *   4. el RPC de baja deja de escribir en `email_unsubscribes`.
 */
describe("baja uno-clic de campañas", () => {
  const migracion = read("supabase/migrations/20260924000100_email_campaign_unsubscribe.sql");
  const safety = read("supabase/migrations/20260930000300_marketing_email_safety.sql");
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
    expect(safety).toContain("CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_unsubscribe_pair_uidx");
    expect(safety).toContain("ON CONFLICT (campaign_id, email) DO UPDATE");
    expect(sender).toContain('rpc("campaign_unsubscribe_token"');
    expect(sender).toContain("unsubscribe_url: urlBaja");
    expect(sender).toContain("withMarketingUnsubscribe(");
    const tokenIdx = sender.indexOf('rpc("campaign_unsubscribe_token"');
    const sendIdx = sender.indexOf("const result = await sendEmail(", tokenIdx);
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(tokenIdx);
    expect(sender).toContain("if (tokenError || !tokenBaja) throw");
  });

  it("la Edge Function pública procesa la baja vía RPC y sin secretos al cliente", () => {
    expect(endpoint).toContain('rpc("process_email_campaign_unsubscribe"');
    expect(endpoint).not.toContain("SERVICE_ROLE_KEY!); //");
    // La página de confirmación no filtra el email del contacto.
    expect(endpoint).not.toMatch(/<h1>[^<]*\$\{result\.email/);
    expect(endpoint).toContain('if (req.method === "GET")');
    expect(endpoint).toContain('if (oneClick) return new Response(""');
  });

  it("el RPC agrega la baja a email_unsubscribes para campañas futuras", () => {
    expect(migracion).toContain("INSERT INTO public.email_unsubscribes");
  });
});
