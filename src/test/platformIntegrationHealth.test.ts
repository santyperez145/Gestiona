import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase', 'migrations', '20260821000051_platform_org_integration_health.sql'),
  'utf8',
);
const PAGE = readFileSync(resolve(ROOT, 'src', 'pages', 'PlatformMerchantPage.tsx'), 'utf8');

describe('salud de integraciones en Merchant 360', () => {
  it('construye una vista staff-only y sanitizada por comercio', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE VIEW public.platform_org_integration_health');
    expect(MIGRATION).toContain('WHERE public.is_platform_admin(auth.uid())');
    expect(MIGRATION).toContain('ALTER VIEW public.platform_org_integration_health SET (security_invoker = false)');
    expect(MIGRATION).toContain('REVOKE ALL ON public.platform_org_integration_health FROM PUBLIC, anon');
    expect(MIGRATION).toContain('SELECT l.event, l.status, l.created_at');
    expect(MIGRATION).not.toContain('latest.message');
    expect(MIGRATION).not.toContain('latest.metadata');
  });

  it('usa la vista protegida y no consulta las tablas de credenciales desde el navegador', () => {
    expect(PAGE).toContain("from('platform_org_integration_health')");
    expect(PAGE).toContain('No hay evidencia de conexiones para este comercio');
    expect(PAGE).toContain('no que el proveedor esté disponible en este instante');
    expect(PAGE).not.toContain("from('payment_connections')");
    expect(PAGE).not.toContain("from('meli_connections')");
    expect(PAGE).not.toContain("from('afip_credentials')");
    expect(PAGE).not.toContain("from('evolution_connections')");
  });
});
