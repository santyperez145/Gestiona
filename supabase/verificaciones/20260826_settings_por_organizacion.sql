CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
CREATE TEMP TABLE orgs_antes AS SELECT id FROM public.organizations;

DO $blk$
DECLARE
  v_user uuid; v_org1 uuid; v_org2 uuid; v_n int; v_txt text; v_fallo text;
BEGIN
  -- ── 1. El indice unico se fue ───────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname='public' AND indexname='settings_user_id_key';
  INSERT INTO r VALUES (1,'el indice unico por usuario ya no esta', v_n::text, v_n=0);

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname='public' AND indexname='settings_org_id_unique';
  INSERT INTO r VALUES (2,'pero org_id sigue siendo unico', v_n::text, v_n=1);

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname='public' AND indexname='settings_user_id_idx';
  INSERT INTO r VALUES (3,'y queda indice no unico para el catalogo heredado', v_n::text, v_n=1);

  -- ── 4. ⚠️ EL CASO QUE ESTABA ROTO: dos comercios, un dueño ─────────────
  SELECT m.user_id INTO v_user FROM public.memberships m
   JOIN auth.users u ON u.id = m.user_id
   WHERE m.role='owner' LIMIT 1;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ Comercio Uno', 'zz-comercio-uno-'||substr(gen_random_uuid()::text,1,8), v_user)
  RETURNING id INTO v_org1;

  v_fallo := NULL;
  BEGIN
    INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ Comercio Dos', 'zz-comercio-dos-'||substr(gen_random_uuid()::text,1,8), v_user)
    RETURNING id INTO v_org2;
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (4,'un mismo dueno puede tener un SEGUNDO comercio',
    COALESCE(left(v_fallo,50),'ok'), v_fallo IS NULL);

  -- ── 5. Y los dos tienen configuracion propia ───────────────────────────
  SELECT count(*) INTO v_n FROM public.settings WHERE org_id IN (v_org1, v_org2);
  INSERT INTO r VALUES (5,'las dos organizaciones tienen settings', v_n::text, v_n=2);

  SELECT count(*) INTO v_n FROM public.settings WHERE user_id = v_user;
  INSERT INTO r VALUES (6,'el mismo usuario ahora tiene mas de una fila', v_n::text, v_n >= 2);

  -- ── 7. Cada una con su nombre, no el del alta ──────────────────────────
  SELECT business_name INTO v_txt FROM public.settings WHERE org_id = v_org2;
  INSERT INTO r VALUES (7,'con el nombre de su propia organizacion',
    COALESCE(v_txt,'-'), v_txt = 'ZZ Comercio Dos');

  -- ── 8. El trigger no rompe si el dueño no existe ───────────────────────
  v_fallo := NULL;
  BEGIN
    INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ Sin Dueno', 'zz-sin-dueno-'||substr(gen_random_uuid()::text,1,8),
            '00000000-0000-0000-0000-000000000009');
  EXCEPTION WHEN foreign_key_violation THEN
    -- La FK de organizations tambien apunta a auth.users: si rechaza aca, el
    -- caso no llega al trigger y el riesgo no existe.
    v_fallo := 'la FK de organizations lo frena antes';
  WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (8,'un dueno inexistente no rompe nada',
    COALESCE(left(v_fallo,45),'creada sin settings, sin error'), true);

  -- ── 9. La guarda ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_org_sin_settings
   WHERE org_id IN (v_org1, v_org2);
  INSERT INTO r VALUES (9,'las nuevas no figuran sin configuracion', v_n::text, v_n=0);

  SELECT string_agg(name||' ('||motivo||')', '; ') INTO v_txt
    FROM public.audit_org_sin_settings;
  INSERT INTO r VALUES (10,'y las que quedan dicen POR QUE',
    COALESCE(left(v_txt,60),'(ninguna)'), true);

  -- ── Limpieza ───────────────────────────────────────────────────────────
  DELETE FROM public.settings WHERE org_id IN (v_org1, v_org2);
  DELETE FROM public.memberships WHERE org_id IN (v_org1, v_org2);
  DELETE FROM public.subscriptions WHERE org_id IN (v_org1, v_org2);
  DELETE FROM public.organizations WHERE name LIKE 'ZZ Comercio %' OR name = 'ZZ Sin Dueno';
END $blk$;

INSERT INTO r
SELECT 11, 'restos',
  (SELECT count(*) FROM public.organizations WHERE id NOT IN (SELECT id FROM orgs_antes))::text
  || ' restos',
  (SELECT count(*) FROM public.organizations WHERE id NOT IN (SELECT id FROM orgs_antes)) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
