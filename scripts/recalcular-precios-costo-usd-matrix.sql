-- Simulacro de 20261023000400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Recalcula 5.500 productos con costo en dólares de una vez (también los
--      que cargó otro usuario del negocio) y deja la ganancia por unidad.
--   2. Sólo la categoría pedida; los sin costo en dólares no se tocan.
--   3. Guarda el tipo de cambio en la configuración del negocio.
--   4. Un vendedor sin permiso de editar productos no recalcula; datos inválidos se rechazan.
DO $$
DECLARE
  v_user uuid; v_otro uuid; v_vend uuid; v_org uuid; r jsonb; n numeric; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id NOT IN (v_user, v_otro) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Recalculo', 'zz-rc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_otro, 'admin'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.settings (org_id, user_id, exchange_rate) VALUES (v_org, v_user, 1000)
  ON CONFLICT (org_id) DO UPDATE SET exchange_rate = 1000;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock)
  SELECT v_org, CASE WHEN g % 2 = 0 THEN v_user ELSE v_otro END, 'ZZ Prod ' || g,
         CASE WHEN g <= 100 THEN 'ZZ Bazar' ELSE 'ZZ Herramientas' END, 10, 1, 1
    FROM generate_series(1, 5500) g;
  INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Sin costo', 'ZZ Bazar', 0, 777, 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.recalcular_precios_desde_costo_usd(v_org, 1500, 100);
  IF (r->>'updated')::int <> 5500 THEN RAISE EXCEPTION 'FALLA 1a: %', r; END IF;
  SELECT count(*) INTO n FROM public.products WHERE org_id = v_org AND sale_price_ars = 30000 AND profit_per_unit_ars = 15000 AND profit_per_unit_usd = 10;
  IF n <> 5500 THEN RAISE EXCEPTION 'FALLA 1b: % productos con el precio esperado', n; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.recalcular_precios_desde_costo_usd(v_org, 2000, 50, 'ZZ Bazar');
  IF (r->>'updated')::int <> 100 THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  IF (SELECT sale_price_ars FROM public.products WHERE org_id = v_org AND name = 'ZZ Sin costo') <> 777 THEN RAISE EXCEPTION 'FALLA 2b: tocó un producto sin costo en dólares'; END IF;
  IF (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'ZZ Herramientas' AND sale_price_ars = 30000) <> 5400 THEN RAISE EXCEPTION 'FALLA 2c: tocó otra categoría'; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  RESET ROLE;
  IF (SELECT exchange_rate FROM public.settings WHERE org_id = v_org) <> 2000 THEN RAISE EXCEPTION 'FALLA 3: no guardó el tipo de cambio'; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.recalcular_precios_desde_costo_usd(v_org, 1500, 100);
    RAISE EXCEPTION 'FALLA 4a: un vendedor recalculó precios';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.recalcular_precios_desde_costo_usd(v_org, 0, 100);
    RAISE EXCEPTION 'FALLA 4b: aceptó un tipo de cambio en cero';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
