import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260930000300_marketing_email_safety.sql");
const automations = read("supabase/functions/execute-automations/index.ts");
const legacyAutomations = read("supabase/functions/run-automation-flows/index.ts");
const campaign = read("supabase/functions/send-email-campaign/index.ts");
const drip = read("supabase/functions/send-drip-emails/index.ts");
const smtp = read("supabase/functions/_shared/smtpSender.ts");
const ui = read("src/pages/EmailCampaignsPage.tsx");
const deployPs = read("scripts/deploy-functions.ps1");
const deploySh = read("scripts/deploy-functions.sh");
const config = read("supabase/config.toml");
const dripMigration = read("supabase/migrations/20261001000000_drip_stable_unsubscribe.sql");

describe("seguridad de email marketing", () => {
  it("retira el envío diario sembrado sin reintroducirlo en nuevas organizaciones", () => {
    expect(migration).toContain("SET active = false");
    expect(migration).toContain("action_config->>'subject' = 'Te extrañamos'");
    const seed = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.seed_default_automation_flows"));
    expect(seed).not.toContain("'email',");
    expect(seed).toContain("'customer_inactive'");
    expect(seed).toContain("'notification'");
    expect(automations).toContain("La regla de email antigua está retirada");
  });

  it("los correos automáticos son internos, sin listas de personas ni relay externo", () => {
    const emailBlock = automations.slice(
      automations.indexOf('} else if (flow.action_type === "email")'),
      automations.indexOf('} else if (flow.action_type === "whatsapp_message")'),
    );
    expect(emailBlock).toContain("supabase.auth.admin.getUserById(adminId)");
    expect(emailBlock).not.toContain("recipient_email");
    expect(emailBlock).not.toContain("entitiesStr");
    expect(emailBlock).toContain("matchedEntities.length");
    expect(emailBlock).toContain("if (result.ok) actionsTaken++");
    expect(legacyAutomations).not.toContain("config?.recipient_email");
    expect(legacyAutomations).not.toContain("<ul>${listHtml}</ul>");
  });

  it("campañas usan audiencia guardada, bloqueo atómico y baja funcional", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS target_customer_ids uuid[]");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.claim_email_campaign");
    expect(migration).toContain("WHERE id = p_campaign_id AND status = 'draft'");
    expect(campaign).toContain('const segment = String(campRow?.segment ?? "all")');
    expect(campaign).toContain('targetIds.has(row.id)');
    expect(campaign).toContain('rpc("claim_email_campaign"');
    expect(campaign).toContain('rpc("campaign_unsubscribe_token"');
    expect(campaign).toContain("if (tokenError || !tokenBaja) throw");
    expect(campaign).toContain("unsubscribeUrl: urlBaja");
    expect(ui).toContain("target_customer_ids: ids");
    expect(ui).toContain("cohortA");
    expect(ui).toContain("cohortB");
    expect(ui).not.toContain('update({ status: "sending" })');
  });

  it("campañas y secuencias respetan ambas listas de baja y el consentimiento", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.marketing_email_eligible");
    expect(migration).toContain("c.marketing_consent_at IS NOT NULL");
    expect(migration).toContain("public.email_unsubscribes u");
    expect(migration).toContain("public.email_suppressions s");
    expect(campaign).toContain('.from("email_unsubscribes")');
    expect(campaign).toContain('.from("email_suppressions")');
    expect(drip).toContain('rpc("marketing_email_eligible"');
    const loop = campaign.slice(campaign.indexOf("for (let i = 0; i < allowed.length; i++)"));
    expect(loop.indexOf('rpc("marketing_email_eligible"')).toBeLessThan(loop.indexOf("await sendEmail("));
    expect(loop).toContain("if (eligible !== true) { skipped++; continue; }");
    expect(drip).toContain("if (eligibilityError) throw eligibilityError");
    expect(smtp).toContain('headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"');
    expect(smtp).toContain('"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"');
  });

  it("las secuencias conservan los enlaces de baja y apuntan a la función real", () => {
    expect(drip).toContain('rpc("drip_unsubscribe_token"');
    expect(drip).not.toContain("generateToken()");
    expect(drip).not.toContain('Deno.env.get("PUBLIC_BASE_URL")');
    expect(drip).toContain("${UNSUBSCRIBE_BASE_URL}/functions/v1/drip-unsubscribe");
    expect(drip).toContain("seq.org_id !== enrollment.org_id");
    expect(dripMigration).toContain("FOR UPDATE");
    expect(dripMigration).toContain("RETURN v_token.token");
    expect(dripMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(dripMigration).toContain("TO service_role");
    expect(dripMigration).not.toContain("DELETE FROM");
  });

  it("el despliegue conserva la baja pública y la autenticación interna del envío", () => {
    for (const script of [deployPs, deploySh]) {
      expect(script).toContain('"email-campaign-unsubscribe"');
      expect(script).toContain('"send-email-campaign"');
    }
    expect(config).toContain("[functions.email-campaign-unsubscribe]\nverify_jwt = false");
    expect(config).toContain("[functions.send-email-campaign]\nverify_jwt = false");
    expect(campaign).toContain('sbAuth.auth.getUser()');
    expect(campaign).toContain('esLlamadaDeCron(req)');
  });
});
