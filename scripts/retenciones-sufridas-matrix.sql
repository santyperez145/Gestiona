-- Simulacro de 20261022000300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El dueño carga una retención de IVA.
--   2. El mismo certificado del mismo agente no entra dos veces.
--   3. El período no puede ser anterior a la fecha.
--   4. El vendedor (permisos por defecto) no lee ni carga.
--   5. No se puede editar (sin UPDATE): se borra y se vuelve a cargar.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; n int; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ retenciones', 'zz-ret-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- 1
  INSERT INTO public.retenciones_sufridas (org_id, periodo, fecha, impuesto, agente_cuit, agente_nombre, numero_certificado, importe)
  VALUES (v_org, '2026-09', '2026-09-10', 'iva', '30712345671', 'ZZ Agente SA', '0001-00001234', 1500);
  v_ok := v_ok || '1 ';
  -- 2
  BEGIN
    INSERT INTO public.retenciones_sufridas (org_id, periodo, fecha, impuesto, agente_cuit, agente_nombre, numero_certificado, importe)
    VALUES (v_org, '2026-10', '2026-09-10', 'iva', '30712345671', 'ZZ Agente SA', '0001-00001234', 1500);
    RAISE EXCEPTION 'FALLA 2';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  v_ok := v_ok || '2 ';
  -- 3
  BEGIN
    INSERT INTO public.retenciones_sufridas (org_id, periodo, fecha, impuesto, agente_cuit, agente_nombre, numero_certificado, importe)
    VALUES (v_org, '2026-08', '2026-09-10', 'ganancias', '30712345671', 'ZZ', '99', 10);
    RAISE EXCEPTION 'FALLA 3';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_ok := v_ok || '3 ';
  -- 5
  BEGIN
    UPDATE public.retenciones_sufridas SET importe = 1 WHERE org_id = v_org;
    RAISE EXCEPTION 'FALLA 5: se pudo editar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.retenciones_sufridas WHERE org_id = v_org;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FALLA 4: el vendedor ve %', n; END IF;
  BEGIN
    INSERT INTO public.retenciones_sufridas (org_id, periodo, fecha, impuesto, agente_cuit, agente_nombre, numero_certificado, importe)
    VALUES (v_org, '2026-09', '2026-09-10', 'iva', '30712345671', 'ZZ', '77', 1);
    RAISE EXCEPTION 'FALLA 4: el vendedor cargó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
