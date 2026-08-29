import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const migration = readFileSync(resolve(root, 'supabase/migrations/20260821000050_evolution_credentials_hardening.sql'), 'utf8');
const endpoint = readFileSync(resolve(root, 'supabase/functions/evolution-credentials/index.ts'), 'utf8');
const resolver = readFileSync(resolve(root, 'supabase/functions/_shared/evolutionConnection.ts'), 'utf8');
const snapshot = readFileSync(resolve(root, 'supabase/functions/_shared/organizationSnapshot.ts'), 'utf8');
const retirement = readFileSync(resolve(root, 'supabase/migrations/20260828000210_settings_deja_de_aceptar_tokens.sql'), 'utf8');

describe('credenciales Evolution API', () => {
  it('migra las credenciales a un almacén sin policies y deja una vista sanitizada', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.evolution_connections');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.evolution_connections FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('v_policies <> 0');
    expect(migration).toContain('CREATE OR REPLACE VIEW public.evolution_connection_status');
    expect(migration).toContain('WHERE public.is_org_member(c.org_id, auth.uid())');
    expect(migration).toContain('evolution_api_key = NULL');
    expect(migration).toContain('reject_legacy_evolution_settings_credentials');
    expect(migration).not.toContain('api_key AS');
    expect(migration).not.toContain('api_url AS');
  });

  it('exige usuario y rol administrativo antes de guardar o revocar', () => {
    expect(endpoint).toContain('requireUser');
    expect(endpoint).toContain(".in('role', ['owner', 'admin'])");
    expect(endpoint).toContain("action === 'revoke'");
    expect(endpoint).toContain(".from('evolution_connections').upsert");
    expect(endpoint).toContain(".from('evolution_connections').delete()");
    expect(endpoint).not.toContain('apiKey: apiKey');
  });

  it('usa un único resolvedor y nunca incluye la conexión en snapshots', () => {
    expect(resolver).toContain(".from('evolution_connections')");
    expect(resolver).not.toContain(".from('settings')");
    expect(retirement).toContain('DROP COLUMN IF EXISTS evolution_api_key');
    expect(retirement).toContain('DROP FUNCTION IF EXISTS public.reject_legacy_evolution_settings_credentials()');
    expect(snapshot).toContain('"evolution_connections"');
  });
});
