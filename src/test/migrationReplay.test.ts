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
  it("extends the existing audit table before severity indexes without exposing actor spoofing", () => {
    const sql = read("20260523000060_audit_log.sql");
    expect(sql.indexOf("ADD COLUMN IF NOT EXISTS severity")).toBeLessThan(sql.indexOf("idx_audit_severity"));
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.log_audit_event\([^;]+TO service_role/);
  });
  it("does not reintroduce a second webhook state or timestamp for historical prices", () => {
    expect(read("20260523000061_api_keys.sql")).toContain("webhook_deliveries(webhook_id, delivered, created_at DESC)");
    expect(read("20260523000071_pricing_engine.sql")).toContain("price_history(org_id, product_id, created_at DESC)");
  });
  it("constructs cohort SQL without unsupported DISTINCT windows or guessed CRM identity", () => {
    const sql = read("20260523000067_bi_reports.sql");
    expect(sql).toContain("REFERENCES public.customers(id) ON DELETE SET NULL");
    expect(sql).toContain("cohort_sizes AS");
    expect(sql).toContain("EXTRACT(YEAR FROM AGE");
    expect(sql).not.toMatch(/COUNT\(DISTINCT[^;]+OVER/);
  });
  it("preserves existing FX observations and rejects absent quotes instead of a fabricated 1:1 rate", () => {
    const sql = read("20260523000069_multi_currency.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS valid_from timestamptz");
    expect(sql).toContain("Missing verified exchange rate");
    expect(sql).not.toContain("COALESCE(v_rate, 1)");
  });
  it("keeps v1 alert rules intact and creates the same scoped v2 authority as July", () => {
    const sql = read("20260523000082_smart_alerts_engine.sql");
    expect(sql).not.toMatch(/(?:ON|TABLE|REFERENCES) alert_rules\b/);
    expect(sql).toContain("REFERENCES smart_alert_rules(id)");
    expect(sql).toContain('"admin write smart_rules"');
    expect(sql).toContain("ARRAY['owner','admin']");
  });
  it("keeps subscription replacement explicit and does not recreate the retired NPS module", () => {
    expect(read("20260727000002_customer_subscriptions.sql")).toMatch(/DROP FUNCTION IF EXISTS public\.renew_subscription\(uuid\)/i);
    const nps = read("20260731000018_nps_insert_guard.sql");
    expect(nps).toContain("to_regclass('public.nps_responses') IS NULL");
    expect(nps).toContain("s.org_id = nps_responses.org_id");
    expect(nps).not.toMatch(/CREATE TABLE/);
  });
  it("compares actual identities and fiscal credentials instead of requiring production cohorts", () => {
    expect(read("20260825000001_rubro_sin_default.sql")).toContain("ASSERT v_before IS NOT DISTINCT FROM v_after");
    const fiscal = read("20260827000050_ningun_comercio_guarda_su_certificado.sql");
    expect(fiscal).toContain("v_before IS NOT DISTINCT FROM v_after");
    expect(fiscal).toContain("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_before");
    expect(fiscal).toContain("conname = 'afip_credentials_sin_certificado_propio' AND convalidated");
    const cleanup = read("20260827000130_los_clientes_de_prueba_se_van.sql");
    expect(cleanup).toContain("ASSERT v_before = v_after");
    expect(cleanup).toContain("NOT EXISTS (SELECT 1 FROM public.sales");
    expect(cleanup).not.toMatch(/ASSERT v_reales = 25|ASSERT v_pago = 1|ASSERT v_ventas = 2/);
  });
  it("does not require a real merchant to install fixtures or claim skipped fixtures were tested", () => {
    for (const file of ["20260827000030_ser_miembro_no_es_tener_el_permiso.sql",
      "20260828000080_se_va_el_trigger_que_finge_auditar.sql", "20260902000110_tienda_siembra_zonas.sql"]) {
      const sql = read(file);
      expect(sql).toMatch(/RAISE NOTICE 'Fixture[^']*omitid/i);
      expect(sql).toMatch(/RETURN;/);
      expect(sql).toMatch(/ASSERT|RAISE EXCEPTION/);
    }
    const audit = read("20260828000080_se_va_el_trigger_que_finge_auditar.sql");
    expect(audit.indexOf("ASSERT v_n = 0, 'el trigger sigue colgado de sales'"))
      .toBeLessThan(audit.indexOf("RAISE NOTICE 'Fixture"));
  });
  it("keeps cron invocation fail-closed even when an empty Preview lacks deployment secrets", () => {
    const sql = read("20260828000090_el_cron_se_identifica.sql");
    expect(sql).toMatch(/IF v_secret IS NULL THEN\s+RAISE EXCEPTION/);
    expect(sql).toContain("'x-cron-secret', v_secret");
    expect(sql).toContain("Vault de cron sin configurar: se verifica el contrato, no ejecución externa");
    expect(sql).toContain("configuración parcial: falta BACKUP_CRON_SECRET");
  });
  it("keeps unused cost-bearing helpers internal rather than suppressing their auditor", () => {
    const sql = read("20260828000160_las_funciones_internas_no_son_anonimas.sql");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.generate_bi_snapshot(uuid, date) FROM PUBLIC, anon, authenticated");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_pricing_rules[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM public.audit_costo_expuesto) THEN");
    expect(sql).not.toMatch(/DROP VIEW|CREATE OR REPLACE VIEW/);
  });
  it("makes server reference/cache RLS explicit and preserves bank reconciliation rows", () => {
    for (const [file, table] of [["20260523000065_afip_integration.sql", "afip_padron_cache"],
      ["20260523000069_multi_currency.sql", "currencies"]]) {
      const sql = read(file);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`);
    }
    const bank = read("20260903000100_bank_reconciliation_engine.sql");
    expect(bank).not.toMatch(/DROP TABLE/);
    expect(bank).toContain("ALTER TABLE public.finance_bank_reconciliations ENABLE ROW LEVEL SECURITY");
    expect(bank).toContain("USING (public.has_permission(org_id, 'expenses', 'view'))");
  });
  it("bootstraps influencers without invented completions, payouts or a second user authority", () => {
    const sql = read("20260917000100_influencer_platform_complete.sql");
    expect(sql).toContain("REFERENCES auth.users(id)");
    expect(sql).not.toContain("public.current_org_id()");
    expect(sql).not.toMatch(/INSERT INTO public\.influencer_(?:deliverables|payments)/);
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(read("20260918000000_alter_organization_product_access_for_influencers.sql")).not.toContain("DROP FUNCTION");
  });
  it("guards absent stock overload ACLs and versions only the reviewed public stock contract", () => {
    const sql = read("20260920000100_stock_disponible_compat.sql");
    expect(sql).toContain("to_regprocedure('public.stock_disponible(uuid)') IS NOT NULL");
    expect(sql).toContain("to_regprocedure('public.stock_disponible(uuid,uuid)') IS NOT NULL");
    expect(sql).toContain("WHERE p.oid = 'public.stock_disponible(uuid,uuid,uuid)'::regprocedure");
    expect(sql).toContain("'public_storefront'");
  });
  it("does not whitelist legacy monetary referral-code routes as private capability tokens", () => {
    const sql = read("20260922000800_security_hardening_creator_anon.sql");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_creator_earnings\(text\),[\s\S]+?FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/\('request_creator_withdrawal', 'public_token'/);
    expect(sql).toContain("ASSERT v_count = 0, 'funciones SECURITY DEFINER sin contrato:");
    expect(read("20260922000300_creator_withdrawals.sql")).toContain("ALTER TABLE public.influencer_withdrawal_requests ENABLE ROW LEVEL SECURITY");
  });
  it("preserves the full reputation return type installed earlier in timestamp order", () => {
    const sql = read("20260925002100_influencer_creator_reputation.sql");
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(sql).toContain("pg_get_function_result(v_oid) LIKE '%verified_metrics%'");
    expect(sql).toContain("pg_get_function_result(v_oid) LIKE '%last_verified_at%'");
    expect(sql).toContain("pg_get_functiondef(v_oid) LIKE '%can_manage_influencers%'");
  });
  it("provisions profiles and workspaces through separate triggers and the canonical membership timestamp", () => {
    const sql = read("20260421111259_3716c58c-698d-4721-a584-6a9febe970e4.sql");
    expect(sql).not.toContain("PERFORM public.handle_new_user_create_org()");
    expect(sql).toContain("FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_create_org()");
    expect(sql).toContain("ON CONFLICT (user_id) DO NOTHING");
    for (const file of ["20260827000220_el_plan_manda_sobre_los_limites.sql", "20260828000100_el_aviso_llega_donde_se_puede_leer.sql"]) {
      expect(read(file)).toContain("m.joined_at ASC");
      expect(read(file)).not.toContain("COALESCE(m.joined_at, m.created_at)");
    }
    expect(read("20261007000000_legacy_membership_view_security.sql")).toContain("GRANT SELECT ON public.memberships TO authenticated, service_role");
  });
  it("runs the standalone QR proof with its own actor and rollback, not an existing merchant", () => {
    const sql = readFileSync(resolve("supabase/verificaciones/20261007_pos_qr_payment_evidence.sql"), "utf8");
    expect(sql).toContain("v_user uuid := gen_random_uuid()");
    expect(sql).toContain('"account_type":"store_customer"');
    expect(sql).not.toMatch(/SELECT user_id.*FROM public.memberships/);
    expect(sql).toContain("ROLLBACK;");
    expect(sql).toContain("AS residual_users");
  });
});
