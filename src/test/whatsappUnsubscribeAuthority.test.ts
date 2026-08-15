import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260814000018_whatsapp_unsubscribe.sql"),
  "utf8",
);
const sender = readFileSync(
  resolve(root, "supabase/functions/send-whatsapp/index.ts"),
  "utf8",
);
const birthdaySender = readFileSync(
  resolve(root, "supabase/functions/send-birthday-whatsapp/index.ts"),
  "utf8",
);
const unsubscribeEndpoint = readFileSync(
  resolve(root, "supabase/functions/whatsapp-unsubscribe/index.ts"),
  "utf8",
);

describe("baja de marketing por WhatsApp", () => {
  it("usa un token opaco de un solo uso y conserva la baja hasta otro opt-in explícito", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.whatsapp_unsubscribe_tokens");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("IF v_token.used_at IS NOT NULL THEN");
    expect(migration).toContain("marketing_opt_out_at = now()");
    expect(migration).toContain("marketing_opt_out_at = NULL");
    expect(migration).toContain("UPDATE public.store_customers sc");
    expect(migration).toContain("accepts_marketing = false");
    expect(migration).toContain("p_source <> 'store_checkout'");
    expect(migration).toContain("WhatsApp unsubscribe dejó filas ZZ");
  });

  it("relee consentimiento y campaña en servidor antes de gastar mensajes", () => {
    expect(sender).toContain("recipientIds: string[]");
    expect(sender).toContain('.from("whatsapp_campaigns")');
    expect(sender).toContain('.not("marketing_consent_at", "is", null)');
    expect(sender).toContain('.is("marketing_opt_out_at", null)');
    expect(sender).toContain('!["owner", "admin"].includes(membership.role)');
    expect(sender).toContain("whatsapp_unsubscribe_tokens");
    expect(sender).toContain("Para dejar de recibir promociones");
    expect(sender).not.toContain("recipients: Recipient[]");
  });

  it("cubre también el saludo automático y expone sólo el RPC tokenizado", () => {
    expect(birthdaySender).toContain('.not("marketing_consent_at", "is", null)');
    expect(birthdaySender).toContain('.is("marketing_opt_out_at", null)');
    expect(birthdaySender).toContain("whatsapp_unsubscribe_tokens");
    expect(unsubscribeEndpoint).toContain("process_whatsapp_unsubscribe");
    expect(unsubscribeEndpoint).toContain("SUPABASE_ANON_KEY");
    expect(unsubscribeEndpoint).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
