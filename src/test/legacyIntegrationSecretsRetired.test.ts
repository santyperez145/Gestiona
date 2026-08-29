import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260828000210_settings_deja_de_aceptar_tokens.sql");
const mpResolver = read("supabase/functions/_shared/mpToken.ts");
const evolutionResolver = read("supabase/functions/_shared/evolutionConnection.ts");
const mpLink = read("supabase/functions/mercadopago-link/index.ts");
const mpWebhook = read("supabase/functions/mercadopago-webhook/index.ts");
const paymentPanel = read("src/components/integrations/PaymentConnectionsPanel.tsx");
const paymentLinks = read("src/pages/PaymentLinksPage.tsx");

const retired = [
  "api_key",
  "evolution_api_url",
  "evolution_api_key",
  "evolution_instance",
  "ml_access_token",
  "ml_refresh_token",
  "mp_access_token",
  "mp_webhook_secret",
];

describe("credenciales heredadas retiradas de settings", () => {
  it("frena si aparece un valor real y borra las ocho columnas sin CASCADE", () => {
    expect(migration).toContain("Hay % settings con credenciales heredadas");
    expect(migration).not.toMatch(/DROP COLUMN[\s\S]{0,80}CASCADE/i);
    for (const column of retired) {
      expect(migration).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });

  it("conserva los tres almacenes privados bajo RLS y cero policies", () => {
    for (const table of ["payment_connections", "meli_connections", "evolution_connections"]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("c.relrowsecurity = true");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).toContain("v_private_tables <> 3");
    expect(migration).toContain("REVOKE ALL ON TABLE public.payment_connections");
    expect(migration).toContain("REVOKE ALL ON TABLE public.meli_connections");
    expect(migration).toContain("has_table_privilege('authenticated', 'public.payment_connections', 'SELECT')");
  });

  it("Mercado Pago y Evolution no vuelven a consultar settings", () => {
    expect(mpResolver).toContain('.from("payment_connections")');
    expect(mpResolver).not.toContain('.from("settings")');
    expect(evolutionResolver).toContain(".from('evolution_connections')");
    expect(evolutionResolver).not.toContain(".from('settings')");
    expect(paymentPanel).not.toContain('select("mp_access_token');
    expect(mpWebhook).not.toContain("settingsList");
  });

  it("crear un link exige sesión, tenant y permiso de venta", () => {
    expect(mpLink).toContain("requireUser(req, corsHeaders)");
    expect(mpLink).toContain('p_module: "sales"');
    expect(mpLink).toContain('p_action: "create"');
    expect(mpLink).toContain("canCreate !== true");
    expect(mpLink).toContain("getMpCredentials(admin, orgId)");
  });

  it("el cobro calcula revenue de plataforma y notifica con tenant explícito", () => {
    expect(mpLink).toContain('admin.rpc("platform_commission_amount"');
    expect(mpLink).toContain("marketplace_fee: marketplaceFee");
    expect(mpLink).toContain("mercadopago-webhook?org_id=${orgId}");
    expect(mpLink).toContain("marketplaceFee > total");
    expect(mpLink).toContain('const channel = "online"');
    expect(mpLink).not.toContain("body.channel");
  });

  it("el link conserva la misma referencia que el webhook usa para confirmarlo", () => {
    expect(paymentLinks).toContain("externalRef: newLink.external_ref");
    expect(paymentLinks).toContain('const externalRef = link.external_ref ?? `link:${link.id}`');
    expect(paymentLinks).toContain(".update({ external_ref: externalRef })");
    expect(paymentLinks).toContain("externalRef,");
    expect(paymentLinks).not.toContain('externalRef: `sale:${newLink.id}`');
  });
});
