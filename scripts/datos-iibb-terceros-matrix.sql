-- Simulacro de 20261023000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un proveedor y un cliente guardan su situación en Ingresos Brutos, su
--      inscripción y (el proveedor) su condición frente al IVA.
--   2. Valores fuera del diseño de AGIP se rechazan.
--   3. Un miembro del negocio los edita como el resto de la ficha.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_prov uuid; v_cli uuid; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ IIBB', 'zz-iibb-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;

  -- 1
  INSERT INTO public.suppliers (org_id, name, cuit, iibb_situacion, iibb_inscripcion, condicion_iva)
  VALUES (v_org, 'ZZ Proveedor', '30712345671', 2, '30712345671', 'responsable_inscripto') RETURNING id INTO v_prov;
  INSERT INTO public.customers (org_id, name, iibb_situacion, iibb_inscripcion) VALUES (v_org, 'ZZ Cliente', 1, '1234567890') RETURNING id INTO v_cli;
  v_ok := v_ok || '1 ';

  -- 2
  BEGIN
    UPDATE public.suppliers SET iibb_situacion = 3 WHERE id = v_prov;
    RAISE EXCEPTION 'FALLA 2a: aceptó la situación 3';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.customers SET iibb_inscripcion = '12-34' WHERE id = v_cli;
    RAISE EXCEPTION 'FALLA 2b: aceptó una inscripción con guiones';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.suppliers SET condicion_iva = 'otra' WHERE id = v_prov;
    RAISE EXCEPTION 'FALLA 2c: aceptó una condición de IVA inventada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.suppliers SET iibb_situacion = 4, iibb_inscripcion = NULL WHERE id = v_prov;
  UPDATE public.customers SET iibb_situacion = 2, iibb_inscripcion = '30712345671' WHERE id = v_cli;
  RESET ROLE;
  IF (SELECT iibb_situacion FROM public.suppliers WHERE id = v_prov) <> 4
     OR (SELECT iibb_inscripcion FROM public.customers WHERE id = v_cli) <> '30712345671' THEN
    RAISE EXCEPTION 'FALLA 3: el dueño no pudo editar los datos';
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
