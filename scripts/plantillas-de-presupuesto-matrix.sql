-- Simulacro de 20261014002200 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un vendedor guarda una plantilla y el dueño la ve.
--   2. Mismo nombre: se reemplaza (upsert), no se duplica.
--   3. Otro negocio no la ve ni la puede borrar; anónimo no lee nada.
--   4. El vendedor no borra la del dueño; el dueño borra cualquiera.
DO $$
DECLARE v_user uuid; v_vend uuid; v_org uuid; v_org2 uuid; v_n int;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ plantillas', 'zz-pl-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-pl2-' || substr(md5(random()::text), 1, 8), v_vend) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor'), (v_org2, v_vend, 'owner') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.plantillas_de_presupuesto (org_id, nombre, items) VALUES (v_org, 'Kit baño', '[{"description":"Canilla","qty":1}]');
  INSERT INTO public.plantillas_de_presupuesto (org_id, nombre, items) VALUES (v_org, 'Kit baño', '[{"description":"Canilla","qty":2}]')
    ON CONFLICT (org_id, nombre) DO UPDATE SET items = EXCLUDED.items, updated_at = now();
  RESET ROLE;
  IF (SELECT count(*) FROM public.plantillas_de_presupuesto WHERE org_id = v_org) <> 1
     OR (SELECT items->0->>'qty' FROM public.plantillas_de_presupuesto WHERE org_id = v_org) <> '2' THEN RAISE EXCEPTION 'FALLA 1-2'; END IF;

  -- dueño la ve y crea otra
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.plantillas_de_presupuesto WHERE org_id = v_org;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLA 1: el dueño no la ve'; END IF;
  INSERT INTO public.plantillas_de_presupuesto (org_id, nombre) VALUES (v_org, 'Del dueño');
  RESET ROLE;

  -- 3: anónimo
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.plantillas_de_presupuesto;
    RAISE EXCEPTION 'FALLA 3: anon leyó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 4: el vendedor no borra la del dueño (0 filas), sí la suya
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.plantillas_de_presupuesto WHERE org_id = v_org AND nombre = 'Del dueño';
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.plantillas_de_presupuesto WHERE org_id = v_org AND nombre = 'Del dueño') THEN RAISE EXCEPTION 'FALLA 4: el vendedor borró la del dueño'; END IF;

  -- 3: un usuario de otro negocio solamente no la ve
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_vend;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.plantillas_de_presupuesto WHERE org_id = v_org;
  DELETE FROM public.plantillas_de_presupuesto WHERE org_id = v_org;
  RESET ROLE;
  IF v_n <> 0 OR (SELECT count(*) FROM public.plantillas_de_presupuesto WHERE org_id = v_org) <> 2 THEN RAISE EXCEPTION 'FALLA 3: otro negocio la vio o la borró (%)', v_n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.plantillas_de_presupuesto WHERE org_id = v_org;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.plantillas_de_presupuesto WHERE org_id = v_org) THEN RAISE EXCEPTION 'FALLA 4: el dueño no pudo borrar'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
