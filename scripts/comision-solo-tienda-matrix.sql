-- Simulacro de 20261022000500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una regla aprobada para «todos los canales» cobra en la tienda online.
--   2. No cobra en el local (pos) ni en los links de pago.
--   3. La liquidación de un link no anota comisión; la de un pedido de la tienda sí.
DO $$
DECLARE
  v_actor uuid; v_org uuid := gen_random_uuid(); v_rule uuid; v_saved jsonb; n numeric; v_tx uuid; v_ok text := '';
BEGIN
  SELECT user_id INTO v_actor FROM public.platform_admins WHERE role = 'superadmin' ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'FALLA 0: no hay superadmin de plataforma para aprobar la regla de prueba'; END IF;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ comisión por canal', 'zz-com-' || substr(v_org::text, 1, 8), v_actor);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  v_saved := public.save_platform_commission_rule(NULL, v_org, 5, 0, NULL, 0, 'all', 'ZZ regla para todos los canales', NULL);
  v_rule := (v_saved->>'id')::uuid;
  PERFORM public.approve_platform_commission_rule(v_rule, 'ZZ-terms', 'included', 21, now(), NULL);

  -- 1
  n := public.platform_commission_amount(v_org, 1000, 'online');
  IF n <> 50 THEN RAISE EXCEPTION 'FALLA 1: la tienda cobró % en vez de 50', n; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  n := public.platform_commission_amount(v_org, 1000, 'pos');
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 2a: el local pagó % de comisión', n; END IF;
  n := public.platform_commission_amount(v_org, 1000, 'link');
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 2b: un link de pago pagó % de comisión', n; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  v_tx := public.record_payment_settlement(v_org, 'payment_link', NULL, 'mercadopago', 'credit', 0, 1000, 'zz-link-' || v_org, 0, 'ARS', 'approved');
  SELECT platform_fee INTO n FROM public.payment_transactions WHERE id = v_tx;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 3a: la liquidación del link anotó % de comisión', n; END IF;
  v_tx := public.record_payment_settlement(v_org, 'ecommerce', NULL, 'mercadopago', 'credit', 0, 1000, 'zz-ecom-' || v_org, 0, 'ARS', 'approved');
  SELECT platform_fee INTO n FROM public.payment_transactions WHERE id = v_tx;
  IF n <> 50 THEN RAISE EXCEPTION 'FALLA 3b: la liquidación de la tienda anotó % en vez de 50', n; END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
