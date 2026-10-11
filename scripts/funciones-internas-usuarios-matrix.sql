-- Matriz reversible de 20261011001900.
--   node scripts/db.mjs --file scripts/funciones-internas-usuarios-matrix.sql
-- Un usuario con sesión que NO es miembro de una organización ZZ intenta
-- avisar a sus dueños y recalcular sus límites. Después de la migración, las
-- dos se rechazan; un disparador interno que las usa sigue funcionando (se
-- llama como dueño). Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_fi (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_fi TO authenticated;
DO $d$
DECLARE v_owner uuid; v_ajeno uuid; v_org uuid; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_ajeno FROM auth.users WHERE id <> v_owner ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ interna', 'zz-interna-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_ajeno;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.avisar_a_los_que_mandan(v_org, 'ZZ phishing', 'Entrá a este enlace', 'sistema', NULL, NULL, true);
    INSERT INTO zz_fi VALUES ('usuario ajeno avisa a los dueños', 'PUDO');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_fi VALUES ('usuario ajeno avisa a los dueños', 'rechazado'); END;
  BEGIN
    PERFORM public.aplicar_limites_del_plan(v_org);
    INSERT INTO zz_fi VALUES ('usuario ajeno recalcula límites', 'PUDO');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_fi VALUES ('usuario ajeno recalcula límites', 'rechazado'); END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.notifications WHERE org_id = v_org AND title = 'ZZ phishing';
  INSERT INTO zz_fi VALUES ('avisos inyectados', v_n::text);
  SELECT public.avisar_a_los_que_mandan(v_org, 'ZZ interno', 'ok', 'sistema') INTO v_n;
  INSERT INTO zz_fi VALUES ('el servidor (dueño de la función) sigue avisando', v_n::text);
END $d$;
SELECT * FROM zz_fi;
ROLLBACK;
