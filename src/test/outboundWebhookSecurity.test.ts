import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPublicWebhookUrl } from "../../supabase/functions/_shared/outboundWebhook";

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20260828000220_los_webhooks_salen_firmados.sql"), "utf8");
const OUTBOX_MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20260829000010_sale_created_vive_en_el_outbox.sql"), "utf8");
const EDGE = readFileSync(resolve(ROOT, "supabase/functions/send-webhook/index.ts"), "utf8");
const OUTBOX_EDGE = readFileSync(resolve(ROOT, "supabase/functions/dispatch-outbound-webhook/index.ts"), "utf8");
const DELIVERY = readFileSync(resolve(ROOT, "supabase/functions/_shared/outboundWebhook.ts"), "utf8");
const PANEL = readFileSync(resolve(ROOT, "src/components/integrations/AdvancedWebhooksPanel.tsx"), "utf8");
const INTEGRATIONS = readFileSync(resolve(ROOT, "src/pages/IntegrationsPage.tsx"), "utf8");
const POS = readFileSync(resolve(ROOT, "src/pages/POSPage.tsx"), "utf8");
const RUN_AUTOMATIONS = readFileSync(resolve(ROOT, "supabase/functions/run-automation-flows/index.ts"), "utf8");
const EXECUTE_AUTOMATIONS = readFileSync(resolve(ROOT, "supabase/functions/execute-automations/index.ts"), "utf8");

describe("webhooks salientes", () => {
  it("acepta sólo destinos HTTPS públicos obvios", () => {
    expect(assertPublicWebhookUrl("https://hooks.example.com/gestiona").hostname).toBe("hooks.example.com");
    for (const unsafe of [
      "http://hooks.example.com",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.8/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pass@example.com/hook",
      "https://example.com/hook#fragment",
      "https://[::1]/hook",
    ]) {
      expect(() => assertPublicWebhookUrl(unsafe), unsafe).toThrow();
    }
  });

  it("guarda el secret fuera de las tablas visibles y retira el sistema legado", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.webhook_signing_secrets");
    expect(MIGRATION).toContain("REVOKE ALL ON TABLE public.webhook_signing_secrets FROM PUBLIC, anon, authenticated");
    expect(MIGRATION).toContain("DROP COLUMN IF EXISTS secret_value");
    expect(MIGRATION).toContain("DROP COLUMN IF EXISTS webhook_secret");
    expect(MIGRATION).toContain("webhook_config_guardar");
    expect(MIGRATION).toContain("webhook_secret_rotar");
  });

  it("firma en servidor con timestamp y no sigue redirects", () => {
    expect(DELIVERY).toContain('select("secret")');
    expect(DELIVERY).toContain('`${timestamp}.${payloadString}`');
    expect(DELIVERY).toContain('`t=${timestamp},v1=${signature}`');
    expect(DELIVERY).toContain('OUTBOUND_WEBHOOK_API_VERSION = "2026-08-29"');
    expect(DELIVERY).toContain('"X-Gestiona-Version": OUTBOUND_WEBHOOK_API_VERSION');
    expect(DELIVERY).toContain('"X-Gestiona-Event-Id": eventId');
    expect(DELIVERY).toContain("id: eventId");
    expect(DELIVERY).toContain('input.event !== "test.ping" && !input.includeInactive');
    expect(DELIVERY).toContain('redirect: "manual"');
    expect(DELIVERY).not.toContain("|| orgId");
    expect(DELIVERY).not.toContain('redirect: "follow"');
  });

  it("encola la venta en el commit y el navegador no puede duplicarla", () => {
    expect(OUTBOX_MIGRATION).toContain("''subscription_id'', v_sub.id");
    expect(OUTBOX_MIGRATION).toContain("'venta.registrada'");
    expect(OUTBOX_MIGRATION).toContain("'dispatch-outbound-webhook'");
    expect(OUTBOX_MIGRATION).toContain("'x-cron-secret', v_cron_secret");
    expect(OUTBOX_MIGRATION).toContain("REVOKE INSERT, UPDATE, DELETE");
    expect(OUTBOX_MIGRATION).toContain("ON TABLE public.event_subscriptions FROM authenticated");

    expect(OUTBOX_EDGE).toContain("exigirCron(req");
    expect(OUTBOX_EDGE).toContain('.from("domain_events")');
    expect(OUTBOX_EDGE).toContain('.from("event_subscriptions")');
    expect(OUTBOX_EDGE).toContain('.from("sales")');
    expect(OUTBOX_EDGE).toContain('.eq("sale_transaction_id", transactionId)');
    expect(OUTBOX_EDGE).toContain("eventId");
    expect(OUTBOX_EDGE).toContain("attemptsAllowed: 1");

    expect(EDGE).toContain("requireUser");
    expect(EDGE).not.toContain('action?: "dispatch"');
    expect(EDGE).not.toContain("saleIds");
    expect(POS).not.toContain('functions.invoke("send-webhook"');
    expect(POS).toContain("cerrar esta pestaña no");
    expect(POS).not.toContain("settings?.webhook_enabled");
  });

  it("la UI muestra el secret una vez y nunca llama al endpoint directamente", () => {
    expect(PANEL).toContain("webhook_config_guardar");
    expect(PANEL).toContain("signing_secret");
    expect(PANEL).not.toContain('select("*")');
    expect(PANEL).not.toContain("secret_value");
    expect(PANEL).not.toContain("fetch(webhook.url");
    expect(PANEL).not.toContain("sale.refunded");
    expect(INTEGRATIONS.match(/<AdvancedWebhooksPanel/g)).toHaveLength(1);
    expect(INTEGRATIONS).not.toContain("webhookSecret");
  });

  it("las dos ejecuciones de automatizaciones usan la entrega canónica", () => {
    for (const source of [RUN_AUTOMATIONS, EXECUTE_AUTOMATIONS]) {
      expect(source).toContain("deliverOutboundEvent");
      expect(source).toContain('event: "automation.triggered"');
      expect(source).not.toContain("settings.webhook_url");
    }
    expect(EXECUTE_AUTOMATIONS).toContain('p_module: "marketing"');
    expect(EXECUTE_AUTOMATIONS).toContain("if (!vieneDelCron)");
    expect(MIGRATION).toContain("cron.unschedule('run-automation-flows-daily')");
    expect(MIGRATION).toContain("'execute-automations-daily'");
    expect(MIGRATION).toContain("'0 11 * * *'");
  });
});
