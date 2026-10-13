-- Simulacro de 20261013000100: se concatena después de la migración (sin
-- BEGIN/COMMIT) y termina en ROLLBACK.
--   1. anon ya no ejecuta ninguna de las 23.
--   2. authenticated sigue ejecutando las 22 de pantalla; stock_disponible no.
--   3. La tienda sigue andando: stock_en_vitrina (SECURITY DEFINER, llama a
--      stock_disponible) responde como anon.
DO $$
DECLARE
  v_anon int; v_auth int; v_stock_auth boolean; v_slug text; v_pid uuid; v_r jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE') AND p.proname <> 'stock_disponible')
    INTO v_anon, v_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN (
     'api_key_revocar','approve_support_diagnostic_access','revoke_support_diagnostic_access',
     'get_support_diagnostic_snapshot','approve_platform_commission_rule','retire_platform_commission_rule',
     'finance_approve_expense_request','finance_cancel_expense_request','finance_export_batch_csv',
     'finance_export_mark_exported','finance_list_approval_policies','finance_submit_expense_request',
     'get_audit_summary','ia_consumo_del_mes','impacto_cambio_de_precio','ledger_resultado',
     'ledger_resultado_diario','ledger_saldo','outbox_reintentar','resolve_stock_reservation',
     'suscripcion_de_organizacion','void_activation_intervention','stock_disponible');
  SELECT has_function_privilege('authenticated', 'public.stock_disponible(uuid,uuid,uuid)', 'EXECUTE') INTO v_stock_auth;

  IF v_anon <> 0 THEN RAISE EXCEPTION 'FALLA 1: anon ejecuta % de ellas', v_anon; END IF;
  RAISE NOTICE 'OK 1: anon no ejecuta ninguna';
  IF v_auth <> 22 THEN RAISE EXCEPTION 'FALLA 2: authenticated ejecuta % (esperaba 22)', v_auth; END IF;
  IF v_stock_auth THEN RAISE EXCEPTION 'FALLA 2: authenticated sigue con stock_disponible'; END IF;
  RAISE NOTICE 'OK 2: las de pantalla siguen para authenticated; stock_disponible no';

  SELECT st.slug, p.id INTO v_slug, v_pid
    FROM public.ecommerce_stores st
    JOIN public.products p ON p.org_id = st.org_id AND COALESCE(p.is_active, true)
   WHERE st.is_active
   LIMIT 1;
  IF v_slug IS NULL THEN RAISE NOTICE 'OK 3: sin tienda activa para probar'; RETURN; END IF;
  SET LOCAL ROLE anon;
  v_r := public.stock_en_vitrina(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_pid)));
  RESET ROLE;
  RAISE NOTICE 'OK 3: stock_en_vitrina responde como anon (%)', left(v_r::text, 40);
END $$;

ROLLBACK;
