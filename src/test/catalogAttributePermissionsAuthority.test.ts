import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261009000010_catalog_attribute_permissions.sql', 'utf8');
const drill = readFileSync('supabase/verificaciones/20261009_catalog_attribute_permissions.sql', 'utf8');
const tables = ['product_types', 'attribute_definitions', 'product_attribute_values'];
function policy(name: string) {
  const body = migration.match(new RegExp(`CREATE POLICY ${name}\\s+[\\s\\S]*?;`))?.[0];
  if (!body) throw new Error(`Missing policy ${name}`);
  return body;
}

describe('typed catalog permissions use the canonical tenant/action authority', () => {
  it('removes every legacy ALL-members write policy and separates each action', () => {
    for (const table of tables) {
      expect(migration).toContain(`DROP POLICY IF EXISTS ${table}_org_access ON public.${table}`);
      for (const action of ['read', 'insert', 'update', 'delete']) expect(policy(`${table}_${action}`)).toContain('TO authenticated');
    }
    expect(migration).not.toMatch(/CREATE POLICY[^;]+FOR ALL/i);
    expect(migration).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\.(?:has_permission|is_org_member)/i);
  });

  it('requires active membership and permits descriptive POS reads without configuring schema', () => {
    for (const table of tables) {
      const read = policy(`${table}_read`);
      expect(read).toContain('public.is_org_member(org_id, auth.uid())');
      expect(read).toContain("public.has_permission(org_id, 'products', 'view') OR public.has_permission(org_id, 'sales', 'create')");
    }
    for (const table of tables.slice(0, 2)) {
      for (const action of ['insert', 'update', 'delete']) {
        expect(policy(`${table}_${action}`)).toContain("public.has_permission(org_id, 'products', 'edit')");
        expect(policy(`${table}_${action}`)).not.toContain("'sales'");
      }
    }
  });

  it('limits create-only initial values to the current author product, while edits and cleanup require edit', () => {
    const insert = policy('product_attribute_values_insert');
    expect(insert).toContain("public.has_permission(org_id, 'products', 'edit') OR (");
    expect(insert).toContain("public.has_permission(org_id, 'products', 'create')");
    expect(insert).toContain('product.id = product_attribute_values.product_id');
    expect(insert).toContain('product.org_id = product_attribute_values.org_id');
    expect(insert).toContain('product.user_id = auth.uid()');
    expect(insert).not.toMatch(/product\.(?:id|org_id)\s*=\s*(?:product_id|org_id)\b/);
    for (const table of tables) {
      for (const action of ['insert', 'update', 'delete']) expect(policy(`${table}_${action}`)).toContain('public.is_org_member(org_id, auth.uid())');
      expect(policy(`${table}_update`)).toContain('USING');
      expect(policy(`${table}_update`)).toContain('WITH CHECK');
    }
    expect(policy('product_attribute_values_update')).not.toContain("'create'");
    expect(policy('product_attribute_values_delete')).not.toContain("'create'");
  });

  it('binds definitions to the outer tenant instead of a tautological inner column', () => {
    for (const action of ['insert', 'update']) {
      const check = policy(`attribute_definitions_${action}`);
      expect(check).toContain('product_type.id = attribute_definitions.product_type_id');
      expect(check).toContain('product_type.org_id = attribute_definitions.org_id');
      expect(check).not.toMatch(/product_type\.org_id\s*=\s*org_id\b/);
    }
  });

  it('keeps org_id immutable for every role without JWT/session override branches', () => {
    const guard = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.catalog_attribute_org_immutable'), migration.indexOf('REVOKE ALL ON FUNCTION public.catalog_attribute_org_immutable'));
    expect(guard).toContain('IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN');
    expect(guard).toContain("USING ERRCODE = '42501'");
    expect(guard).not.toContain('SECURITY DEFINER');
    expect(guard).not.toMatch(/auth\.role|current_user|session_user|current_setting|service_role/);
    for (const table of tables) expect(migration).toContain(`BEFORE UPDATE OF org_id ON public.${table}`);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.catalog_attribute_org_immutable() FROM PUBLIC, anon, authenticated');
  });

  it('retires historical TRUNCATE/TRIGGER privileges and grants only browser CRUD under RLS', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_types, public.attribute_definitions, public.product_attribute_values TO authenticated, service_role;');
    expect(migration).toContain('GRANT SELECT ON public.products TO authenticated, service_role;');
    expect(migration).not.toMatch(/GRANT ALL|FORCE ROW LEVEL SECURITY|auth\.role\(\)|ALTER ROLE/i);
    expect(migration).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:products|product_types|attribute_definitions|product_attribute_values)\b/i);
  });

  it('drills real roles, CRUD denial, authorized editor, create-only, POS, revocation, suspension and cleanup', () => {
    expect(drill).toMatch(/^BEGIN;$/m);
    expect(drill).toMatch(/ROLLBACK;/);
    expect(drill).toContain('SET LOCAL ROLE authenticated');
    expect(drill).toContain('SET LOCAL ROLE service_role');
    expect(drill).toContain("current_user <> 'authenticated'");
    expect(drill).toContain("'role','service_role'");
    expect(drill).toContain('SET suspendido_por_plan=true');
    expect(drill).toContain('product_type_id=v_ctx.foreign_type_id');
    expect(drill).toContain("'Create-only actor added a value to another author product'");
    expect(drill).toContain("'Create-only actor added a value to another author foreign tenant product'");
    expect(drill).toContain("'Real service role bypassed immutable catalog tenant identity'");
    expect(drill).toContain('residual_fixture_users');
    expect(drill).toContain('residual_fixture_orgs');
    expect(drill).not.toMatch(/GRANT[^;]+ON public\./i);
    expect(drill).not.toContain('encrypted_password');
  });
});
