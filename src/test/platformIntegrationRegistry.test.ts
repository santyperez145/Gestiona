import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase', 'migrations', '20260821000049_platform_integration_registry.sql'),
  'utf8',
);
const PAGE = readFileSync(resolve(ROOT, 'src', 'pages', 'PlatformIntegrationsPage.tsx'), 'utf8');
const PLATFORM_PAGE = readFileSync(resolve(ROOT, 'src', 'pages', 'PlatformAdminPage.tsx'), 'utf8');

describe('registro de integraciones de plataforma', () => {
  it('mantiene el catálogo separado de credenciales y restringido a staff', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.platform_integration_registry');
    expect(MIGRATION).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('public.is_platform_admin(auth.uid())');
    expect(MIGRATION).toContain('REVOKE ALL ON public.platform_integration_registry FROM PUBLIC, anon');
    expect(MIGRATION).not.toMatch(/access_token|refresh_token|client_secret|api_key|private_key/i);
  });

  it('expone el estado de producto sin presentarlo como salud de runtime', () => {
    expect(PAGE).toContain('platform_integration_registry');
    expect(PAGE).toContain('La salud de runtime se consulta en Sistema');
    expect(PAGE).toContain('No indica que una cuenta de comercio esté conectada');
    expect(PAGE).toContain('connection_mode');
    expect(PAGE).toContain('lifecycle');
  });

  it('alimenta el resumen desde vistas protegidas, no desde tablas operativas crudas', () => {
    expect(PLATFORM_PAGE).toContain("from('platform_org_health')");
    expect(PLATFORM_PAGE).toContain("from('platform_org_activation')");
    expect(PLATFORM_PAGE).toContain("from('platform_cron_health')");
    expect(PLATFORM_PAGE).toContain('Todavía no hay eventos de operación para medir');
    expect(PLATFORM_PAGE).not.toContain("from('cron.job')");
    expect(PLATFORM_PAGE).not.toContain("from('payment_transactions')");
  });
});
