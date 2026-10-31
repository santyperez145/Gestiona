-- Simulacro de 20261030002100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un producto en -2 por una preventa pagada no cuenta como stock negativo
--      en la métrica de la plataforma.
--   2. Vencida la preventa con el faltante, sí.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_p uuid; v_o uuid; v_n text; r jsonb; v_ok text := '';
  v_slug text := 'zz-metrica-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Métrica', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Métrica', true, ARRAY['transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.METRICA', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, preventa_cupo, expected_restock_at)
  VALUES (v_org, v_owner, 'ZZ Consola', 1000, 0, 5, public.hoy_ar() + 20) RETURNING id INTO v_p;
  INSERT INTO public.platform_admins (user_id) VALUES (v_owner) ON CONFLICT DO NOTHING;

  -- La compradora no lee pedidos (RLS): se guarda el número y el id se busca sin sesión.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 2)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_n := r->>'order_number';
  RESET ROLE;
  SELECT id INTO v_o FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o, 'ZZ');
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = v_p) <> -2 THEN
    RAISE EXCEPTION 'FALLA 0: el stock quedó en %', (SELECT stock FROM public.products WHERE id = v_p);
  END IF;

  -- 1
  IF (SELECT productos_stock_negativo FROM public.platform_org_stock_accuracy WHERE org_id = v_org) <> 0 THEN
    RAISE EXCEPTION 'FALLA 1: la preventa vigente cuenta como stock negativo';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  UPDATE public.products SET expected_restock_at = public.hoy_ar() - 1 WHERE id = v_p;
  IF (SELECT productos_stock_negativo FROM public.platform_org_stock_accuracy WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'FALLA 2: vencida con faltante no cuenta como stock negativo';
  END IF;
  v_ok := v_ok || '2';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
