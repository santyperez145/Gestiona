-- Simulacro de 20261030001800 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. La base (o, sin permiso, el rol con el que entra la API) queda en hora
--      argentina y la sesión de las migraciones también: CURRENT_DATE es el
--      día argentino.
--   2. Un instante de la noche argentina (01:30 UTC del día siguiente) es del
--      día argentino al pasarlo a fecha, y una fecha sin hora en un filtro es
--      la medianoche argentina.
--   3. Un pedido cobrado a las 22:30 del 31/10 se asienta el 31/10, no en
--      noviembre.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_o uuid; v_entry uuid;
  r jsonb; v_ok text := ''; v_num text;
  v_slug text := 'zz-hora-ar-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  -- 1
  IF NOT EXISTS (
       SELECT 1 FROM pg_db_role_setting s
        WHERE ((s.setdatabase = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database()) AND s.setrole = 0)
               OR s.setrole = (SELECT ro.oid FROM pg_roles ro WHERE ro.rolname = 'authenticator'))
          AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE lower(c) = lower('TimeZone=America/Argentina/Buenos_Aires'))) THEN
    RAISE EXCEPTION 'FALLA 1a: ni la base ni el rol de la API quedaron en hora argentina';
  END IF;
  IF current_setting('TimeZone') <> 'America/Argentina/Buenos_Aires' THEN
    RAISE EXCEPTION 'FALLA 1b: la sesión de las migraciones sigue en %', current_setting('TimeZone');
  END IF;
  IF CURRENT_DATE <> public.hoy_ar() THEN
    RAISE EXCEPTION 'FALLA 1c: CURRENT_DATE % y hoy en Argentina %', CURRENT_DATE, public.hoy_ar();
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  IF (TIMESTAMPTZ '2026-11-01 01:30:00+00')::date <> DATE '2026-10-31' THEN
    RAISE EXCEPTION 'FALLA 2a: las 22:30 del 31/10 se pasan a %', (TIMESTAMPTZ '2026-11-01 01:30:00+00')::date;
  END IF;
  IF '2026-10-31'::timestamptz <> TIMESTAMPTZ '2026-10-31 03:00:00+00' THEN
    RAISE EXCEPTION 'FALLA 2b: una fecha sin hora no es la medianoche argentina';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Hora AR', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Hora AR', true, ARRAY['transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.HORA', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Lámpara', 1000, 10) RETURNING id INTO v_a;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  RESET ROLE;
  v_num := r->>'order_number';
  SELECT id INTO v_o FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o, 'ZZ');
  RESET ROLE;
  v_entry := public.ledger_asentar_orden_pagada(jsonb_build_object(
    'org_id', v_org, 'occurred_at', '2026-11-01T01:30:00Z', 'data', jsonb_build_object('order_id', v_o)));
  IF (SELECT e.fecha FROM public.ledger_entries e WHERE e.id = v_entry) <> DATE '2026-10-31' THEN
    RAISE EXCEPTION 'FALLA 3: el cobro de las 22:30 del 31/10 se asentó el %',
      (SELECT e.fecha FROM public.ledger_entries e WHERE e.id = v_entry);
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
