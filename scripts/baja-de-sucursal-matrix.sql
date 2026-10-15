-- Simulacro de 20261014002700 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una sucursal vacía se da de baja.
--   2. La principal no.
--   3. Una con stock no (y el stock sigue visible).
--   4. Una con caja abierta no.
DO $$
DECLARE v_user uuid; v_org uuid; l_main uuid; l_vacia uuid; l_stock uuid; l_caja uuid; p1 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ sucursales', 'zz-su-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.locations (org_id, name, is_main, active) VALUES (v_org, 'ZZ Central', true, true) RETURNING id INTO l_main;
  INSERT INTO public.locations (org_id, name, is_main, active) VALUES (v_org, 'ZZ Vacía', false, true) RETURNING id INTO l_vacia;
  INSERT INTO public.locations (org_id, name, is_main, active) VALUES (v_org, 'ZZ Con stock', false, true) RETURNING id INTO l_stock;
  INSERT INTO public.locations (org_id, name, is_main, active) VALUES (v_org, 'ZZ Con caja', false, true) RETURNING id INTO l_caja;
  INSERT INTO public.products (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Tornillo') RETURNING id INTO p1;
  INSERT INTO public.location_stock (org_id, location_id, product_id, stock) VALUES (v_org, l_stock, p1, 7);
  INSERT INTO public.cash_sessions (org_id, location_id, status, opened_by, opening_amount) VALUES (v_org, l_caja, 'open', v_user, 0);

  UPDATE public.locations SET active = false WHERE id = l_vacia;
  IF (SELECT active FROM public.locations WHERE id = l_vacia) THEN RAISE EXCEPTION 'FALLA 1'; END IF;
  BEGIN UPDATE public.locations SET active = false WHERE id = l_main; RAISE EXCEPTION 'FALLA 2';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.locations SET active = false WHERE id = l_stock; RAISE EXCEPTION 'FALLA 3';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.locations SET active = false WHERE id = l_caja; RAISE EXCEPTION 'FALLA 4';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
