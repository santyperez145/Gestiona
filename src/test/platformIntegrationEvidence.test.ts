import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('evidencia operativa de integraciones', () => {
  const migration = read('supabase/migrations/20260821000054_platform_integration_evidence.sql');
  const merchant = read('src/pages/PlatformMerchantPage.tsx');

  it('clasifica evidencia existente sin inventar una llamada de health check', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.platform_org_integration_health');
    expect(migration).toContain("'recent_runtime'");
    expect(migration).toContain("'runtime_warning'");
    expect(migration).toContain("'runtime_error'");
    expect(migration).toContain("'stale_runtime'");
    expect(migration).toContain("'configured_only'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain('No es un ping activo al proveedor');
  });

  it('mantiene la vista staff-only y sin secretos', () => {
    expect(migration).toContain('WHERE public.is_platform_admin(auth.uid())');
    expect(migration).toContain('ALTER VIEW public.platform_org_integration_health SET (security_invoker = false)');
    expect(migration).toContain('REVOKE ALL ON public.platform_org_integration_health FROM PUBLIC, anon');
    expect(migration).toContain("'access_token', 'refresh_token', 'api_key', 'api_url'");
    expect(migration).not.toContain('latest.message');
    expect(migration).not.toContain('latest.metadata');
  });

  it('convierte evidencia vencida o sólo configuración en una próxima acción visible', () => {
    expect(merchant).toContain('INTEGRATION_EVIDENCE_META');
    expect(merchant).toContain("'Evidencia vencida'");
    expect(merchant).toContain("'Sólo configuración'");
    expect(merchant).toContain("['configured_only', 'stale_runtime']");
    expect(merchant).toContain("title: 'Verificar evidencia operativa'");
    expect(merchant).toContain('Ejecución reciente” es la última evidencia registrada por un flujo real, no un ping activo');
  });
});
