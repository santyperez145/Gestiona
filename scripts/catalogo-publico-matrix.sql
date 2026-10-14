-- Simulacro de 20261013000600 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Como anon:
--   1. no puede leer las vistas del catálogo directo (no se enumeran negocios)
--   2. catalogo_publico(id de Exentry) devuelve sus productos, ajustes y marca,
--      y sólo de Exentry
--   3. por usuario (link viejo) también funciona
--   4. un id inexistente devuelve productos vacíos, sin error
--   5. las variantes de un producto del catálogo se leen por la función
DO $$
DECLARE v_org uuid; v_user uuid; v_r jsonb; v_n int; v_otros int; v_prod uuid;
BEGIN
  SELECT org_id, user_id INTO v_org, v_user FROM public.catalog_products cp
   JOIN public.organizations o ON o.id = cp.org_id WHERE o.name ILIKE '%exentry%' LIMIT 1;
  SELECT id INTO v_prod FROM public.catalog_products WHERE org_id = v_org LIMIT 1;

  IF has_table_privilege('anon', 'public.catalog_products', 'SELECT')
     OR has_table_privilege('anon', 'public.settings_public', 'SELECT') THEN
    RAISE EXCEPTION 'FALLA 1: anon todavía lee las vistas del catálogo';
  END IF;

  SET LOCAL ROLE anon;
  v_r := public.catalogo_publico(v_org);
  SELECT count(*), count(*) FILTER (WHERE (e->>'org_id')::uuid <> v_org) INTO v_n, v_otros
    FROM jsonb_array_elements(v_r->'productos') e;
  IF v_n = 0 OR v_otros > 0 THEN RAISE EXCEPTION 'FALLA 2: % productos, % ajenos', v_n, v_otros; END IF;
  IF v_r->'marca' IS NULL OR v_r->'marca' = 'null'::jsonb THEN RAISE EXCEPTION 'FALLA 2: sin marca'; END IF;

  v_r := public.catalogo_publico(v_user);
  IF jsonb_array_length(v_r->'productos') = 0 THEN RAISE EXCEPTION 'FALLA 3: por usuario no trae productos'; END IF;

  v_r := public.catalogo_publico(gen_random_uuid());
  IF jsonb_array_length(v_r->'productos') <> 0 THEN RAISE EXCEPTION 'FALLA 4'; END IF;

  PERFORM * FROM public.catalogo_publico_variantes(v_prod);
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-5 (% productos de Exentry)', v_n;
END $$;

ROLLBACK;
