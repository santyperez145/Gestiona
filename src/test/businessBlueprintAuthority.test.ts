import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260828000140_el_perfil_se_convierte_en_blueprint.sql');
const client = read('src/lib/businessProfile.ts');

describe('autoridad de Blueprint y Provisioning', () => {
  it('persiste Blueprint, corrida y checklist sin escritura directa del navegador', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.organization_blueprints');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.provisioning_runs');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.provisioning_steps');
    expect(migration).toContain('REVOKE ALL ON public.provisioning_runs FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("ARRAY['owner','admin']");
  });

  it('serializa por organizacion y reusa la misma idempotency key', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('UNIQUE (org_id, idempotency_key)');
    expect(migration).toContain("IF v_run.status = 'succeeded' THEN");
    expect(migration).toContain("jsonb_build_object('replayed', true)");
  });

  it('revierte el dominio completo y conserva el fallo recuperable', () => {
    expect(migration).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(migration).toContain("'transaction_rollback'");
    expect(migration).toContain("WHEN step_order < v_current_order THEN 'compensated'");
    expect(migration).toContain('attempt_count = attempt_count + 1');
  });

  it('orquesta las autoridades existentes en vez de duplicarlas', () => {
    expect(migration).toContain('public.configure_business_profile(p_org_id, p_industry_code)');
    expect(migration).toContain('public.seed_default_permissions(p_org_id)');
    expect(migration).toContain('public.seed_crm_pipeline(p_org_id)');
    expect(migration).not.toMatch(/UPDATE public\.products\s+SET\s+stock/i);
  });

  it('el cliente ya no puede saltar Blueprint', () => {
    expect(client).toContain("supabase.rpc('provision_business_blueprint'");
    expect(client).not.toContain("supabase.rpc('configure_business_profile'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.configure_business_profile(uuid, text) FROM authenticated');
  });
});
