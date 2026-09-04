import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904000120_security_contracts.sql"),
  "utf8",
);

describe("contratos de seguridad de funciones", () => {
  it("revoca de forma explícita los roles de navegador", () => {
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("'costo_unitario_ars'");
    expect(migration).toContain("'seed_demo_data'");
    expect(migration).toContain("'is_email_suppressed'");
  });

  it("las RPC interactivas validan tenant y capacidad en la base", () => {
    expect(migration).toContain("has_org_role(p_org_id, v_actor, ARRAY['owner','admin'])");
    expect(migration).toContain("has_permission(p_org_id, 'customers', 'edit')");
    expect(migration).toContain("customer.id = p_entity_id AND customer.org_id = p_org_id");
    expect(migration).toContain("has_permission(p_org_id, 'purchases', 'create')");
  });

  it("oculta la topología de mensajería a los comercios", () => {
    expect(migration).toContain("v_privileged := auth.role() = 'service_role'");
    expect(migration).toContain("CASE WHEN v_privileged THEN v_config.smtp_host ELSE NULL END");
    expect(migration).toContain("CASE WHEN v_privileged THEN v_config.smtp_user ELSE NULL END");
    expect(migration).toContain("WHEN v_privileged THEN v_config.whatsapp_phone_number_id ELSE NULL END");
  });

  it("versiona excepciones y detecta cambios de implementación", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.security_function_contracts");
    expect(migration).toContain("definition_hash text NOT NULL");
    expect(migration).toContain("contract.definition_hash = md5(pg_get_functiondef(procedure.oid))");
    expect(migration).toContain("ASSERT v_count = 0, 'funciones sin contrato:");
  });

  it("audita el tipo de retorno antes de acusar una filtración de costo", () => {
    expect(migration).toContain("JOIN pg_type return_type");
    expect(migration).toContain("attribute.attrelid = return_type.typrelid");
    expect(migration).toContain("attribute.attname ~* '(costo|cost|margen|profit|ganancia)'");
  });
});
