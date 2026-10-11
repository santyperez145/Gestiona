-- Matriz reversible de 20261011000800 («avisame cuando lo tengas»).
--   node scripts/db.mjs --file scripts/aviso-busqueda-matrix.sql --allow-destructive
-- Un anónimo deja su email en una búsqueda sin resultados de una tienda ZZ:
-- se normaliza; repetir no duplica; email o término inválidos y tienda
-- inexistente se rechazan; el anónimo no lee; un viewer no lee ni borra; el
-- dueño lee y borra («Ya les avisé») y no inserta directo. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_av (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_av TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_view uuid; v_org uuid; v_tienda text; v_n int; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-aviso-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ aviso', 'zz-aviso-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_r := public.pedir_aviso_de_busqueda(upper(v_tienda), '  Taladro INALÁMBRICO ', ' Cliente@Ejemplo.com ');
  INSERT INTO zz_av VALUES ('el anónimo pide aviso', v_r::text);
  PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'taladro inalambrico', 'cliente@ejemplo.com');
  PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'taladro inalambrico', 'otra@ejemplo.com');
  BEGIN
    PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'taladro', 'no-es-email');
    INSERT INTO zz_av VALUES ('email inválido', 'PUDO (mal)');
  EXCEPTION WHEN raise_exception THEN INSERT INTO zz_av VALUES ('email inválido', SQLERRM); END;
  BEGIN
    PERFORM public.pedir_aviso_de_busqueda(v_tienda, '!', 'a@b.co');
    INSERT INTO zz_av VALUES ('término vacío', 'PUDO (mal)');
  EXCEPTION WHEN raise_exception THEN INSERT INTO zz_av VALUES ('término vacío', SQLERRM); END;
  BEGIN
    PERFORM public.pedir_aviso_de_busqueda('zz-no-existe', 'taladro', 'a@b.co');
    INSERT INTO zz_av VALUES ('tienda inexistente', 'PUDO (mal)');
  EXCEPTION WHEN raise_exception THEN INSERT INTO zz_av VALUES ('tienda inexistente', SQLERRM); END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.store_avisos_de_busqueda;
    INSERT INTO zz_av VALUES ('el anónimo lee', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_av VALUES ('el anónimo lee', 'rechazado'); END;
  RESET ROLE;

  INSERT INTO zz_av SELECT 'guardados (2: un email por término, normalizado)', count(*)::text || ' ' || string_agg(email || '/' || termino, ', ' ORDER BY email)
    FROM public.store_avisos_de_busqueda WHERE org_id = v_org;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.store_avisos_de_busqueda WHERE org_id = v_org;
  INSERT INTO zz_av VALUES ('el viewer lee (0)', v_n::text);
  DELETE FROM public.store_avisos_de_busqueda WHERE org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_av VALUES ('el viewer borra (0)', v_n::text);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.store_avisos_de_busqueda WHERE org_id = v_org;
  INSERT INTO zz_av VALUES ('el dueño lee (2)', v_n::text);
  BEGIN
    INSERT INTO public.store_avisos_de_busqueda (org_id, store_id, termino, email)
      SELECT v_org, s.id, 'zz', 'x@y.co' FROM public.ecommerce_stores s WHERE s.org_id = v_org;
    INSERT INTO zz_av VALUES ('el dueño inserta directo', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_av VALUES ('el dueño inserta directo', 'rechazado'); END;
  DELETE FROM public.store_avisos_de_busqueda WHERE org_id = v_org AND termino = 'taladro inalambrico';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_av VALUES ('el dueño borra «Ya les avisé» (2)', v_n::text);
  RESET ROLE;
END $d$;

SELECT * FROM zz_av;
ROLLBACK;
