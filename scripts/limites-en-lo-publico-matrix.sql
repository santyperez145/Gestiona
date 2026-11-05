-- Simulacro de 20261105000500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Pedido inexistente: la devolución responde {ok:false} sin error y el
--      consentimiento false (el intento queda contado).
--   2. El seguimiento de un pedido inexistente responde found:false y cuenta;
--      con el cupo lleno corta por límite (53400).
--   3. Aviso de stock y devolución cortan por límite con el cupo lleno.
--   4. El seguimiento ya no es STABLE (escribe el límite).
--   5. Los contratos de las cuatro quedaron con el hash nuevo.
DO $$
DECLARE
  v_slug text := 'zz-lim-' || substr(md5(random()::text), 1, 8);
  v_nro text := 'ZZ-' || substr(md5(random()::text), 1, 8);
  v_r jsonb;
  v_b boolean;
  v_estado text;
  v_i int;
  v_owner uuid;
  v_org uuid;
  v_ok text := '';
BEGIN
  -- 1 (con una tienda inexistente la devolución corta antes: se arma una)
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Límites', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Límites', true, ARRAY['efectivo'], 0, 'free', true);
  SET LOCAL ROLE anon;
  v_r := public.request_store_return(v_slug, v_nro, 'zz@invalid.test', 'arrepentimiento');
  v_b := public.register_store_marketing_consent(v_slug, v_nro, 'zz@invalid.test');
  RESET ROLE;
  IF (v_r->>'ok')::boolean IS DISTINCT FROM false OR v_r->>'error' IS NULL THEN
    RAISE EXCEPTION 'FALLA 1: la devolución de un pedido inexistente respondió %', v_r;
  END IF;
  IF v_b IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALLA 1b: el consentimiento de un pedido inexistente respondió %', v_b;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  SET LOCAL ROLE anon;
  v_r := public.get_order_tracking(v_nro, 'zz@invalid.test');
  RESET ROLE;
  IF (v_r->>'found')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALLA 2: seguimiento inexistente respondió %', v_r;
  END IF;
  FOR v_i IN 1..30 LOOP
    PERFORM public.rate_limit_publico('seguimiento', v_nro, 30, interval '1 minute');
  END LOOP;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.get_order_tracking(v_nro, 'zz@invalid.test');
    v_estado := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_estado IS DISTINCT FROM '53400' THEN
    RAISE EXCEPTION 'FALLA 2b: el seguimiento con el cupo lleno no cortó (%)', v_estado;
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  FOR v_i IN 1..10 LOOP
    PERFORM public.rate_limit_publico('aviso_stock', v_slug, 10, interval '15 minutes');
    PERFORM public.rate_limit_publico('devolucion', v_slug, 10, interval '15 minutes');
  END LOOP;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.request_stock_alert(v_slug, gen_random_uuid(), 'zz@invalid.test');
    v_estado := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_estado IS DISTINCT FROM '53400' THEN
    RAISE EXCEPTION 'FALLA 3: el aviso de stock con el cupo lleno no cortó (%)', v_estado;
  END IF;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.request_store_return(v_slug, v_nro, 'zz@invalid.test', 'arrepentimiento');
    v_estado := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_estado IS DISTINCT FROM '53400' THEN
    RAISE EXCEPTION 'FALLA 3b: la devolución con el cupo lleno no cortó (%)', v_estado;
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.get_order_tracking(text,text)'::regprocedure) <> 'v' THEN
    RAISE EXCEPTION 'FALLA 4: get_order_tracking sigue sin ser VOLATILE';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  IF EXISTS (
    SELECT 1 FROM public.security_function_contracts sfc
      JOIN pg_proc p ON p.proname = sfc.function_name
       AND pg_get_function_identity_arguments(p.oid) = sfc.identity_arguments
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE sfc.function_name IN ('request_stock_alert', 'register_store_marketing_consent', 'request_store_return', 'get_order_tracking')
       AND sfc.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
  ) THEN
    RAISE EXCEPTION 'FALLA 5: algún contrato quedó con otro hash';
  END IF;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
