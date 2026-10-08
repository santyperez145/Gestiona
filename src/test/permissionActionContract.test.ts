import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261008000300_permission_action_contract.sql','utf8');
describe('contrato server-side de permisos', () => {
  it('rechaza acciones invalidas y contexto ausente antes de resolver defaults', () => {
    const guard = migration.slice(migration.indexOf('BEGIN\n  IF'), migration.indexOf('SELECT role INTO'));
    expect(guard).toContain('p_action IS NULL');
    expect(guard).toContain("p_action NOT IN ('view','create','edit','delete','export')");
    expect(guard).toContain('auth.uid() IS NULL');
    expect(guard).toContain('RETURN false');
  });
  it('preserva tenant, overrides y search_path sin crear otra matriz', () => {
    expect(migration).toContain('user_id = auth.uid()');
    expect(migration).toContain("CASE WHEN v_role IN ('owner','admin') THEN 'admin'");
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).not.toContain('CREATE TABLE');
    expect(migration).not.toContain('schema_migrations');
  });
});
