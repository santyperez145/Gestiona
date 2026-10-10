-- Matriz reversible de 20261010002200 (origen de cada alta).
--   node scripts/db.mjs --file scripts/origen-de-alta-matrix.sql
-- Altas reales por auth.users (el mismo camino que la app): referido por un
-- comercio, por un influencer, código desconocido, campaña, sitio, directo y
-- metadatos basura (el alta se crea igual). Lectura sólo para el comercio y
-- plataforma. Organizaciones y usuarios ZZ; todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_or (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_or TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_marca uuid; v_slug text; v_inf uuid; v_u uuid; v_org uuid; v_r record; v_n int;
  v_casos jsonb := jsonb_build_array(
    jsonb_build_object('caso', 'referido por comercio', 'origen', jsonb_build_object('ref', '__SLUG__', 'pagina_entrada', '/precios')),
    jsonb_build_object('caso', 'referido por influencer', 'origen', jsonb_build_object('ref', 'ZZINF77', 'utm_source', 'instagram')),
    jsonb_build_object('caso', 'código desconocido', 'origen', jsonb_build_object('ref', 'zz-no-existe')),
    jsonb_build_object('caso', 'campaña', 'origen', jsonb_build_object('utm_source', 'google', 'utm_medium', 'cpc', 'utm_campaign', 'ferreterias')),
    jsonb_build_object('caso', 'sitio', 'origen', jsonb_build_object('sitio_origen', 'www.facebook.com', 'primer_contacto_at', '2026-10-01T10:00:00Z')),
    jsonb_build_object('caso', 'directo', 'origen', NULL),
    jsonb_build_object('caso', 'basura', 'origen', to_jsonb('<script>'::text)),
    jsonb_build_object('caso', 'fecha inválida', 'origen', jsonb_build_object('primer_contacto_at', 'ayer', 'ref', repeat('x', 500))));
  v_c jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_slug := 'zz-referente-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ referente', v_slug, v_owner) RETURNING id INTO v_marca;
  INSERT INTO public.influencers (org_id, user_id, name, referral_code) VALUES (v_marca, v_owner, 'ZZ influencer', 'ZZINF77') RETURNING id INTO v_inf;

  FOR v_c IN SELECT * FROM jsonb_array_elements(v_casos) LOOP
    v_u := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'zz-' || substr(v_u::text, 1, 8) || '@zz.invalid',
      jsonb_build_object('full_name', 'ZZ ' || (v_c->>'caso')) || CASE WHEN v_c->'origen' IS NULL OR v_c->'origen' = 'null'::jsonb THEN '{}'::jsonb
        ELSE jsonb_build_object('origen', replace((v_c->'origen')::text, '__SLUG__', v_slug)::jsonb) END,
      now(), now());
    SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_u;
    SELECT * INTO v_r FROM public.origen_de_alta WHERE org_id = v_org;
    INSERT INTO zz_or VALUES (v_c->>'caso',
      CASE WHEN v_org IS NULL THEN 'SIN COMERCIO (mal)' ELSE
        coalesce(v_r.canal, '∅') || ' | cod=' || coalesce(left(v_r.codigo, 12), '∅') || ' | org=' ||
        CASE WHEN v_r.referido_por_org = v_marca THEN 'referente' WHEN v_r.referido_por_org IS NULL THEN '∅' ELSE 'otra' END ||
        ' | inf=' || CASE WHEN v_r.referido_por_influencer = v_inf THEN 'sí' ELSE '∅' END ||
        ' | utm=' || coalesce(v_r.utm_campaign, v_r.utm_source, '∅') || ' | sitio=' || coalesce(v_r.sitio_origen, '∅') ||
        ' | desde=' || coalesce(to_char(v_r.primer_contacto_at AT TIME ZONE 'UTC', 'MM-DD'), '∅') END);
  END LOOP;

  -- Lectura: el dueño del último alta ve la suya; un tercero no.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.origen_de_alta WHERE org_id = v_org;
  INSERT INTO zz_or VALUES ('el comercio ve su origen (1)', v_n::text);
  SELECT count(*) INTO v_n FROM public.origen_de_alta WHERE org_id <> v_org;
  INSERT INTO zz_or VALUES ('no ve el de otros (0)', v_n::text);
  BEGIN
    UPDATE public.origen_de_alta SET canal = 'directo' WHERE org_id = v_org;
    INSERT INTO zz_or VALUES ('no puede reescribirlo', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_or VALUES ('no puede reescribirlo', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_or;
ROLLBACK;
