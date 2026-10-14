-- Simulacro de 20261013000300 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Un usuario real de Famatina:
--   1. sube a la carpeta de su negocio en marketing-images → pasa
--   2. sube a la carpeta de otro negocio → RLS lo frena
--   3. sube a una ruta inventada → RLS lo frena
--   4. sube su avatar → pasa; el avatar de otro → RLS lo frena
--   5. buckets públicos sólo con tipos de imagen, sin SVG
DO $$
DECLARE v_user uuid; v_org uuid; v_otra uuid; v_ok boolean;
BEGIN
  SELECT o.id, m.user_id INTO v_org, v_user FROM public.organizations o
    JOIN public.memberships m ON m.org_id = o.id WHERE o.name ILIKE '%famatina%' LIMIT 1;
  SELECT id INTO v_otra FROM public.organizations
   WHERE id <> v_org AND NOT public.is_org_member(id, v_user) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('marketing-images', v_org || '/tienda/zz.png', v_user::text);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('marketing-images', v_otra || '/tienda/zz.png', v_user::text);
    RAISE EXCEPTION 'FALLA 2: pudo subir a la carpeta de otro negocio';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('marketing-images', 'phishing/login.html', v_user::text);
    RAISE EXCEPTION 'FALLA 3: pudo subir a una ruta inventada';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('avatars', 'avatars/' || v_user || '.png', v_user::text);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('avatars', 'avatars/' || gen_random_uuid() || '.png', v_user::text);
    RAISE EXCEPTION 'FALLA 4: pudo subir el avatar de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  RESET ROLE;
  SELECT bool_and(allowed_mime_types IS NOT NULL AND NOT ('image/svg+xml' = ANY(allowed_mime_types)) AND file_size_limit IS NOT NULL)
    INTO v_ok FROM storage.buckets WHERE public;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLA 5: hay un bucket público sin tipo o tamaño máximo'; END IF;

  RAISE EXCEPTION 'OK 1-5';
END $$;

ROLLBACK;
