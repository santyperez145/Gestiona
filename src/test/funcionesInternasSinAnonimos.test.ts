import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000200_funciones_internas_sin_anonimos.sql"), "utf8");

describe("P0.2: funciones internas sin ejecución anónima", () => {
  it("quita la ejecución pública y anónima a las internas que verifican rol", () => {
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_firma);");
    for (const f of ["anonymize_customer", "api_key_emitir", "finance_set_approval_policy", "save_platform_commission_rule", "provision_platform_organization"]) {
      expect(migration).toContain(`'${f}'`);
    }
  });

  it("deja sólo para el servidor las dos que no deben llamar los usuarios", () => {
    expect(migration).toContain("p.proname IN ('upsert_customer_from_order', 'configure_business_profile')");
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_firma);");
    expect(migration).toContain("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_firma);");
  });

  it("no toca las públicas de la tienda ni los enlaces con token", () => {
    for (const publica of ["save_store_cart", "toggle_wishlist", "upsert_product_review", "register_store_newsletter", "process_email_campaign_unsubscribe", "respond_influencer_invitation"]) {
      expect(migration.slice(migration.indexOf("BEGIN;"))).not.toContain(`'${publica}'`);
    }
  });
});
