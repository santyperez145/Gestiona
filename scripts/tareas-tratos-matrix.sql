-- Matriz reversible de 20261011001700 (tareas y tratos con permiso de CRM).
--   node scripts/db.mjs --file scripts/tareas-tratos-matrix.sql --allow-destructive
-- Organización ZZ con dueño, vendedor y viewer (permisos por defecto copiados).
-- El vendedor crea y cierra sus tareas y mueve su trato, pero no edita ni
-- borra lo de otros; el viewer lee y no escribe. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_tt (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_tt TO authenticated;

DO $d$
DECLARE v_owner uuid; v_vend uuid; v_view uuid; v_org uuid; v_t_owner uuid; v_t_vend uuid; v_d_owner uuid; v_n int; u record;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id NOT IN (v_owner, v_vend) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ crm', 'zz-crm-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions (org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    SELECT DISTINCT ON (role, module) v_org, role, module, can_view, can_create, can_edit, can_delete, can_export
    FROM public.role_permissions WHERE org_id <> v_org AND role IN ('vendedor', 'viewer') ORDER BY role, module
  ON CONFLICT DO NOTHING;
  INSERT INTO public.tasks (org_id, title, created_by, assigned_to) VALUES (v_org, 'ZZ del dueño', v_owner, v_owner) RETURNING id INTO v_t_owner;
  INSERT INTO public.tasks (org_id, title, created_by, assigned_to) VALUES (v_org, 'ZZ asignada al vendedor', v_owner, v_vend) RETURNING id INTO v_t_vend;
  INSERT INTO public.deals (org_id, user_id, title) VALUES (v_org, v_owner, 'ZZ trato del dueño') RETURNING id INTO v_d_owner;

  FOR u IN SELECT * FROM (VALUES ('vendedor', v_vend), ('viewer', v_view), ('dueño', v_owner)) x(rol, id) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.tasks WHERE org_id = v_org;
    INSERT INTO zz_tt VALUES (u.rol || ' lee tareas', v_n::text);
    BEGIN
      INSERT INTO public.tasks (org_id, title, created_by, assigned_to) VALUES (v_org, 'ZZ de ' || u.rol, u.id, u.id);
      INSERT INTO zz_tt VALUES (u.rol || ' crea tarea', 'pudo');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_tt VALUES (u.rol || ' crea tarea', 'rechazado'); END;
    UPDATE public.tasks SET title = title WHERE id = v_t_vend;
    GET DIAGNOSTICS v_n = ROW_COUNT; INSERT INTO zz_tt VALUES (u.rol || ' edita tarea asignada al vendedor', v_n::text);
    UPDATE public.tasks SET title = title WHERE id = v_t_owner;
    GET DIAGNOSTICS v_n = ROW_COUNT; INSERT INTO zz_tt VALUES (u.rol || ' edita tarea del dueño', v_n::text);
    BEGIN
      INSERT INTO public.deals (org_id, user_id, title) VALUES (v_org, u.id, 'ZZ trato de ' || u.rol);
      INSERT INTO zz_tt VALUES (u.rol || ' crea trato', 'pudo');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_tt VALUES (u.rol || ' crea trato', 'rechazado'); END;
    UPDATE public.deals SET title = title WHERE org_id = v_org AND user_id = u.id;
    GET DIAGNOSTICS v_n = ROW_COUNT; INSERT INTO zz_tt VALUES (u.rol || ' edita su trato', v_n::text);
    UPDATE public.deals SET title = title WHERE id = v_d_owner;
    GET DIAGNOSTICS v_n = ROW_COUNT; INSERT INTO zz_tt VALUES (u.rol || ' edita trato del dueño', v_n::text);
    DELETE FROM public.tasks WHERE id = v_t_vend;
    GET DIAGNOSTICS v_n = ROW_COUNT; INSERT INTO zz_tt VALUES (u.rol || ' borra tarea asignada al vendedor', v_n::text);
    RESET ROLE;
  END LOOP;
END $d$;

SELECT * FROM zz_tt;
ROLLBACK;
