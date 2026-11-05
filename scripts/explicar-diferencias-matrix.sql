-- Simulacro de 20261106000200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Faltante después de una compra reciente: pista de compra incompleta.
--   2. Faltante sin ningún movimiento: pista de rotura o robo.
--   3. Sobrante con devoluciones: pista de devolución sin cargar.
--   4. Lo contado igual no aparece.
--   5. Alguien de otro negocio no puede pedirlo.
DO $$
DECLARE
  v_user uuid; v_otro uuid; v_org uuid; v_count uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  r jsonb; v_pistas text[]; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Explicar', 'zz-exp-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Comprado', 'ZZ', 1, 100, 200, 0) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Quieto', 'ZZ', 1, 100, 200, 10) RETURNING id INTO v_b;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Devuelto', 'ZZ', 1, 100, 200, 10) RETURNING id INTO v_c;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, cost_ars, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Justo', 'ZZ', 1, 100, 200, 10) RETURNING id INTO v_d;
  PERFORM public.record_stock_movement(v_org, v_a, NULL, 'ZZ Comprado', NULL, 'purchase', 12);
  PERFORM public.record_stock_movement(v_org, v_c, NULL, 'ZZ Devuelto', NULL, 'return_in', 2);
  -- Los movimientos quedan antes del conteo.
  UPDATE public.stock_movements SET created_at = now() - interval '2 days' WHERE org_id = v_org;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.abrir_conteo(v_org, NULL, 'ZZ toma', false);
  v_count := (r->>'conteo_id')::uuid;
  PERFORM public.registrar_conteo_lote(v_count, jsonb_build_array(
    jsonb_build_object('product_id', v_a, 'cantidad', 8),   -- faltan 4 de la compra de 12
    jsonb_build_object('product_id', v_b, 'cantidad', 7),   -- faltan 3 sin movimientos
    jsonb_build_object('product_id', v_c, 'cantidad', 14),  -- sobran 2 (las devueltas)
    jsonb_build_object('product_id', v_d, 'cantidad', 10)));

  -- 1
  SELECT x.pistas INTO v_pistas FROM public.explicar_diferencias_de_conteo(v_count) x WHERE x.product_id = v_a;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_pistas) p WHERE p LIKE 'La última compra%') THEN
    RAISE EXCEPTION 'FALLA 1: sin pista de compra incompleta (%)', v_pistas;
  END IF;
  v_ok := v_ok || '1 ';
  -- 2
  SELECT x.pistas INTO v_pistas FROM public.explicar_diferencias_de_conteo(v_count) x WHERE x.product_id = v_b;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_pistas) p WHERE p LIKE 'Sin movimientos registrados%') THEN
    RAISE EXCEPTION 'FALLA 2: sin pista de rotura o robo (%)', v_pistas;
  END IF;
  v_ok := v_ok || '2 ';
  -- 3
  SELECT x.pistas INTO v_pistas FROM public.explicar_diferencias_de_conteo(v_count) x WHERE x.product_id = v_c;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_pistas) p WHERE p LIKE 'Hubo 2 devoluciones%') THEN
    RAISE EXCEPTION 'FALLA 3: sin pista de devoluciones (%)', v_pistas;
  END IF;
  v_ok := v_ok || '3 ';
  -- 4
  IF EXISTS (SELECT 1 FROM public.explicar_diferencias_de_conteo(v_count) x WHERE x.product_id = v_d) THEN
    RAISE EXCEPTION 'FALLA 4: apareció lo contado igual';
  END IF;
  v_ok := v_ok || '4 ';
  RESET ROLE;

  -- 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.explicar_diferencias_de_conteo(v_count);
    RAISE EXCEPTION 'FALLA 5: alguien de otro negocio leyó las diferencias';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
