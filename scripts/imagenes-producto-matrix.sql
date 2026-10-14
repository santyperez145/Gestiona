-- Simulacro de 20261013000400 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Usuario real de Famatina en product-images:
--   1. carpeta de su negocio y carpeta de su usuario → pasan
--   2. carpeta de otro negocio → RLS lo frena
--   3. ruta suelta → RLS lo frena
DO $$
DECLARE v_user uuid; v_org uuid; v_otra uuid;
BEGIN
  SELECT o.id, m.user_id INTO v_org, v_user FROM public.organizations o
    JOIN public.memberships m ON m.org_id = o.id WHERE o.name ILIKE '%famatina%' LIMIT 1;
  SELECT id INTO v_otra FROM public.organizations
   WHERE id <> v_org AND NOT public.is_org_member(id, v_user) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('product-images', v_org || '/migradas/zz.png', v_user::text);
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('product-images', v_user || '/zz.png', v_user::text);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('product-images', v_otra || '/zz.png', v_user::text);
    RAISE EXCEPTION 'FALLA 2: pudo subir a la carpeta de otro negocio';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('product-images', 'zz/x.png', v_user::text);
    RAISE EXCEPTION 'FALLA 3: pudo subir a una ruta suelta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
