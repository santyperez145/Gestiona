-- Simulacro de 20261014003000 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. eliminar_productos borra el que no tiene operaciones (aunque tenga
--      stock inicial) y archiva el que tiene una venta.
--   2. Borrar por fuera un producto con historia se rechaza.
--   3. Un vendedor sin permiso de borrar no borra nada.
--   4. Borrar el negocio entero no se frena.
DO $$
DECLARE v_user uuid; v_vend uuid; v_org uuid; p_sin uuid; p_con uuid; p_otro uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ productos', 'zz-pr-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Sin historia', 10) RETURNING id INTO p_sin;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Con venta', 10) RETURNING id INTO p_con;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Otro', 0) RETURNING id INTO p_otro;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
  VALUES (v_org, v_user, p_con, 'ZZ Con venta', 1, 100, 100, true);

  -- 3 (antes de que el dueño borre)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.eliminar_productos(v_org, ARRAY[p_otro]);
    IF jsonb_array_length(v_r->'eliminados') > 0 THEN RAISE EXCEPTION 'FALLA 3: el vendedor borró'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_otro) THEN RAISE EXCEPTION 'FALLA 3: se borró'; END IF;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.eliminar_productos(v_org, ARRAY[p_sin, p_con]);
  RESET ROLE;
  IF v_r->'eliminados' <> to_jsonb(ARRAY[p_sin]) OR v_r->'archivados' <> to_jsonb(ARRAY[p_con])
     OR EXISTS (SELECT 1 FROM public.products WHERE id = p_sin)
     OR (SELECT is_active FROM public.products WHERE id = p_con) IS NOT FALSE THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;

  -- 2
  BEGIN DELETE FROM public.products WHERE id = p_con; RAISE EXCEPTION 'FALLA 2';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4
  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = v_org) THEN RAISE EXCEPTION 'FALLA 4'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
