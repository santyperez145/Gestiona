-- Simulacro de 20261105000900 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Contado igual y vendido después: el stock queda en lo que hay (no se infla).
--   2. Contado con faltante y vendido después: se corrige sólo el faltante.
--   3. Contado al cerrar, sin movimientos después: igual que antes.
--   4. El contrato de cerrar_conteo quedó con el hash nuevo.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_count uuid; v_a uuid; v_b uuid; v_c uuid; r jsonb; v_stock numeric; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Conteo al contar', 'zz-cac-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ A', 'ZZ', 1, 100, 10) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ B', 'ZZ', 1, 100, 10) RETURNING id INTO v_b;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ C', 'ZZ', 1, 100, 10) RETURNING id INTO v_c;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.abrir_conteo(v_org, NULL, 'ZZ toma', false);
  v_count := (r->>'conteo_id')::uuid;
  PERFORM public.registrar_conteo_lote(v_count, jsonb_build_array(
    jsonb_build_object('product_id', v_a, 'cantidad', 10),
    jsonb_build_object('product_id', v_b, 'cantidad', 7)));
  RESET ROLE;

  -- A y B se contaron hace un minuto; después se vendieron 2 de cada uno.
  UPDATE public.stock_count_items SET counted_at = now() - interval '1 minute'
   WHERE count_id = v_count AND product_id IN (v_a, v_b);
  PERFORM public.record_stock_movement(v_org, v_a, NULL, 'ZZ A', NULL, 'sale', -2);
  PERFORM public.record_stock_movement(v_org, v_b, NULL, 'ZZ B', NULL, 'sale', -2);

  -- C se cuenta recién al cerrar.
  SET LOCAL ROLE authenticated;
  PERFORM public.registrar_conteo_lote(v_count, jsonb_build_array(jsonb_build_object('product_id', v_c, 'cantidad', 12)));
  r := public.cerrar_conteo(v_count);
  RESET ROLE;

  -- 1
  SELECT stock INTO v_stock FROM public.products WHERE id = v_a;
  IF v_stock IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'FALLA 1: A quedó en % (esperaba 8; cierre %)', v_stock, r; END IF;
  v_ok := v_ok || '1 ';
  -- 2
  SELECT stock INTO v_stock FROM public.products WHERE id = v_b;
  IF v_stock IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FALLA 2: B quedó en % (esperaba 5)', v_stock; END IF;
  v_ok := v_ok || '2 ';
  -- 3
  SELECT stock INTO v_stock FROM public.products WHERE id = v_c;
  IF v_stock IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'FALLA 3: C quedó en % (esperaba 12)', v_stock; END IF;
  v_ok := v_ok || '3 ';
  -- 4
  IF EXISTS (
    SELECT 1 FROM public.security_function_contracts sfc
      JOIN pg_proc p ON p.proname = sfc.function_name AND pg_get_function_identity_arguments(p.oid) = sfc.identity_arguments
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE sfc.function_name = 'cerrar_conteo' AND sfc.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
  ) THEN RAISE EXCEPTION 'FALLA 4: contrato con otro hash'; END IF;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
