import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260821000061_activation_cohorts.sql',
  'utf8',
);
const merchantPanel = readFileSync(
  'src/components/platform/ActivationInterventionsPanel.tsx',
  'utf8',
);
const metricsPage = readFileSync('src/pages/PlatformMetricsPage.tsx', 'utf8');

describe('autoridad de cohortes de activación', () => {
  it('sólo Support o Superadmin pueden registrar y anular ayuda', () => {
    const recordRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.record_activation_intervention'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.void_activation_intervention'),
    );
    const voidRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.void_activation_intervention'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.record_activation_intervention'),
    );
    expect(recordRpc).toContain("has_platform_role(ARRAY['support']");
    expect(voidRpc).toContain("has_platform_role(ARRAY['support']");
  });

  it('authenticated no puede leer ni mutar la tabla cruda', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.activation_interventions FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain(
      'REVOKE ALL ON public.platform_metric_watermarks FROM PUBLIC, anon, authenticated',
    );
  });

  it('las vistas seguras no exponen actores, idempotencia, secretos ni PII', () => {
    expect(migration).toContain("'actor_user_id', 'voided_by', 'idempotency_key', 'notes', 'email'");
    expect(migration).toContain("'access_token', 'refresh_token', 'api_key', 'private_key', 'certificate'");
    const publicView = migration.slice(
      migration.indexOf('CREATE OR REPLACE VIEW public.platform_activation_interventions'),
      migration.indexOf('ALTER VIEW public.platform_activation_interventions'),
    );
    expect(publicView).not.toContain('actor_user_id');
    expect(publicView).not.toContain('idempotency_key');
  });

  it('un retry conserva un solo evento y rechaza reutilizar la clave con otros datos', () => {
    expect(migration).toContain('activation_interventions_actor_key_unique');
    expect(migration).toContain('p_occurred_at timestamptz DEFAULT NULL');
    expect(migration).toContain('p_occurred_at IS NOT NULL');
    expect(migration).toContain('Idempotency key was already used with different data');
  });

  it('autoservicio sólo se clasifica después del watermark', () => {
    const memberView = migration.slice(
      migration.indexOf('CREATE OR REPLACE VIEW public.platform_activation_cohort_members'),
      migration.indexOf('ALTER VIEW public.platform_activation_cohort_members'),
    );
    expect(memberView).toContain('support_measurement_started_at');
    expect(memberView).toContain('s.org_created_at >= measurement.support_measurement_started_at');
    expect(memberView).toContain('self_service_activated');
  });

  it('las tasas 7/14/30 excluyen cohortes que todavía no maduraron', () => {
    expect(migration).toContain("m.org_created_at <= now() - interval '7 days'");
    expect(migration).toContain("m.org_created_at <= now() - interval '14 days'");
    expect(migration).toContain("m.org_created_at <= now() - interval '30 days'");
  });

  it('Merchant 360 usa RPC y no escribe la tabla ni acepta notas libres', () => {
    expect(merchantPanel).toContain("supabase.rpc('record_activation_intervention'");
    expect(merchantPanel).toContain("supabase.rpc('void_activation_intervention'");
    expect(merchantPanel).not.toMatch(/from\(['"]activation_interventions['"]\)/);
    expect(merchantPanel).not.toContain('<Textarea');
    expect(merchantPanel).not.toContain('p_notes');
  });

  it('el dashboard consume cohortes reales y no renombra primer cobro', () => {
    expect(metricsPage).toContain('platform_activation_cohorts');
    expect(metricsPage).toContain('platform_activation_cohort_members');
    const activationTab = metricsPage.slice(
      metricsPage.indexOf('<TabsContent value="activation"'),
      metricsPage.indexOf('<TabsContent value="stock"'),
    );
    expect(activationTab).toContain('venta en canal objetivo');
    expect(activationTab).not.toContain('metrics.activationTimes');
    expect(activationTab).not.toMatch(/label=["'](?:Con |Sin )?primer cobro/i);
  });
});
