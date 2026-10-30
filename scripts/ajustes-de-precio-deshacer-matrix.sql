-- Simulacro de 20261030000500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin permiso de editar productos no se ajusta.
--   2. Un ajuste del 10% queda registrado con antes y después de cada producto.
--   3. Deshacer vuelve lo que nadie tocó y respeta lo editado después.
--   4. Una sola vez.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_a uuid; v_b uuid; v_c uuid;
  v_slug text := 'zz-ajuste-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ajuste uuid; v_ok text := '';
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Ajuste', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, cost_currency, cost_ars, category)
  VALUES (v_org, v_owner, 'ZZ A', 100, 'ARS', 50, 'zz') RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, cost_currency, cost_ars, category)
  VALUES (v_org, v_owner, 'ZZ B', 200, 'ARS', 80, 'zz') RETURNING id INTO v_b;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, cost_currency, cost_ars, category)
  VALUES (v_org, v_owner, 'ZZ C', 300, 'ARS', 90, 'otra') RETURNING id INTO v_c;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aplicar_ajuste_de_precios(v_org, 'porcentaje', jsonb_build_object('porcentaje', 10, 'que', 'precio', 'categoria', 'zz'));
    RAISE EXCEPTION 'FALLA 1: un lector ajustó precios';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.aplicar_ajuste_de_precios(v_org, 'porcentaje', jsonb_build_object('porcentaje', 10, 'que', 'precio', 'categoria', 'zz'));
  RESET ROLE;
  v_ajuste := (r->>'ajuste_id')::uuid;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_a) <> 110 OR (SELECT sale_price_ars FROM public.products WHERE id = v_b) <> 220
     OR (SELECT sale_price_ars FROM public.products WHERE id = v_c) <> 300 THEN
    RAISE EXCEPTION 'FALLA 2a: el ajuste no se aplicó como se pidió: %', r;
  END IF;
  IF (r->>'productos_cambiados')::int <> 2 OR (SELECT productos FROM public.ajustes_de_precio WHERE id = v_ajuste) <> 2 THEN
    RAISE EXCEPTION 'FALLA 2b: %', r;
  END IF;
  v_ok := v_ok || '2 ';

  -- 3: alguien vuelve a tocar B
  UPDATE public.products SET sale_price_ars = 999 WHERE id = v_b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.deshacer_ajuste_de_precios(v_ajuste);
    RAISE EXCEPTION 'FALLA 3a: un lector deshizo el ajuste';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.deshacer_ajuste_de_precios(v_ajuste);
  RESET ROLE;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_a) <> 100 THEN RAISE EXCEPTION 'FALLA 3b: no volvió A: %', r; END IF;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_b) <> 999 THEN RAISE EXCEPTION 'FALLA 3c: pisó el cambio posterior'; END IF;
  IF (r->>'restaurados')::int <> 1 OR (r->>'con_cambios_posteriores')::int <> 1 THEN RAISE EXCEPTION 'FALLA 3d: %', r; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.deshacer_ajuste_de_precios(v_ajuste);
    RAISE EXCEPTION 'FALLA 4: se deshizo dos veces';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
