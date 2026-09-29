BEGIN;

-- Las tablas históricas son proyecciones contables, no formularios. La única
-- escritura autenticada válida es el RPC de retiro/liquidación, que valida
-- saldo, aprobación, referencia externa e impacto en Finance.
DROP POLICY IF EXISTS "Org admins manage influencer_sales" ON public.influencer_sales;
DROP POLICY IF EXISTS "Org members read influencer_sales" ON public.influencer_sales;
DROP POLICY IF EXISTS "Org admins manage payouts" ON public.influencer_payouts;
DROP POLICY IF EXISTS "Org members read payouts" ON public.influencer_payouts;

DROP POLICY IF EXISTS influencer_sales_brand_read ON public.influencer_sales;
CREATE POLICY influencer_sales_brand_read
  ON public.influencer_sales
  FOR SELECT TO authenticated
  USING (public.can_manage_influencers(org_id, 'view'));

DROP POLICY IF EXISTS influencer_payouts_brand_read ON public.influencer_payouts;
CREATE POLICY influencer_payouts_brand_read
  ON public.influencer_payouts
  FOR SELECT TO authenticated
  USING (public.can_manage_influencers(org_id, 'view'));

REVOKE ALL ON TABLE public.influencer_sales FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.influencer_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.influencer_sales TO authenticated;
GRANT SELECT ON TABLE public.influencer_payouts TO authenticated;

COMMENT ON TABLE public.influencer_sales IS
  'Comisiones derivadas de ventas confirmadas. Sólo procesos server-side crean o liquidan filas.';
COMMENT ON TABLE public.influencer_payouts IS
  'Historial de liquidaciones confirmado por la autoridad de retiros; no admite altas directas desde UI.';

DO $guard$
BEGIN
  IF has_table_privilege('authenticated', 'public.influencer_sales', 'INSERT')
     OR has_table_privilege('authenticated', 'public.influencer_sales', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.influencer_sales', 'DELETE')
     OR has_table_privilege('authenticated', 'public.influencer_payouts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.influencer_payouts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.influencer_payouts', 'DELETE') THEN
    RAISE EXCEPTION 'Las comisiones o payouts siguen mutables desde el navegador';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.influencer_sales', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.influencer_payouts', 'SELECT') THEN
    RAISE EXCEPTION 'La marca perdió lectura de comisiones o payouts';
  END IF;
END;
$guard$;

COMMIT;
