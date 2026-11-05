-- Simulacro de 20261106000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin conteos, todo aparece como «Nunca se contó» y el que más plata
--      movió es clase A y va primero.
--   2. Lo contado hoy no aparece; lo vencido que tuvo diferencias sí,
--      con ese motivo.
--   3. Un producto inactivo o sin control de stock no aparece.
--   4. Alguien de otro negocio no puede pedir la lista.
DO $$
DECLARE
  v_user uuid; v_otro uuid; v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_inact uuid;
  v_count uuid; v_n int; v_primero uuid; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Cíclico', 'zz-cic-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Caro que rota', 'ZZ', 1, 5000, 9000, 50) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Barato', 'ZZ', 1, 100, 200, 50) RETURNING id INTO v_b;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Quieto', 'ZZ', 1, 100, 200, 50) RETURNING id INTO v_c;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock, is_active) VALUES (v_org, v_user, 'ZZ Inactivo', 'ZZ', 1, 100, 200, 5, false) RETURNING id INTO v_inact;
  PERFORM public.record_stock_movement(v_org, v_a, NULL, 'ZZ Caro que rota', NULL, 'sale', -10);
  PERFORM public.record_stock_movement(v_org, v_b, NULL, 'ZZ Barato', NULL, 'sale', -5);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  SELECT count(*) INTO v_n FROM public.productos_para_conteo_ciclico(v_org, 15) x WHERE x.motivo = 'Nunca se contó';
  SELECT x.product_id INTO v_primero FROM public.productos_para_conteo_ciclico(v_org, 15) x LIMIT 1;
  IF v_n <> 3 OR v_primero IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'FALLA 1: % nunca contados (esperaba 3), primero % (esperaba el caro)', v_n, v_primero;
  END IF;
  IF (SELECT x.clase FROM public.productos_para_conteo_ciclico(v_org, 15) x WHERE x.product_id = v_a) <> 'A' THEN
    RAISE EXCEPTION 'FALLA 1b: el que más plata movió no es clase A';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2: B contado hoy; C (clase C, cada 90 días) contado hace 100 días con una diferencia grande.
  RESET ROLE;
  INSERT INTO public.stock_counts (org_id, status, opened_by, opened_at, closed_at) VALUES (v_org, 'cerrado', v_user, now(), now()) RETURNING id INTO v_count;
  INSERT INTO public.stock_count_items (count_id, org_id, product_id, expected, counted, counted_at, ajuste)
  VALUES (v_count, v_org, v_b, 50, 50, now(), 0),
         (v_count, v_org, v_c, 50, 40, now() - interval '100 days', -10);
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.productos_para_conteo_ciclico(v_org, 15) x WHERE x.product_id = v_b) THEN
    RAISE EXCEPTION 'FALLA 2: lo contado hoy volvió a la lista';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.productos_para_conteo_ciclico(v_org, 15) x
                  WHERE x.product_id = v_c AND x.motivo = 'Tuvo diferencias en conteos anteriores') THEN
    RAISE EXCEPTION 'FALLA 2b: el que tuvo diferencias y venció no aparece con ese motivo';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  IF EXISTS (SELECT 1 FROM public.productos_para_conteo_ciclico(v_org, 15) x WHERE x.product_id = v_inact) THEN
    RAISE EXCEPTION 'FALLA 3: apareció un producto inactivo';
  END IF;
  v_ok := v_ok || '3 ';
  RESET ROLE;

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.productos_para_conteo_ciclico(v_org, 15);
    RAISE EXCEPTION 'FALLA 4: alguien de otro negocio pidió la lista';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
