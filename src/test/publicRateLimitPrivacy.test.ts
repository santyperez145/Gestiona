import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(join(
  root,
  'supabase/migrations/20260904000060_hash_public_rate_limit_subjects.sql',
), 'utf8');

describe('privacidad del límite público', () => {
  it('conserva el rate limit por origen sin persistir la IP en claro', () => {
    expect(migration).toContain('v_subject := public.ip_del_request()');
    expect(migration).toContain("v_subject := 'ip_sha256:' || encode(");
    expect(migration).toContain('extensions.digest');
    expect(migration).toContain('public.rate_limit_consumir(');
  });

  it('retira las claves legacy y no abre la función auxiliar', () => {
    expect(migration).toContain('DELETE FROM public.rate_limits');
    expect(migration).toContain("clave NOT LIKE '%:ip_sha256:%'");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });
});
