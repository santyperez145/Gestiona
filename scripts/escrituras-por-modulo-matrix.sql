-- Matriz reversible de 20261011001600 (escrituras por módulo).
--   node scripts/db.mjs --file scripts/escrituras-por-modulo-matrix.sql --allow-destructive
-- Organización ZZ con dueño, vendedor y viewer (permisos por defecto del rol
-- copiados de otra organización). Cada uno intenta escribir clientes, links
-- de pago y campañas, editar reglas de alerta y borrar un cliente. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_em (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_em TO authenticated;

DO $d$
DECLARE v_owner uuid; v_vend uuid; v_view uuid; v_org uuid; v_c uuid; v_n int; u record;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id NOT IN (v_owner, v_vend) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ permisos', 'zz-permisos-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions (org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    SELECT DISTINCT ON (role, module) v_org, role, module, can_view, can_create, can_edit, can_delete, can_export
    FROM public.role_permissions WHERE org_id <> v_org AND role IN ('vendedor', 'viewer') ORDER BY role, module
  ON CONFLICT DO NOTHING;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_owner, 'ZZ cliente base') RETURNING id INTO v_c;
  INSERT INTO public.alert_rules (org_id, type) VALUES (v_org, 'stock_low') ON CONFLICT DO NOTHING;

  FOR u IN SELECT * FROM (VALUES ('dueño', v_owner), ('vendedor', v_vend), ('viewer', v_view)) x(rol, id) LOOP
    INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_owner, 'ZZ para borrar') RETURNING id INTO v_c;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_n FROM public.customers WHERE org_id = v_org;
    INSERT INTO zz_em VALUES (u.rol || ' lee clientes', v_n::text);
    BEGIN
      INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, u.id, 'ZZ de ' || u.rol);
      INSERT INTO zz_em VALUES (u.rol || ' crea cliente', 'pudo');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_em VALUES (u.rol || ' crea cliente', 'rechazado'); END;
    BEGIN
      INSERT INTO public.payment_links (org_id, customer_name, total_ars) VALUES (v_org, 'ZZ', 100);
      INSERT INTO zz_em VALUES (u.rol || ' crea link de pago', 'pudo');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_em VALUES (u.rol || ' crea link de pago', 'rechazado'); END;
    BEGIN
      INSERT INTO public.email_campaigns (org_id, subject, body_html) VALUES (v_org, 'ZZ', '<p>ZZ</p>');
      INSERT INTO zz_em VALUES (u.rol || ' crea campaña', 'pudo');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_em VALUES (u.rol || ' crea campaña', 'rechazado'); END;
    UPDATE public.alert_rules SET enabled = enabled WHERE org_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_em VALUES (u.rol || ' edita reglas de alerta', CASE WHEN v_n > 0 THEN 'pudo' ELSE 'no (0 filas)' END);
    DELETE FROM public.customers WHERE id = v_c;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_em VALUES (u.rol || ' borra cliente', CASE WHEN v_n > 0 THEN 'pudo' ELSE 'no (0 filas)' END);
    RESET ROLE;
  END LOOP;
END $d$;

SELECT * FROM zz_em;
ROLLBACK;
