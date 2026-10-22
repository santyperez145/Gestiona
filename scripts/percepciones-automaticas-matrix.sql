-- Simulacro de 20261022000800 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Agente de IIBB por ARBA con alícuota para quien no está en el padrón.
--   2. Con el padrón cargado, el cliente percibe su alícuota vigente.
--   3. Fuera de padrón: la alícuota configurada; dado de baja: también.
--   4. Debajo del mínimo, no se percibe; IVA suma su alícuota.
--   5. Nadie escribe el padrón directo; el vendedor no lo carga ni configura.
DO $$
DECLARE v_user uuid; v_vend uuid; v_org uuid; r jsonb; n int; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ percepciones', 'zz-perc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.configurar_percepciones(v_org, true, 'ARBA', 8, 1000, false, NULL);
  IF NOT (r->>'iibb_agente')::boolean OR r->>'iibb_padron' <> 'ARBA' THEN RAISE EXCEPTION 'FALLA 1: %', r; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  n := public.cargar_padron_iibb(v_org, 'ARBA', jsonb_build_array(
    jsonb_build_object('cuit', '30712345671', 'alicuota', 3.5, 'vigencia_desde', current_date - 5, 'vigencia_hasta', current_date + 25),
    jsonb_build_object('cuit', '20111111112', 'alicuota', 0, 'vigencia_desde', current_date - 5, 'vigencia_hasta', current_date + 25, 'baja', true)));
  IF n <> 2 THEN RAISE EXCEPTION 'FALLA 2a: cargó %', n; END IF;
  r := public.percepciones_para_cliente(v_org, '30-71234567-1', 10000);
  IF jsonb_array_length(r) <> 1 OR (r->0->>'alicuota')::numeric <> 3.5 OR (r->0->>'importe')::numeric <> 350 OR r->0->>'origen' <> 'padron' THEN
    RAISE EXCEPTION 'FALLA 2b: %', r;
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  r := public.percepciones_para_cliente(v_org, '33693450239', 10000);
  IF (r->0->>'alicuota')::numeric <> 8 OR r->0->>'origen' <> 'sin_padron' THEN RAISE EXCEPTION 'FALLA 3a: %', r; END IF;
  r := public.percepciones_para_cliente(v_org, '20111111112', 10000);
  IF (r->0->>'alicuota')::numeric <> 8 THEN RAISE EXCEPTION 'FALLA 3b: %', r; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  IF jsonb_array_length(public.percepciones_para_cliente(v_org, '30712345671', 999)) <> 0 THEN RAISE EXCEPTION 'FALLA 4a: percibió debajo del mínimo'; END IF;
  PERFORM public.configurar_percepciones(v_org, true, 'ARBA', 8, 1000, true, 3);
  r := public.percepciones_para_cliente(v_org, '30712345671', 10000);
  IF jsonb_array_length(r) <> 2 OR (r->1->>'tipo')::int <> 6 OR (r->1->>'importe')::numeric <> 300 THEN RAISE EXCEPTION 'FALLA 4b: %', r; END IF;
  v_ok := v_ok || '4 ';

  -- 5
  BEGIN
    INSERT INTO public.padron_iibb_alicuotas (org_id, padron, cuit, alicuota, vigencia_desde, vigencia_hasta) VALUES (v_org, 'ARBA', '30712345671', 0, current_date, current_date);
    RAISE EXCEPTION 'FALLA 5a: escritura directa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cargar_padron_iibb(v_org, 'ARBA', '[]'::jsonb);
    RAISE EXCEPTION 'FALLA 5b: el vendedor cargó el padrón';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.configurar_percepciones(v_org, false, NULL, NULL, 0, false, NULL);
    RAISE EXCEPTION 'FALLA 5c: el vendedor cambió la configuración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
