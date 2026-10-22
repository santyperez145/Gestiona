-- Simulacro de 20261022000200 (después de 20261022000100; concatenar sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. El staff ve el certificado de un comercio, con su estado.
--   2. Un usuario que no es staff, aunque sea dueño del comercio, no ve nada.
--   3. Anon no puede leer la vista.
--   4. La vista no tiene columnas de secretos.
DO $$
DECLARE
  v_staff uuid; v_duenio uuid; v_org uuid; r record; n int; v_ok text := '';
BEGIN
  SELECT user_id INTO v_staff FROM public.platform_admins LIMIT 1;
  SELECT id INTO v_duenio FROM auth.users WHERE id NOT IN (SELECT user_id FROM public.platform_admins) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cert staff', 'zz-cs-' || substr(md5(random()::text), 1, 8), v_duenio) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_duenio, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, modo, certificate, private_key, certificate_expires_at, certificado_verificado_ok, delegacion_verificada)
  VALUES (v_org, '20123456786', 3, 'produccion', 'propio', '-----BEGIN CERTIFICATE-----ZZ', '-----BEGIN PRIVATE KEY-----ZZ', now() + interval '10 days', true, true)
  ON CONFLICT (org_id) DO UPDATE SET certificate = EXCLUDED.certificate, private_key = EXCLUDED.private_key,
    certificate_expires_at = EXCLUDED.certificate_expires_at, certificado_verificado_ok = true, delegacion_verificada = true, modo = 'propio';

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT estado, organization_name INTO r FROM public.platform_afip_certificados WHERE org_id = v_org;
  RESET ROLE;
  IF r.estado IS DISTINCT FROM 'por_vencer' THEN RAISE EXCEPTION 'FALLA 1: %', row_to_json(r); END IF;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_duenio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.platform_afip_certificados;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 2: un no-staff ve % filas', n; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  IF has_table_privilege('anon', 'public.platform_afip_certificados', 'SELECT') THEN RAISE EXCEPTION 'FALLA 3: anon lee la vista'; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_afip_certificados'
             AND column_name IN ('certificate', 'private_key', 'pedido_clave', 'pedido_csr', 'ta_token', 'ta_sign')) THEN
    RAISE EXCEPTION 'FALLA 4: expone un secreto'; END IF;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
