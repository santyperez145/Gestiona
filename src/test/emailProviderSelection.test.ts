import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("seleccion explicita del proveedor de correo", () => {
  it("distingue Resend, Gmail, Microsoft, Zoho y SMTP personalizado", () => {
    const sender = read("supabase/functions/_shared/remitente.ts");
    const page = read("src/pages/PlatformMessagingPage.tsx");

    for (const provider of [
      "resend_api",
      "gmail_smtp",
      "microsoft_smtp",
      "zoho_smtp",
      "smtp_personalizado",
    ]) {
      expect(sender).toContain(provider);
      expect(page).toContain(provider);
    }
    expect(page).toContain("EMAIL_PROVIDERS.map");
  });

  it("no mezcla SMTP con Resend cuando el proveedor elegido falla", () => {
    const source = read("supabase/functions/_shared/smtpSender.ts");
    const smtpBranch = source.slice(source.indexOf('if (transporte === "smtp")'), source.indexOf("if (!resendApiKey"));

    expect(smtpBranch).toContain('provider: "smtp"');
    expect(smtpBranch).not.toContain("sendViaResend");
    expect(source).toContain('const transporte = smtpCfg ? "smtp"');
  });

  it("versiona la eleccion y exige reprobar al cambiar de proveedor", () => {
    const source = read("supabase/migrations/20260908000010_explicit_email_providers.sql");

    expect(source).toContain("email_verificado_proveedor");
    expect(source).toContain("email_verificado_proveedor = v_config.email_proveedor");
    expect(source).toContain("THEN NULL ELSE c.email_verificado_at END");
    expect(source).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("solo el sender compartido llama a la API de Resend", () => {
    const functionsRoot = resolve(process.cwd(), "supabase/functions");
    const offenders: string[] = [];
    for (const entry of readdirSync(functionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "_shared") continue;
      const source = read(`supabase/functions/${entry.name}/index.ts`);
      if (source.includes("api.resend.com")) offenders.push(entry.name);
    }
    expect(offenders).toEqual([]);
  });
});
