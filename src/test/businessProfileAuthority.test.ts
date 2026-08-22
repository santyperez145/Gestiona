import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260822000001_business_profiler.sql');
const onboarding = read('src/pages/OnboardingPage.tsx');
const manager = read('src/components/products/ProductTypesManager.tsx');

describe('autoridad del Business Profiler', () => {
  it('limita configurar y completar onboarding a owner/admin', () => {
    const configureRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.configure_business_profile'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_business_onboarding'),
    );
    const onboardingRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_business_onboarding'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.configure_business_profile'),
    );
    expect(configureRpc).toContain("ARRAY['owner','admin']");
    expect(onboardingRpc).toContain("ARRAY['owner','admin']");
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON public.organization_business_profiles FROM authenticated');
  });

  it('preserva tipos propios y no crea autoridades paralelas por vertical', () => {
    expect(migration).toContain("IF v_type_source = 'custom' THEN");
    expect(migration).toContain("'status', 'skipped_custom'");
    expect(migration).not.toMatch(/CREATE TABLE[^;]*(perfume|vape|indumentaria|tecnologia|cosmetica|alimento)/i);
    expect(migration).not.toMatch(/UPDATE public\.products\s+SET\s+stock/i);
  });

  it('onboarding usa una sola transaccion del servidor', () => {
    expect(onboarding).toContain('completeBusinessOnboarding({');
    expect(onboarding).not.toMatch(/from\(['"]organizations['"]\)\s*\n?\s*\.update/);
    expect(onboarding).not.toMatch(/from\(['"]settings['"]\)\s*\n?\s*\.update/);
  });

  it('el gestor aplica el perfil por RPC y nunca escribe la tabla de perfiles', () => {
    expect(manager).toContain('configureBusinessProfile(orgId, selectedIndustryCode)');
    expect(manager).not.toMatch(/from\(['"]organization_business_profiles['"]\)\.(insert|update|upsert|delete)/);
  });
});
