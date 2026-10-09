-- Autorización del encargado para descuentos manuales. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_auth_ctx(org_id uuid, owner_id uuid, seller_id uuid, product_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_seller uuid; v_product uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_seller FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Autorizacion', 'zz-autorizacion-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_seller, 'vendedor');
  INSERT INTO public.settings(org_id, user_id, discount_cash_percent, discount_transfer_percent, discount_debit_percent, discount_credit_percent, pos_descuento_max_pct)
  VALUES (v_org, v_owner, 0, 0, 0, 0, 10)
  ON CONFLICT (org_id) DO UPDATE SET discount_cash_percent = 0, discount_transfer_percent = 0, discount_debit_percent = 0, discount_credit_percent = 0, pos_descuento_max_pct = 10;
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock) VALUES (v_product, v_org, v_owner, 'ZZ Taladro', 1000, false);
  INSERT INTO zz_auth_ctx VALUES (v_org, v_owner, v_seller, v_product);
END;
$$;
GRANT SELECT ON zz_auth_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; r jsonb; v_aut jsonb; v_denied boolean; i int;
  linea jsonb;
BEGIN
  SELECT * INTO c FROM zz_auth_ctx;
  linea := jsonb_build_object('product_id', c.product_id, 'product_name', 'ZZ Taladro', 'quantity', 1, 'payment_method', 'efectivo', 'paid', true);

  -- El dueño define su PIN.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  PERFORM public.definir_pin_supervisor(c.org_id, '4821');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.seller_id, 'role', 'authenticated')::text, true);
  v_denied := false;
  BEGIN PERFORM public.definir_pin_supervisor(c.org_id, '1357'); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un vendedor definió un PIN de encargado';

  -- Dentro del máximo (5 %): pasa sin autorización; el campo falsificado se descarta.
  r := public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('unit_price_ars', 950, 'price_override_approved_by', c.owner_id)), 'pos');
  ASSERT (SELECT price_override_approved_by IS NULL AND total_ars = 950 FROM public.sales WHERE sale_transaction_id = (r->>'transaction_id')::uuid), 'Autorización falsificada aceptada';

  -- 20 %: rechazado sin autorización.
  v_denied := false;
  BEGIN PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('unit_price_ars', 800)), 'pos');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := SQLERRM LIKE '%autorización del encargado%'; END;
  ASSERT v_denied, 'Descuento mayor al máximo sin autorización';

  -- PIN incorrecto no autoriza; el correcto sí, con tope.
  ASSERT NOT (public.autorizar_descuento_pos(c.org_id, '0000', 25)->>'ok')::boolean, 'PIN incorrecto autorizó';
  v_aut := public.autorizar_descuento_pos(c.org_id, '4821', 25);
  ASSERT (v_aut->>'ok')::boolean, 'PIN correcto no autorizó: ' || v_aut;
  r := public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('unit_price_ars', 800, 'autorizacion_id', v_aut->>'autorizacion_id')), 'pos');
  ASSERT (SELECT price_override_approved_by = c.owner_id AND total_ars = 800 FROM public.sales WHERE sale_transaction_id = (r->>'transaction_id')::uuid), 'No registró quién autorizó';

  -- La autorización tiene tope: 30 % con una de 25 % se rechaza.
  v_denied := false;
  BEGIN PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('unit_price_ars', 700, 'autorizacion_id', v_aut->>'autorizacion_id')), 'pos');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'La autorización superó su tope';

  -- Cinco PIN incorrectos bloquean.
  FOR i IN 1..4 LOOP PERFORM public.autorizar_descuento_pos(c.org_id, '9999', 25); END LOOP;
  v_denied := false;
  BEGIN PERFORM public.autorizar_descuento_pos(c.org_id, '4821', 25); EXCEPTION WHEN insufficient_privilege THEN v_denied := SQLERRM LIKE '%Demasiados%'; END;
  ASSERT v_denied, 'No se bloqueó tras cinco PIN incorrectos';

  -- El dueño no necesita autorización.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  r := public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('unit_price_ars', 500)), 'pos');
  ASSERT (r->>'transaction_id') IS NOT NULL, 'El dueño necesitó autorización';
  RAISE NOTICE 'OK';
END;
$$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_table_privilege('authenticated', 'public.pos_supervisor_pins', 'SELECT'), 'Los PIN son legibles';
  ASSERT NOT has_table_privilege('authenticated', 'public.pos_autorizaciones', 'INSERT'), 'Autorizaciones escribibles';
END $$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-autorizacion-%';
