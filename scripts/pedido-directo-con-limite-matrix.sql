-- Simulacro de 20261105000400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Con cupo, anon llega a create_store_order (acá falla por tienda
--      inexistente, después del límite: no es 53400).
--   2. Con el cupo de 'checkout_directo' lleno, corta por límite (53400)
--      antes de tocar nada. (Un intento fallido deshace su propio conteo, así
--      que el cupo se llena directo, como lo dejan diez pedidos exitosos.)
--   3. El contrato de seguridad quedó con el hash de la definición nueva.
DO $$
DECLARE
  v_slug text := 'zz-limite-' || substr(md5(random()::text), 1, 8);
  v_i int;
  v_estado text;
  v_ok text := '';
BEGIN
  -- 1
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.create_store_order(v_slug, '[]'::jsonb, 'ZZ', 'zz@invalid.test', NULL, NULL, 'efectivo');
    v_estado := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_estado = '53400' THEN
    RAISE EXCEPTION 'FALLA 1: cortó por límite con el cupo vacío';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  FOR v_i IN 1..10 LOOP
    PERFORM public.rate_limit_publico('checkout_directo', v_slug, 10, interval '1 minute');
  END LOOP;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.create_store_order(v_slug, '[]'::jsonb, 'ZZ', 'zz@invalid.test', NULL, NULL, 'efectivo');
    v_estado := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF v_estado IS DISTINCT FROM '53400' THEN
    RAISE EXCEPTION 'FALLA 2: con el cupo lleno no cortó por límite (%)', v_estado;
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  IF EXISTS (
    SELECT 1 FROM public.security_function_contracts sfc
      JOIN pg_proc p ON p.proname = sfc.function_name
       AND pg_get_function_identity_arguments(p.oid) = sfc.identity_arguments
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE sfc.function_name = 'create_store_order'
       AND sfc.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
  ) THEN
    RAISE EXCEPTION 'FALLA 3: el contrato de create_store_order quedó con otro hash';
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
