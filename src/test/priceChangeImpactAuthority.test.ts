import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260822000007_price_change_impact_loop.sql',
), 'utf8');
const panel = readFileSync(resolve(
  process.cwd(),
  'src/components/marketing/OfferRecommenderPanel.tsx',
), 'utf8');

describe('price change impact authority', () => {
  it('convierte la recomendación en acción y baseline dentro del mismo RPC', () => {
    expect(migration).toContain('public.apply_ai_offer_recommendation');
    expect(migration).toContain("'applied', v_applied_at");
    expect(migration).toContain('public.price_change_window_metrics');
  });

  it('calcula costo y margen con la autoridad del Business Core', () => {
    expect(migration).toContain('public.precio_pos_autoritativo(');
    expect(migration).toContain('v_resulting_margin_percent < v_min_margin_percent');
  });

  it('no vuelve a romper una venta POS sin override', () => {
    expect(migration).toContain("'override_de_precio', false");
    expect(migration).toContain("'precio_autoritativo', v_precio");
  });

  it('impide que la reversión pise un precio modificado después', () => {
    expect(migration).toContain('IS DISTINCT FROM v_recommendation.applied_price_ars');
    expect(migration).toContain("USING ERRCODE = '40001'");
  });

  it('etiqueta el antes y después como observacional, no causal', () => {
    expect(migration).toContain("interpretation = 'observed_not_causal'");
    expect(panel).toContain('Un antes/después no prueba causalidad');
  });

  it('exige permisos en servidor y replica el control en la interfaz', () => {
    expect(migration).toContain("has_permission(v_recommendation.org_id, 'marketing', 'edit')");
    expect(panel).toContain("useHasPermission('marketing', 'edit')");
  });

  it('no habilita escrituras directas ni ejecución anónima', () => {
    expect(migration).toContain(
      "has_table_privilege(\n       'authenticated', 'public.price_change_impact_events', 'INSERT')",
    );
    expect(migration).toContain(
      "'anon', 'public.measure_price_change_outcome(uuid)', 'EXECUTE'",
    );
  });
});
