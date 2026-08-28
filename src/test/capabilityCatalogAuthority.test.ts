import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Capability Catalog como autoridad única', () => {
  const migration = read('supabase/migrations/20260828000130_el_negocio_activa_capacidades.sql');
  const verification = read('supabase/verificaciones/20260828_capability_catalog.sql');
  const helper = read('supabase/functions/_shared/capabilities.ts');
  const inspector = read('supabase/functions/inspect-finance-document/index.ts');
  const extractor = read('supabase/functions/extract-finance-document/index.ts');

  it('versiona catálogo, dependencias, conflictos, activación y settings', () => {
    for (const table of [
      'capability_catalog',
      'capability_dependencies',
      'capability_conflicts',
      'organization_capabilities',
      'capability_settings',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('capability_dependency_prevent_cycle');
    expect(migration).toContain("deactivation_policy IN ('read_only', 'safe_disable', 'requires_cleanup')");
  });

  it('resuelve las cuatro capabilities piloto desde una sola función', () => {
    for (const key of [
      'catalog.products',
      'inventory.core',
      'commerce.store',
      'finance.documents',
    ]) {
      expect(migration).toContain(`'${key}', '1.0.0'`);
    }
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.capability_evaluate');
    expect(migration).toContain('public.organization_product_access');
    expect(migration).toContain('public.feature_flag_habilitada');
    expect(migration).toContain('public.has_permission');
    expect(migration).toContain("'dependency_not_ready:' || v_dependency_key");
    expect(migration).toContain("'capability_conflict:' || v_conflicting_key");
  });

  it('fija wrappers distintos sin dejar que el navegador saltee la identidad', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.organization_capability_access');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.organization_capability_enabled');
    expect(migration).toContain('p_enforce_user boolean');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.organization_capability_access(uuid, text, text) TO authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.organization_capability_enabled(uuid, text) TO service_role');
    expect(migration).toContain('REVOKE ALL ON public.organization_capabilities FROM PUBLIC, anon, authenticated');
    expect(migration).not.toContain('GRANT SELECT ON public.organization_capabilities TO authenticated');
  });

  it('migra la UI y los comandos de Finance sin cambiar su contrato público', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.product_surface_access');
    expect(migration).toContain("THEN 'finance.documents'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finance_document_can');
    expect(migration).toContain("'finance.documents',\n    p_action");
  });

  it('hace que inspección y extracción privilegiadas consulten el mismo evaluador', () => {
    expect(helper).toContain('organization_capability_enabled');
    expect(helper).toContain('data === true');
    for (const worker of [inspector, extractor]) {
      expect(worker).toContain('resolveWorkerCapability');
      expect(worker).toContain('"finance.documents"');
      expect(worker).toContain('No se pudo evaluar la capacidad documental');
    }
  });

  it('prueba dependencias, outsider, ciclos y preservación con rollback y cero restos', () => {
    expect(verification).toContain("'dependency_not_ready:catalog.products'");
    expect(verification).toContain("v_result.blocker <> 'membership_required'");
    expect(verification).toContain('El catálogo aceptó una dependencia cíclica');
    expect(verification).toContain('Desactivar la capability borró datos del catálogo');
    expect(verification).toContain('ROLLBACK;');
    expect(verification).toContain('count(*) AS restos');
  });
});
