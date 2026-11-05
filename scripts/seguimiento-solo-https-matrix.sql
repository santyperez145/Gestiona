-- Simulacro de 20261105000200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una plantilla https se guarda.
--   2. Un javascript: se rechaza.
--   3. Vacío (NULL) se guarda.
DO $$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_ok text := '';
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ Seguimiento', 'zz-seg-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;

  -- 1
  INSERT INTO public.carriers (org_id, name, code, tracking_url)
  VALUES (v_org, 'Correo', 'correo', 'https://correo.example/seguir?n={tracking_number}');
  v_ok := v_ok || '1 ';

  -- 2
  BEGIN
    INSERT INTO public.carriers (org_id, name, code, tracking_url)
    VALUES (v_org, 'Malo', 'malo', 'javascript:alert(document.cookie)');
    RAISE EXCEPTION 'FALLA 2: se guardó un javascript:';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok || '2 ';
  END;

  -- 3
  INSERT INTO public.carriers (org_id, name, code, tracking_url) VALUES (v_org, 'Propio', 'propio', NULL);
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
