-- Matriz reversible de 20261011000500 (búsquedas sin resultado).
--   node scripts/db.mjs --file scripts/busquedas-sin-resultado-matrix.sql
-- Un anónimo registra búsquedas en una tienda ZZ: se normalizan y se cuentan;
-- los símbolos se limpian («<script>» queda «script»); términos cortos y
-- tiendas inexistentes no dejan filas; el anónimo
-- no lee la tabla; el dueño sí; un vendedor sin permiso de tienda no. Todo se
-- revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_bs (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_bs TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_tienda text; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-busca-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ busquedas', 'zz-busquedas-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.registrar_busqueda_sin_resultado(upper(v_tienda), '  Taladro   INALÁMBRICO ');
  PERFORM public.registrar_busqueda_sin_resultado(v_tienda, 'taladro inalambrico');
  PERFORM public.registrar_busqueda_sin_resultado(v_tienda, 'Pintura látex');
  PERFORM public.registrar_busqueda_sin_resultado(v_tienda, 'a');
  PERFORM public.registrar_busqueda_sin_resultado(v_tienda, '<script>');
  PERFORM public.registrar_busqueda_sin_resultado('zz-no-existe', 'taladro');
  BEGIN
    SELECT count(*) INTO v_n FROM public.store_busquedas_sin_resultado;
    INSERT INTO zz_bs VALUES ('el anónimo lee la tabla', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_bs VALUES ('el anónimo lee la tabla', 'rechazado');
  END;
  RESET ROLE;

  INSERT INTO zz_bs SELECT 'normaliza y cuenta: taladro (taladro inalambrico 2)', termino || ' ' || veces
    FROM public.store_busquedas_sin_resultado WHERE org_id = v_org AND termino LIKE 'taladro%';
  INSERT INTO zz_bs SELECT 'términos guardados (3: taladro, pintura, script; sin cortos)', count(*)::text
    FROM public.store_busquedas_sin_resultado WHERE org_id = v_org;
  INSERT INTO zz_bs SELECT 'sólo letras, números y espacios (0 con otra cosa)', count(*)::text
    FROM public.store_busquedas_sin_resultado WHERE org_id = v_org AND termino !~ '^[a-z0-9 ]+$';
  INSERT INTO zz_bs SELECT 'tienda inexistente no deja filas (0)', count(*)::text
    FROM public.store_busquedas_sin_resultado b WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = b.org_id AND o.id = v_org) AND b.termino = 'taladro';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.store_busquedas_sin_resultado WHERE org_id = v_org;
  INSERT INTO zz_bs VALUES ('el dueño lee (3)', v_n::text);
  BEGIN
    INSERT INTO public.store_busquedas_sin_resultado (org_id, termino) VALUES (v_org, 'zz directo');
    INSERT INTO zz_bs VALUES ('el dueño escribe directo', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_bs VALUES ('el dueño escribe directo', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_bs;
ROLLBACK;
