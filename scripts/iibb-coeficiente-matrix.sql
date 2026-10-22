-- Simulacro de 20261022001000 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El dueño carga una jurisdicción de Convenio con su coeficiente.
--   2. Un coeficiente mayor que 1 o en cero no entra.
--   3. El vendedor no cambia el coeficiente.
DO $$
DECLARE v_user uuid; v_vend uuid; v_org uuid; v_reg uuid; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ IIBB', 'zz-iibb-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  INSERT INTO public.iibb_registrations (org_id, province, regime, rate_pct, coeficiente)
  VALUES (v_org, 'Córdoba', 'convenio', 4.75, 0.4321) RETURNING id INTO v_reg;
  IF (SELECT coeficiente FROM public.iibb_registrations WHERE id = v_reg) <> 0.4321 THEN RAISE EXCEPTION 'FALLA 1'; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  BEGIN
    UPDATE public.iibb_registrations SET coeficiente = 1.5 WHERE id = v_reg;
    RAISE EXCEPTION 'FALLA 2a: aceptó un coeficiente mayor que 1';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.iibb_registrations SET coeficiente = 0 WHERE id = v_reg;
    RAISE EXCEPTION 'FALLA 2b: aceptó un coeficiente en cero';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.iibb_registrations SET coeficiente = 0.9 WHERE id = v_reg;
  RESET ROLE;
  IF (SELECT coeficiente FROM public.iibb_registrations WHERE id = v_reg) <> 0.4321 THEN RAISE EXCEPTION 'FALLA 3: el vendedor cambió el coeficiente'; END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
