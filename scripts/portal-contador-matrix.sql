-- Simulacro de 20261030000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sólo el dueño o un administrador invita al contador.
--   2. La invitación la acepta sólo quien entra con el email invitado.
--   3. El contador ve a su cliente con el estado del mes y los datos fiscales;
--      otro usuario no, y nadie lee la tabla de accesos (ni el token) directo.
--   4. El dueño ve el acceso sin el token y lo revoca: el contador deja de ver.
--   5. Una invitación vencida no se acepta.
DO $$
DECLARE
  v_owner uuid; v_cont uuid; v_otro uuid; v_vend uuid; v_org uuid; v_inv uuid; v_email text; v_email_otro text;
  r jsonb; v_token text; v_id uuid; n integer; v_ok text := '';
  v_periodo text := to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM');
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_cont, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_otro, v_email_otro FROM auth.users WHERE id NOT IN (v_owner, v_cont) ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id NOT IN (v_owner, v_cont, v_otro) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Cliente del estudio', 'zz-est-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio, ingresos_brutos, inicio_actividades)
  VALUES (v_org, '20123456786', 3, 'produccion', 'responsable_inscripto', 'ZZ SRL', 'Av. ZZ 123, CABA', '901-123456-7', DATE '2020-01-01')
  ON CONFLICT (org_id) DO UPDATE SET environment = 'produccion', punto_venta = 3, domicilio = 'Av. ZZ 123, CABA',
    ingresos_brutos = '901-123456-7', inicio_actividades = DATE '2020-01-01', razon_social = 'ZZ SRL';

  -- Una factura B autorizada este mes.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_inv := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ CF'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'))->>'invoice_id')::uuid;
  RESET ROLE;
  UPDATE public.invoices SET afip_status = 'processing' WHERE id = v_inv;
  UPDATE public.invoices SET cae = '71234567890001', afip_status = 'authorized', numero_afip = 1 WHERE id = v_inv;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.invitar_contador(v_org, v_email);
    RAISE EXCEPTION 'FALLA 1a: un vendedor invitó al contador';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.invitar_contador(v_org, 'no es un email');
    RAISE EXCEPTION 'FALLA 1b: aceptó un email inválido';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.invitar_contador(v_org, upper(v_email));
  RESET ROLE;
  v_token := r->>'token';
  v_id := (r->>'id')::uuid;
  IF v_token IS NULL OR length(v_token) < 40 THEN RAISE EXCEPTION 'FALLA 1c: %', r; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aceptar_invitacion_contador(v_token);
    RAISE EXCEPTION 'FALLA 2a: otro email aceptó la invitación';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cont, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.aceptar_invitacion_contador(v_token);
  IF (r->>'org_id')::uuid <> v_org THEN RAISE EXCEPTION 'FALLA 2b: %', r; END IF;
  r := public.aceptar_invitacion_contador(v_token);
  IF NOT (r->>'ya_aceptada')::boolean THEN RAISE EXCEPTION 'FALLA 2c: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  SELECT count(*) INTO n FROM public.estudio_clientes(v_periodo) e WHERE e.org_id = v_org AND e.facturas = 1 AND e.razon_social = 'ZZ SRL';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA 3a: el contador no ve a su cliente'; END IF;
  r := public.estudio_datos_mes(v_org, v_periodo);
  IF jsonb_array_length(r->'comprobantes') <> 1 OR jsonb_array_length(r->'comprobantes'->0->'invoice_items') <> 1
     OR (r->>'monotributo')::boolean OR r->>'cuit' <> '20123456786' THEN
    RAISE EXCEPTION 'FALLA 3b: datos del mes %', r;
  END IF;
  PERFORM public.estudio_registrar_descarga(v_org, v_periodo);
  BEGIN
    PERFORM count(*) FROM public.contadores_de_negocio;
    RAISE EXCEPTION 'FALLA 3c: el contador leyó la tabla de accesos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.estudio_datos_mes(v_org, v_periodo);
    RAISE EXCEPTION 'FALLA 3d: un usuario sin acceso leyó los datos fiscales';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.estudio_clientes(v_periodo)) THEN RAISE EXCEPTION 'FALLA 3e: otro usuario vio clientes'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND entity_type = 'paquete_contador' AND user_id = v_cont) THEN
    RAISE EXCEPTION 'FALLA 3f: la descarga no quedó en la auditoría';
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT to_jsonb(c) INTO r FROM public.contadores_del_negocio(v_org) c LIMIT 1;
  IF r->>'estado' <> 'activo' OR r ? 'token' THEN RAISE EXCEPTION 'FALLA 4a: %', r; END IF;
  PERFORM public.revocar_contador(v_id);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cont, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.estudio_datos_mes(v_org, v_periodo);
    RAISE EXCEPTION 'FALLA 4b: el contador revocado siguió leyendo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.estudio_clientes(v_periodo)) THEN RAISE EXCEPTION 'FALLA 4c: el revocado ve al cliente'; END IF;
  RESET ROLE;
  v_ok := v_ok || '4 ';

  -- 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.invitar_contador(v_org, v_email_otro);
  RESET ROLE;
  UPDATE public.contadores_de_negocio SET expira_at = now() - interval '1 day' WHERE id = (r->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aceptar_invitacion_contador(r->>'token');
    RAISE EXCEPTION 'FALLA 5: aceptó una invitación vencida';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
