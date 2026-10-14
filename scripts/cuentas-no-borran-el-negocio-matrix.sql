-- Simulacro de 20261014002300 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Las ocho tablas de negocio quedan RESTRICT y los ajustes SET NULL.
--   2. Borrar un usuario con un producto se rechaza y el producto sigue.
--   3. Un usuario sin registros del negocio se borra; los ajustes de su
--      negocio quedan (sin autor).
DO $$
DECLARE v_u uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_org uuid; v_owner uuid; v_p uuid;
BEGIN
  IF (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'r'
        AND c.conrelid::regclass::text IN ('customer_communications','deals','debts','marketing_posts','products','purchases','sales','seller_payouts')) <> 8
     OR (SELECT confdeltype FROM pg_constraint WHERE conname = 'settings_user_id_fkey') <> 'n' THEN
    RAISE EXCEPTION 'FALLA 1'; END IF;
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cuentas', 'zz-cu-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-' || v_u || '@example.com');
  INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-' || v_u2 || '@example.com');
  INSERT INTO public.products (org_id, user_id, name) VALUES (v_org, v_u, 'ZZ producto') RETURNING id INTO v_p;
  BEGIN
    DELETE FROM auth.users WHERE id = v_u;
    RAISE EXCEPTION 'FALLA 2: borró la cuenta con productos';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_p) THEN RAISE EXCEPTION 'FALLA 2: se fue el producto'; END IF;
  DELETE FROM auth.users WHERE id = v_u2;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_u2)
     OR NOT EXISTS (SELECT 1 FROM public.settings s JOIN public.organizations o ON o.id = s.org_id WHERE o.owner_user_id = v_u2 AND s.user_id IS NULL) THEN
    RAISE EXCEPTION 'FALLA 3'; END IF;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
