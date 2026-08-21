import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('controles de lanzamiento de Checkout Brick', () => {
  const migration = read('supabase/migrations/20260821000053_feature_flag_rollouts.sql');
  const storePay = read('supabase/functions/store-pay/index.ts');
  const platformAction = read('supabase/functions/platform-admin-action/index.ts');
  const controls = read('src/components/platform/FeatureFlagControls.tsx');
  const orderScreen = read('src/storefront/StoreOrder.tsx');

  it('guarda el alcance global y por comercio sin exponer la tabla al navegador', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.feature_flag_overrides');
    expect(migration).toContain('feature_flag_overrides_global_key');
    expect(migration).toContain('feature_flag_overrides_org_key');
    expect(migration).toContain('ALTER TABLE public.feature_flag_overrides ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON public.feature_flag_overrides FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("'zz_flag_rollout_verify'");
    expect(migration).toContain("Feature flags dejó % filas ZZ");
  });

  it('prioriza el override del comercio y audita cambios atómicos de superadmin', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.feature_flag_habilitada');
    expect(migration).toContain('WHERE flag_key = p_flag_key AND org_id = p_org_id');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.platform_feature_flag_configurar');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.platform_feature_flag_eliminar');
    expect(migration).toContain("role = 'superadmin'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('IS NOT DISTINCT FROM p_org_id');
    expect(migration).toContain("'featureFlagSet'");
    expect(migration).toContain("'featureFlagCleared'");
  });

  it('consulta la disponibilidad del Brick en servidor y conserva el redirect conocido', () => {
    expect(storePay).toContain('async function checkoutBrickEnabled');
    expect(storePay).toContain('admin.rpc("feature_flag_habilitada"');
    expect(storePay).toContain('p_flag_key: "checkout_brick"');
    expect(storePay).toContain('fallback: "redirect"');
    expect(storePay).toContain('action === "brick-config" || action === "brick-payment"');
    expect(orderScreen).toContain('const [tarjetaDisponible, setTarjetaDisponible] = useState(true)');
    expect(orderScreen).toContain('config?.fallback === "redirect"');
    expect(orderScreen).toContain('{tarjetaDisponible && (');
  });

  it('usa una Edge Function como frontera del panel y reserva las escrituras para superadmin', () => {
    expect(platformAction).toContain('getFeatureFlags: ["support", "finance"]');
    expect(platformAction).toContain('action === "getFeatureFlags"');
    expect(platformAction).toContain('action === "setFeatureFlag" || action === "clearFeatureFlag"');
    expect(platformAction).toContain('admin.rpc("platform_feature_flag_configurar"');
    expect(platformAction).toContain('admin.rpc("platform_feature_flag_eliminar"');
    expect(controls).toContain("action: 'getFeatureFlags'");
    expect(controls).toContain("action: 'setFeatureFlag'");
    expect(controls).toContain("action: 'clearFeatureFlag'");
    expect(controls).not.toContain("from('feature_flag_overrides')");
    expect(controls).toContain('sólo superadmin puede cambiarlo');
  });
});
