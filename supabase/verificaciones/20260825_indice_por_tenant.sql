CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
GRANT ALL ON r TO authenticated, anon;

DO $blk$
DECLARE v_n int; v_txt text; v_dueno uuid;
BEGIN
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.role IN ('owner','admin') LIMIT 1;

  -- ── 1. La vista quedó vacía ─────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_org_sin_indice;
  INSERT INTO r VALUES (1,'ninguna tabla con org_id queda sin indice', v_n::text, v_n=0);

  -- ── 2. Los 7 indices existen y org_id va PRIMERO ────────────────────────
  -- Que exista un indice no alcanza: si org_id va segundo, no se usa para
  -- filtrar por tenant. Se comprueba la posicion, no el nombre.
  SELECT count(*) INTO v_n
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
   WHERE n.nspname='public' AND a.attname='org_id'
     AND c.relname IN ('finance_document_events','finance_document_extraction_revisions',
                       'finance_document_line_matches','finance_document_match_runs',
                       'finance_purchase_draft_lines','finance_purchase_drafts',
                       'product_import_rows');
  INSERT INTO r VALUES (2,'las 7 tablas tienen org_id como primera columna', v_n::text, v_n>=7);

  -- ── 3. Donde hay created_at, el indice tambien ordena ───────────────────
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname='public'
     AND indexname IN ('finance_document_events_org_idx',
                       'finance_document_extraction_revisions_org_idx',
                       'finance_document_match_runs_org_idx',
                       'finance_purchase_drafts_org_idx')
     AND indexdef LIKE '%(org_id, created_at DESC)%';
  INSERT INTO r VALUES (3,'y sirven para ordenar el listado, no solo filtrar', v_n::text, v_n=4);

  -- ── 4. ⚠️ La vista es de plataforma, no de comercio ─────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO v_n FROM public.audit_org_sin_indice;
    INSERT INTO r VALUES (4,'un comercio NO lee el esquema de la plataforma',
                          v_n||' filas', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES (4,'un comercio NO lee el esquema de la plataforma',
                          'permiso denegado', true);
  END;
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.audit_org_sin_indice;
    INSERT INTO r VALUES (5,'anon tampoco', v_n||' filas', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES (5,'anon tampoco', 'permiso denegado', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── 5. La guarda detecta de verdad ──────────────────────────────────────
  -- Un guardia que nunca vio rojo no se sabe si funciona. Se crea una tabla
  -- con org_id y sin indice, se comprueba que aparezca, y se borra.
  CREATE TABLE public.zz_prueba_indice (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid);
  SELECT count(*) INTO v_n FROM public.audit_org_sin_indice WHERE tabla='zz_prueba_indice';
  INSERT INTO r VALUES (6,'la vista SI detecta una tabla nueva sin indice', v_n::text, v_n=1);

  CREATE INDEX zz_prueba_indice_org_idx ON public.zz_prueba_indice (org_id);
  SELECT count(*) INTO v_n FROM public.audit_org_sin_indice WHERE tabla='zz_prueba_indice';
  INSERT INTO r VALUES (7,'y deja de reportarla al agregarle el indice', v_n::text, v_n=0);

  DROP TABLE public.zz_prueba_indice;
END $blk$;

INSERT INTO r
SELECT 8, 'restos',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'zz_%')::text || ' restos',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'zz_%') = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
