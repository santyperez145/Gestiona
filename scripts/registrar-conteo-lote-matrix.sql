-- Simulacro de 20261023000500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una toma de 5.500 productos se registra en tres tandas (2.000 + 2.000 + 1.500)
--      y al cerrar ajusta el stock de los que difieren.
--   2. Una tanda con un renglón inválido (negativo, repetido, ajeno al conteo
--      o de más de 2.000) no registra nada.
--   3. Un conteo cerrado ya no acepta tandas.
--   4. Un vendedor sin permiso de editar inventario no registra.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; v_count uuid; v_otro_prod uuid; r jsonb; n numeric; v_ok text := '';
  v_lote jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Conteo lote', 'zz-cl-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock)
  SELECT v_org, v_user, 'ZZ Prod ' || g, 'ZZ Bazar', 1, 100, 10 FROM generate_series(1, 5500) g;
  SELECT p.id INTO v_otro_prod FROM public.products p WHERE p.org_id <> v_org LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.abrir_conteo(v_org, NULL, 'ZZ toma', false);
  v_count := (r->>'conteo_id')::uuid;
  IF v_count IS NULL THEN RAISE EXCEPTION 'FALLA 0: no abrió el conteo: %', r; END IF;

  -- 2 (antes de registrar, para ver que no quedó nada a medias)
  SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'cantidad', 3)) || jsonb_build_array(jsonb_build_object('product_id', (SELECT product_id FROM public.stock_count_items WHERE count_id = v_count LIMIT 1), 'cantidad', -1))
    INTO v_lote FROM (SELECT product_id FROM public.stock_count_items WHERE count_id = v_count ORDER BY product_id OFFSET 1 LIMIT 10) i;
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote); RAISE EXCEPTION 'FALLA 2a: aceptó una cantidad negativa';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'cantidad', 3)) INTO v_lote
    FROM (SELECT product_id FROM public.stock_count_items WHERE count_id = v_count ORDER BY product_id LIMIT 5) i;
  v_lote := v_lote || jsonb_build_array(v_lote->0);
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote); RAISE EXCEPTION 'FALLA 2b: aceptó un producto repetido';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'cantidad', 3)) || jsonb_build_array(jsonb_build_object('product_id', COALESCE(v_otro_prod, gen_random_uuid()), 'cantidad', 1))
    INTO v_lote FROM (SELECT product_id FROM public.stock_count_items WHERE count_id = v_count ORDER BY product_id LIMIT 5) i;
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote); RAISE EXCEPTION 'FALLA 2c: aceptó un producto ajeno al conteo';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'cantidad', 3)) INTO v_lote
    FROM (SELECT product_id FROM public.stock_count_items WHERE count_id = v_count ORDER BY product_id LIMIT 2001) i;
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote); RAISE EXCEPTION 'FALLA 2d: aceptó una tanda de más de 2.000';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.stock_count_items WHERE count_id = v_count AND counted IS NOT NULL) THEN RAISE EXCEPTION 'FALLA 2e: una tanda rechazada dejó renglones registrados'; END IF;
  v_ok := v_ok || '2 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote - 0); RAISE EXCEPTION 'FALLA 4: un vendedor registró un conteo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4 ';

  -- 1: la mitad contada igual (10) y la otra mitad con uno más (11)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  FOR k IN 0..2 LOOP
    SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'cantidad', CASE WHEN i.rn % 2 = 0 THEN 10 ELSE 11 END)) INTO v_lote
      FROM (SELECT product_id, row_number() OVER (ORDER BY product_id) AS rn FROM public.stock_count_items WHERE count_id = v_count ORDER BY product_id OFFSET k * 2000 LIMIT 2000) i;
    r := public.registrar_conteo_lote(v_count, v_lote);
    IF (r->>'registrados')::int <> jsonb_array_length(v_lote) THEN RAISE EXCEPTION 'FALLA 1a: tanda %: %', k, r; END IF;
  END LOOP;
  r := public.cerrar_conteo(v_count);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.stock_count_items WHERE count_id = v_count AND counted IS NOT NULL;
  IF n <> 5500 THEN RAISE EXCEPTION 'FALLA 1b: % renglones contados', n; END IF;
  SELECT count(*) INTO n FROM public.products WHERE org_id = v_org AND stock = 11;
  IF n <> 2750 THEN RAISE EXCEPTION 'FALLA 1c: % productos ajustados a 11 (cierre: %)', n, r; END IF;
  v_ok := v_ok || '1 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.registrar_conteo_lote(v_count, v_lote); RAISE EXCEPTION 'FALLA 3: un conteo cerrado aceptó una tanda';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
