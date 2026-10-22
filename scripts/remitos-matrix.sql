-- Simulacro de 20261022000400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin talonario configurado: remito «X» número 1, el siguiente 2.
--   2. Entrega parcial: de 10 vendidos se remiten 6, después 5 falla (quedan 4), 4 entra.
--   3. Anular el de 6 lo vuelve a dejar pendiente.
--   4. Con CAI vigente el remito es «R» y lleva el CAI.
--   5. El próximo número no retrocede.
--   6. Nadie escribe directo en remitos; otro negocio no ve ni emite.
--   7. Marcar entregado exige quién recibió.
--   8. El vendedor emite, pero no anula ni configura el talonario.
DO $$
DECLARE
  v_user uuid; v_otro uuid; v_org uuid; v_org2 uuid; v_prod uuid; v_tx uuid := gen_random_uuid(); v_sale uuid;
  r jsonb; r6 jsonb; n int; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ remitos', 'zz-rem-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ ajeno', 'zz-rem2-' || substr(md5(random()::text), 1, 8), v_otro) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org2, v_otro, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 100) RETURNING id INTO v_prod;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, sale_transaction_id, customer_name)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 10, 100, 1000, now(), v_tx, 'ZZ Cliente') RETURNING id INTO v_sale;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1 y 2
  r6 := public.emitir_remito(v_org, jsonb_build_object('sale_transaction_id', v_tx, 'cliente_nombre', 'ZZ Cliente',
    'items', jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'cantidad', 6))));
  IF r6->>'letra' <> 'X' OR (r6->>'numero')::int <> 1 THEN RAISE EXCEPTION 'FALLA 1: %', r6; END IF;
  BEGIN
    r := public.emitir_remito(v_org, jsonb_build_object('sale_transaction_id', v_tx, 'items', jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'cantidad', 5))));
    RAISE EXCEPTION 'FALLA 2a: entregó de más';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.emitir_remito(v_org, jsonb_build_object('sale_transaction_id', v_tx, 'items', jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'cantidad', 4))));
  IF (r->>'numero')::int <> 2 THEN RAISE EXCEPTION 'FALLA 2b: el número quedó %, no 2 (el fallido no consume número)', r->>'numero'; END IF;
  v_ok := v_ok || '1 2 ';

  -- 3
  PERFORM public.anular_remito((r6->>'id')::uuid, 'ZZ se cargó mal');
  r := public.emitir_remito(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'cantidad', 6))));
  v_ok := v_ok || '3 ';

  -- 4 y 5
  r := public.configurar_talonario_remitos(v_org, 2, '12345678901234', (current_date + 30), 501);
  IF (r->>'proximo_numero')::int <> 501 THEN RAISE EXCEPTION 'FALLA 4a: %', r; END IF;
  r := public.emitir_remito(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('descripcion', 'ZZ Flete', 'cantidad', 1))));
  IF r->>'letra' <> 'R' OR r->>'cai' <> '12345678901234' OR (r->>'numero')::int <> 501 OR (r->>'punto_venta')::int <> 2 THEN RAISE EXCEPTION 'FALLA 4b: %', r; END IF;
  BEGIN
    PERFORM public.configurar_talonario_remitos(v_org, 2, '12345678901234', (current_date + 30), 100);
    RAISE EXCEPTION 'FALLA 5: el número retrocedió';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '4 5 ';

  -- 7
  BEGIN
    PERFORM public.marcar_remito_entregado((r->>'id')::uuid, '  ', NULL);
    RAISE EXCEPTION 'FALLA 7: entregado sin quién recibió';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.marcar_remito_entregado((r->>'id')::uuid, 'ZZ Recibe', '30123456');
  IF r->>'estado' <> 'entregado' THEN RAISE EXCEPTION 'FALLA 7b: %', r; END IF;
  v_ok := v_ok || '7 ';

  -- 6
  BEGIN
    INSERT INTO public.remitos (org_id, punto_venta, numero, letra, fecha, cliente_nombre) VALUES (v_org, 1, 999, 'X', current_date, 'ZZ');
    RAISE EXCEPTION 'FALLA 6a: escritura directa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.remitos WHERE org_id = v_org;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FALLA 6b: otro negocio ve % remitos', n; END IF;
  BEGIN
    PERFORM public.emitir_remito(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('descripcion', 'ZZ', 'cantidad', 1))));
    RAISE EXCEPTION 'FALLA 6c: otro negocio emitió';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '6 ';

  -- 8. El vendedor (permisos por defecto) emite, pero no anula ni toca el talonario.
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_otro, 'vendedor') ON CONFLICT DO NOTHING;
  SET LOCAL ROLE authenticated;
  r := public.emitir_remito(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('descripcion', 'ZZ Caja', 'cantidad', 2))));
  BEGIN
    PERFORM public.anular_remito((r->>'id')::uuid, 'ZZ');
    RAISE EXCEPTION 'FALLA 8a: el vendedor anuló';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.configurar_talonario_remitos(v_org, 9, NULL, NULL, 1);
    RAISE EXCEPTION 'FALLA 8b: el vendedor cambió el talonario';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '8';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
