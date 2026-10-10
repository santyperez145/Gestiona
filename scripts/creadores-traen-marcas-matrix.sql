-- Matriz reversible de 20261010002400 (creadores que traen marcas).
--   node scripts/db.mjs --file scripts/creadores-traen-marcas-matrix.sql
-- Un creador ZZ con slug público invita; un alta real por auth.users con
-- ref=@slug queda «creador» y él la ve en su conteo. Un slug de comercio sigue
-- resolviendo a comercio. Una cuenta que no es de creador no usa la función.
-- Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_cr (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_cr TO authenticated;

DO $d$
DECLARE
  v_creador uuid := gen_random_uuid(); v_slug text; v_u uuid; v_org uuid; v_r jsonb; v_otro uuid;
BEGIN
  v_slug := 'zz-creadora-' || substr(md5(random()::text), 1, 8);
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (v_creador, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'zz-cr-' || substr(v_creador::text, 1, 8) || '@zz.invalid', jsonb_build_object('full_name', 'ZZ Creadora', 'account_type', 'creator'), now(), now());
  INSERT INTO public.creator_accounts (user_id, email, display_name, public_slug)
  VALUES (v_creador, 'zz-cr-' || substr(v_creador::text, 1, 8) || '@zz.invalid', 'ZZ Creadora', v_slug)
  ON CONFLICT (user_id) DO UPDATE SET public_slug = EXCLUDED.public_slug;
  INSERT INTO zz_cr SELECT 'la creadora no recibe comercio (0)', count(*)::text FROM public.organizations WHERE owner_user_id = v_creador;

  v_u := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'zz-m-' || substr(v_u::text, 1, 8) || '@zz.invalid',
    jsonb_build_object('full_name', 'ZZ Marca invitada', 'origen', jsonb_build_object('ref', '@' || upper(v_slug), 'utm_source', 'creador')), now(), now());
  SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_u;
  INSERT INTO zz_cr SELECT 'alta con ref=@slug: canal/creador (creador/sí)',
    canal || '/' || CASE WHEN referido_por_creador = v_creador THEN 'sí' ELSE 'no' END FROM public.origen_de_alta WHERE org_id = v_org;

  v_otro := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (v_otro, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'zz-o-' || substr(v_otro::text, 1, 8) || '@zz.invalid',
    jsonb_build_object('full_name', 'ZZ Referida por comercio', 'origen', jsonb_build_object('ref', (SELECT slug FROM public.organizations WHERE id = v_org))), now(), now());
  INSERT INTO zz_cr SELECT 'slug de comercio sigue siendo comercio (comercio)', a.canal
    FROM public.origen_de_alta a JOIN public.organizations o ON o.id = a.org_id WHERE o.owner_user_id = v_otro;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.marcas_que_trajo_el_creador();
  INSERT INTO zz_cr VALUES ('la creadora ve sus marcas: total/nombre (1/ZZ Marca invitada Workspace)', (v_r->>'total') || '/' || (v_r->'marcas'->0->>'nombre'));
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.marcas_que_trajo_el_creador();
    INSERT INTO zz_cr VALUES ('cuenta de comercio', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_cr VALUES ('cuenta de comercio', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_cr;
ROLLBACK;
