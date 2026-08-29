import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const firstMigration = read("supabase/migrations/20260828000190_el_smtp_del_comercio_es_privado.sql");
const dropMigration = read("supabase/migrations/20260828000200_settings_deja_de_invitar_secretos_smtp.sql");
const endpoint = read("supabase/functions/test-smtp/index.ts");
const settingsPage = read("src/pages/SettingsPage.tsx");
const snapshot = read("supabase/functions/_shared/organizationSnapshot.ts");
const restoreDrill = read("scripts/restore-drill.mjs");

const SMTP_CONSUMERS = [
  "execute-automations",
  "notify-back-in-stock",
  "recover-abandoned-carts",
  "run-automation-flows",
  "send-drip-emails",
  "send-email-campaign",
  "send-invoice-email",
  "send-supplier-po",
  "store-order-email",
  "store-order-status-email",
  "weekly-performance-digest",
];

describe("SMTP privado por organización", () => {
  it("guarda el secreto en una tabla sin acceso de navegador y publica sólo una vista saneada", () => {
    expect(firstMigration).toContain("ALTER TABLE public.merchant_smtp_connections ENABLE ROW LEVEL SECURITY");
    expect(firstMigration).toContain("REVOKE ALL ON public.merchant_smtp_connections FROM PUBLIC, anon, authenticated");
    expect(firstMigration).toContain("GRANT ALL ON public.merchant_smtp_connections TO service_role");
    expect(firstMigration).toContain("CREATE OR REPLACE VIEW public.merchant_smtp_connection_status");

    const view = firstMigration.split("CREATE OR REPLACE VIEW public.merchant_smtp_connection_status")[1]
      ?.split("ALTER VIEW")[0] ?? "";
    expect(view).not.toMatch(/password|smtp_pass/);
  });

  it("retira las siete columnas SMTP de settings sin esconder dependencias con CASCADE", () => {
    for (const column of ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_secure", "smtp_from_name", "smtp_from_email"]) {
      expect(dropMigration).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
    expect(dropMigration.replace(/^--.*$/gm, "")).not.toContain("CASCADE");
  });

  it("exige usuario real y rol administrativo para guardar o revocar", () => {
    expect(endpoint).toContain("requireUser(req, corsHeaders)");
    expect(endpoint).toContain('.in("role", ["owner", "admin"])');
    expect(endpoint).toContain('body?.action === "revoke"');
    expect(endpoint).toContain('.from("merchant_smtp_connections")');
  });

  it("prueba antes de persistir, conserva una clave existente sólo en backend y no la devuelve", () => {
    expect(endpoint.indexOf("await sendConnectionTest")).toBeLessThan(endpoint.indexOf(".upsert({"));
    expect(endpoint).toContain('.select("password")');
    expect(endpoint).toContain('pass = existing?.password || ""');
    const successfulResponse = endpoint.split("return response({").at(-1) ?? "";
    expect(successfulResponse).not.toMatch(/pass|password/);
    expect(endpoint).not.toContain("El servidor rechazó la prueba: ${detail}");
  });

  it("la pantalla sólo lee estado y entrega la credencial a la Edge segura", () => {
    expect(settingsPage).toContain("merchant_smtp_connection_status");
    expect(settingsPage).toContain("functions.invoke('test-smtp'");
    expect(settingsPage).toContain("La credencial queda en almacenamiento privado del backend y nunca vuelve a esta pantalla");
    expect(settingsPage).not.toContain("smtp_pass");
  });

  it("todos los emisores leen el almacén privado mediante el helper único", () => {
    for (const name of SMTP_CONSUMERS) {
      const source = read(`supabase/functions/${name}/index.ts`);
      expect(source, name).toContain("smtpDeOrganizacion");
      expect(source, name).not.toContain("parseSmtpConfig");
      expect(source, name).not.toMatch(/smtp_(host|port|user|pass|secure|from_name|from_email)/);
    }
  });

  it("ni los snapshots ni el restore drill pueden incluir la tabla privada", () => {
    expect(snapshot).toMatch(/EXCLUDED_CREDENTIAL_STORES[\s\S]{0,400}"merchant_smtp_connections"/);
    expect(restoreDrill).toMatch(/EXCLUDED_CREDENTIAL_STORES[\s\S]{0,400}"merchant_smtp_connections"/);
  });
});
