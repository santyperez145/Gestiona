import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260925001200_customer_import.sql"), "utf8");
const phoneFix = readFileSync(resolve(root, "supabase/migrations/20260925001400_customer_import_phone_fix.sql"), "utf8");
const customersPage = readFileSync(resolve(root, "src/pages/CustomersPage.tsx"), "utf8");

describe("autoridad de la importación de clientes (C22.2)", () => {
  it("prepara y aplica el lote mediante RPC, nunca escribiendo customers desde el navegador", () => {
    expect(customersPage).toContain('rpc("stage_customer_import"');
    expect(customersPage).toContain('rpc("apply_customer_import"');
    expect(migration).toContain("public.stage_customer_import(");
    expect(migration).toContain("public.apply_customer_import(");
    // El bucle de altas cliente-por-cliente se retiró: la aplicación es atómica.
    expect(customersPage).not.toMatch(/createCustomerDB\(user\.id, \{[^}]*name: get\('name'\)/);
  });

  it("exige owner o admin tanto al preparar como al aplicar", () => {
    expect(migration.match(/has_org_role\([\s\S]{0,80}ARRAY\['owner','admin'\]\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("matchea por email y por teléfono normalizado, nunca por nombre", () => {
    expect(migration).toContain("lower(btrim(COALESCE(email, ''))) = v_email");
    expect(migration).toContain("public.customer_import_phone(to_jsonb(phone)) = v_phone");
    // El normalizador argentino colapsa +54/9/0 al mismo número.
    expect(phoneFix).toContain("regexp_replace(v_digits, '^0054', '')");
    expect(phoneFix).toContain("regexp_replace(v_digits, '^9(?=[0-9]{10})', '')");
    // El nombre no participa del match: "Juan Pérez" y "juan perez" no son claves.
    expect(migration).not.toMatch(/lower\(btrim\(COALESCE\(name/);
  });

  it("no pisa lo cargado a mano ni revive el opt-out de marketing", () => {
    expect(migration).toContain("COALESCE(NULLIF(btrim(COALESCE(phone, '')), ''), v_phone)");
    expect(migration).toContain("notes     = COALESCE(NULLIF(btrim(COALESCE(notes, '')), ''), NULLIF(v_row.normalized->>'notes', ''))");
    // No hay UPDATE que toque marketing_opt_out_at: la baja se respeta.
    expect(migration).not.toMatch(/marketing_opt_out_at\s*=/);
  });

  it("es idempotente: un lote cerrado no re-aplica y el staging reutiliza por hash", () => {
    expect(migration).toContain("IF v_batch.status IN ('completed', 'completed_with_errors') THEN");
    expect(migration).toContain("'reused', true");
    expect(migration).toContain("payload_hash = v_hash");
  });

  it("no permite que anon lea el staging y sólo los RPC escriben", () => {
    expect(migration).toContain("REVOKE ALL ON public.customer_import_batches, public.customer_import_rows FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON public.customer_import_batches, public.customer_import_rows TO authenticated");
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}(INSERT|UPDATE|DELETE)/);
  });
});
