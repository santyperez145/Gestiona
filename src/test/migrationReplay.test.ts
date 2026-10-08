import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationSyntaxFailures } from "../../scripts/check-migration-syntax.mjs";

const read = (file: string) => readFileSync(resolve("supabase/migrations", file), "utf8");
const cronFiles = ["20260503000002_cron_customer_alerts.sql", "20260504000005_cron_automation_flows.sql",
  "20260504000006_cron_customer_reactivation.sql", "20260504000007_cron_overdue_debts.sql",
  "20260504000008_cron_stock_alerts.sql", "20260504000011_daily_kpi_alert.sql",
  "20260504000013_email_campaigns_scheduled.sql", "20260504000025_weekly_digest.sql",
  "20260522000005_whatsapp_digest.sql"];

describe("empty-schema replay contracts", () => {
  it("uses the PostgreSQL grammar to reject nested-dollar syntax without executing SQL", async () => {
    const failures = await migrationSyntaxFailures([
      { name: "valid.sql", sql: "DO $outer$ BEGIN PERFORM cron.schedule('test', '* * * * *', $$SELECT 1;$$); END; $outer$;" },
      { name: "broken.sql", sql: "DO $$ BEGIN PERFORM cron.schedule('test', '* * * * *', $$SELECT 1;$$); END; $$;" },
    ]);
    expect(failures.map(failure => failure.name)).toEqual(["broken.sql"]);
  });
  it("does not pretend grammar parsing proves that referenced tables exist", async () => {
    expect(await migrationSyntaxFailures([{ name: "not-schema-proof.sql", sql: "ALTER TABLE public.unknown_table ADD COLUMN test text;" }])).toEqual([]);
  });
  it("creates the Tiendanube column after the table and guards older environments", () => {
    expect(read("20260430000005_sprint3.sql")).toContain("to_regclass('public.tiendanube_connections') IS NOT NULL");
    expect(read("20260430000006_tiendanube.sql")).toMatch(/CREATE TABLE[\s\S]*webhook_id\s+text/);
  });
  it.each(cronFiles)("%s schedules with a real DO block, not ON CONFLICT on SELECT", file => {
    const sql = read(file);
    expect(sql).toMatch(/DO \$schedule\$/i);
    expect(sql).toMatch(/if not exists[\s\S]*cron\.job[\s\S]*perform cron\.schedule/i);
    expect(sql).not.toMatch(/\)\s*on conflict\s*\(jobname\)/i);
    expect(sql).toMatch(/end;\s*\$schedule\$;/i);
    expect(sql).not.toMatch(/\$\$\s*\)\s*\);/);
  });
  it("references canonical quotes instead of an absent Spanish alias", () => {
    expect(read("20260504000017_payment_links.sql")).toContain("references public.quotes(id)");
  });
  it("adds source columns to preexisting Kardex before indexing them", () => {
    const sql = read("20260505000005_operational_ledgers.sql");
    const add = sql.indexOf("add column if not exists source_id");
    expect(add).toBeGreaterThan(0);
    expect(add).toBeLessThan(sql.indexOf("stock_movements_source_idx"));
  });
  it("hardens Stripe events when created, without altering a missing table", () => {
    expect(read("20260506000004_rls_fixes.sql")).toContain("to_regclass('public.stripe_events') IS NOT NULL");
    const sql = read("20260506000005_stripe_events_idempotency.sql");
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("ENABLE ROW LEVEL SECURITY"));
    expect(sql).toMatch(/AS RESTRICTIVE FOR ALL TO authenticated USING \(false\)/);
  });
  it("uses distinct delimiters for recurring-expense cron and its job body", () => {
    const sql = read("20260506030000_recurring_expenses.sql");
    expect(sql).toContain("DO $recurring_schedule$");
    expect(sql).toMatch(/end;\s*\$recurring_schedule\$;/i);
  });
  it("reconstructs the read-only legacy alias over canonical memberships with invoker RLS", () => {
    const history = read("20260523000003_price_lists.sql");
    expect(history.indexOf("CREATE VIEW public.org_members")).toBeLessThan(history.indexOf('CREATE POLICY "Org members'));
    const security = read("20261007000000_legacy_membership_view_security.sql");
    expect(security).toContain("WITH (security_invoker = true)");
    expect(security).toMatch(/FROM public\.memberships/);
    expect(security).toContain("REVOKE ALL ON public.org_members FROM PUBLIC, anon, authenticated, service_role");
    expect(security).toContain("GRANT SELECT ON public.org_members TO authenticated, service_role");
    expect(security).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE)/);
  });
  it("expands the old bundle and price-list schemas before new indexes/helpers", () => {
    const bundles = read("20260523000013_product_bundles.sql");
    expect(bundles).not.toMatch(/\bsale_price\s+numeric|\bactive\s+boolean/);
    expect(bundles).toContain("ADD COLUMN IF NOT EXISTS sold_count");
    expect(bundles).toContain("product_bundles(org_id, is_active)");
    const prices = read("20260523000021_price_lists.sql");
    expect(prices).toContain("price_lists(org_id, is_active, is_default)");
    expect(prices.indexOf("ADD COLUMN IF NOT EXISTS custom_price")).toBeLessThan(prices.indexOf("CREATE INDEX IF NOT EXISTS idx_pli_org_product"));
    expect(prices).toContain("item.price_list_id = parent.id AND item.org_id IS NULL");
  });
  it("extends canonical webhook logs without a parallel status or deleting legacy deliveries", () => {
    const sql = read("20260523000017_webhooks.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS webhook_id uuid");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).toContain("webhook_deliveries(org_id, delivered, created_at DESC)");
    expect(sql).not.toMatch(/NEW\.status|OLD\.status/);
    expect(sql).toContain("IF NEW.webhook_id IS NULL THEN RETURN NEW");
  });
  it("keeps recurring customer billing separate from the platform SaaS subscription", () => {
    const sql = read("20260523000018_subscriptions.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS customer_subscriptions");
    expect(sql).toContain("REFERENCES customer_subscriptions(id)");
    expect(sql).not.toMatch(/(?:FROM|ON|ALTER TABLE|UPDATE)\s+subscriptions\b/);
    expect(sql).toMatch(/current_period_start timestamptz/);
    expect(sql).toContain('"org_subs" ON customer_subscriptions FOR SELECT TO authenticated');
    expect(sql).toContain("ARRAY[''owner'',''admin'']");
  });
  it("purchase orders, lots and OCR reference the canonical supplier table", () => {
    for (const file of ["20260523000025_purchase_orders.sql", "20260523000039_batch_lot_tracking.sql", "20260523000072_document_ocr.sql"]) {
      expect(read(file)).toContain("REFERENCES public.suppliers(id)");
      expect(read(file)).not.toMatch(/REFERENCES proveedores/);
    }
  });
  it("token defaults use the actual pgcrypto extension schema, not an ambient search path", () => {
    for (const file of ["20260523000051_customer_portal.sql", "20260523000061_api_keys.sql", "20260523000068_ecommerce_store.sql", "20260523000083_vendor_portal.sql"]) {
      expect(read(file)).toContain("extensions.gen_random_bytes");
      expect(read(file)).not.toMatch(/(?<!\.)\bgen_random_bytes\(/);
    }
  });
  it("loyalty and returns share the CRM customer identity", () => {
    for (const file of ["20260523000057_loyalty_advanced.sql", "20260523000062_returns_portal.sql"]) {
      expect(read(file)).toContain("REFERENCES public.customers(id)");
      expect(read(file)).not.toMatch(/REFERENCES clients/);
    }
  });
});
