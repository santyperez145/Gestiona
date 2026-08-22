import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read('supabase/migrations/20260821000059_activation_readiness.sql');
const DASHBOARD = read('src/pages/Dashboard.tsx');
const MERCHANT_360 = read('src/pages/PlatformMerchantPage.tsx');
const ONBOARDING = read('src/pages/OnboardingPage.tsx');
const CHECKLIST = read('src/components/dashboard/SetupChecklist.tsx');

describe('instrumentación de activación', () => {
  it('expone una vista autenticada y niega la superficie anónima', () => {
    expect(MIGRATION).toContain('REVOKE ALL ON public.organization_activation_readiness FROM PUBLIC, anon');
    expect(MIGRATION).toContain('GRANT SELECT ON public.organization_activation_readiness TO authenticated');
    expect(MIGRATION).toContain('public.is_org_member(o.id, auth.uid())');
    expect(MIGRATION).toContain('public.is_platform_admin(auth.uid())');
  });

  it('usa una sola fuente en el comercio y en Merchant 360', () => {
    expect(DASHBOARD).toContain(".from('organization_activation_readiness')");
    expect(MERCHANT_360).toContain(".from('organization_activation_readiness')");
    expect(DASHBOARD).toContain('evaluateActivationReadiness(activationSignals)');
    expect(MERCHANT_360).toContain('evaluateActivationReadiness(snapshot.readiness)');
  });

  it('persiste el objetivo explícito desde el onboarding', () => {
    expect(ONBOARDING).toContain('completeBusinessOnboarding({');
    expect(ONBOARDING).toContain('onboardingGoal,');
    expect(ONBOARDING).toContain("finish('pos')");
    expect(ONBOARDING).toContain("finish('online')");
    expect(ONBOARDING).toContain("?onboarding=1&goal=online");
  });

  it('no confunde exploración opcional con estar listo para vender', () => {
    expect(CHECKLIST).toContain('Ruta a la primera venta');
    expect(CHECKLIST).toContain('no falsean esta medición de activación');
    expect(CHECKLIST).not.toContain('Registrar tu primer canje');
    expect(CHECKLIST).not.toContain('Invitar a tu equipo');
  });

  it('requiere evidencia fiscal real y no sólo credenciales cargadas', () => {
    expect(MIGRATION).toContain("NULLIF(btrim(COALESCE(i.cae, '')), '') IS NOT NULL");
    expect(MIGRATION).toContain("THEN 'falta_verificar_ciclo'");
    expect(MIGRATION).toContain("= 'listo') AS fiscal_ready");
  });
});
