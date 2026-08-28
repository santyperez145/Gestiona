-- Verificación contra la base real: ACL + guarda interna + cero restos.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260828_funciones_internas_no_anonimas.sql

DO $verification$
DECLARE
  v_user uuid;
  v_org uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_signature text;
  v_blocked boolean;
  v_restos integer;
BEGIN
  SELECT account.id INTO v_user
  FROM auth.users account
  ORDER BY account.created_at
  LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.registrar_invocacion(bigint,text)',
    'public.reconciliar_invocaciones()',
    'public.podar_invocaciones(integer)',
    'public.cambios_de_precio_a_aplicar()',
    'public.registrar_cambio_de_precio(uuid,text,text,jsonb)',
    'public.ia_registrar_consumo(uuid,uuid,text,integer,integer,numeric)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACL incorrecta en %', v_signature;
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES (v_org, 'ZZ Funciones internas', 'zz-internas-' || v_suffix, v_user);

    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

    v_blocked := false;
    BEGIN
      PERFORM public.registrar_invocacion(-999999, 'ZZ-anon-no-registra');
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon registró telemetría'; END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.reconciliar_invocaciones();
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon reconcilió telemetría'; END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.podar_invocaciones(7);
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon podó telemetría'; END IF;

    v_blocked := false;
    BEGIN
      PERFORM * FROM public.cambios_de_precio_a_aplicar();
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon leyó cambios de precio'; END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.registrar_cambio_de_precio(
        gen_random_uuid(), 'error', 'ZZ intento anónimo', NULL
      );
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon alteró cambios de precio'; END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.ia_registrar_consumo(
        v_org, v_user, 'ZZ-modelo', 10, 5, 0.01
      );
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'anon falsificó consumo de IA'; END IF;

    -- La Edge Function conserva el camino real de escritura.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM public.ia_registrar_consumo(
      v_org, v_user, 'ZZ-modelo', 10, 5, 0.01
    );
    IF NOT EXISTS (
      SELECT 1
      FROM public.ai_usage_stats
      WHERE org_id = v_org
        AND user_id = v_user
        AND model = 'ZZ-modelo'
        AND input_tokens = 10
        AND output_tokens = 5
    ) THEN
      RAISE EXCEPTION 'service_role perdió el camino de consumo de IA';
    END IF;

    IF EXISTS (SELECT 1 FROM public.audit_costo_expuesto) THEN
      RAISE EXCEPTION 'La guarda de costo público sigue roja';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.ai_usage_stats WHERE org_id = v_org)
    + (SELECT count(*) FROM public.edge_invocation_log
       WHERE function_name LIKE 'ZZ-%')
  INTO v_restos;

  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'La verificación dejó % restos', v_restos;
  END IF;

  RAISE NOTICE 'Funciones internas verificadas: seis anon/auth bloqueadas, service_role operativo, costo público vacío, restos=0';
END;
$verification$;
