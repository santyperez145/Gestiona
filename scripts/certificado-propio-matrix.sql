-- Simulacro de 20261022000100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con dueño.
--   1. Ya no hay constraint: se guarda un certificado en la fila del comercio.
--   2. La base lo cifra aunque llegue en claro (certificado, clave y pedido).
--   3. Sin certificado, el motivo es falta_certificado_propio y pedido_pendiente
--      refleja el pedido.
--   4. Certificado vencido → certificado_vencido; rechazado → certificado_rechazado.
--   5. Certificado aceptado sin verificar la conexión → falta_verificar; con la
--      conexión verificada → listo y configured.
--   6. Cambiar el certificado invalida la verificación anterior.
--   7. La vista no expone PEM ni clave a un miembro; sí el CSR y la vigencia.
--   8. Un comercio nuevo nace en modo propio.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_org2 uuid; r record; n int; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cert propio', 'zz-cp-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, modo)
  VALUES (v_org, '20123456786', 3, 'produccion', 'monotributo', 'ZZ SRL', 'propio')
  ON CONFLICT (org_id) DO UPDATE SET cuit = EXCLUDED.cuit, modo = 'propio';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- 3
  UPDATE public.afip_credentials SET pedido_clave = 'ZZ-CLAVE-EN-CLARO', pedido_csr = '-----BEGIN CERTIFICATE REQUEST-----zz', pedido_ambiente = 'produccion', pedido_creado_at = now() WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  SELECT motivo, pedido_pendiente, pedido_csr INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.motivo <> 'falta_certificado_propio' OR NOT r.pedido_pendiente OR r.pedido_csr NOT LIKE '%CERTIFICATE REQUEST%' THEN RAISE EXCEPTION 'FALLA 3: %', row_to_json(r); END IF;
  v_ok := v_ok || '3 ';

  -- 1 y 2
  UPDATE public.afip_credentials
     SET certificate = '-----BEGIN CERTIFICATE-----ZZ', private_key = '-----BEGIN PRIVATE KEY-----ZZ',
         certificate_expires_at = now() + interval '700 days', certificado_verificado_ok = true
   WHERE org_id = v_org;
  SELECT certificate, private_key, pedido_clave INTO r FROM public.afip_credentials WHERE org_id = v_org;
  IF r.certificate NOT LIKE 'nerqia:v1:%' OR r.private_key NOT LIKE 'nerqia:v1:%' OR r.pedido_clave NOT LIKE 'nerqia:v1:%' THEN
    RAISE EXCEPTION 'FALLA 2: quedó algo en claro'; END IF;
  v_ok := v_ok || '1 2 ';

  -- 5
  SET LOCAL ROLE authenticated;
  SELECT motivo, configured INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.motivo <> 'falta_verificar' THEN RAISE EXCEPTION 'FALLA 5a: %', row_to_json(r); END IF;
  UPDATE public.afip_credentials SET delegacion_verificada = true, delegacion_verificada_at = now() WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  SELECT motivo, configured INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.motivo <> 'listo' OR NOT r.configured THEN RAISE EXCEPTION 'FALLA 5b: %', row_to_json(r); END IF;
  v_ok := v_ok || '5 ';

  -- 4
  UPDATE public.afip_credentials SET certificado_verificado_ok = false, certificado_verificado_motivo = 'zz' WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  SELECT motivo, configured INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.motivo <> 'certificado_rechazado' OR r.configured THEN RAISE EXCEPTION 'FALLA 4a: %', row_to_json(r); END IF;
  UPDATE public.afip_credentials SET certificate_expires_at = now() - interval '1 day' WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  SELECT motivo INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.motivo <> 'certificado_vencido' THEN RAISE EXCEPTION 'FALLA 4b: %', row_to_json(r); END IF;
  v_ok := v_ok || '4 ';

  -- 6
  UPDATE public.afip_credentials SET certificate_expires_at = now() + interval '700 days', certificado_verificado_ok = true WHERE org_id = v_org;
  UPDATE public.afip_credentials SET certificate = '-----BEGIN CERTIFICATE-----ZZ2' WHERE org_id = v_org;
  SELECT delegacion_verificada INTO r FROM public.afip_credentials WHERE org_id = v_org;
  IF r.delegacion_verificada THEN RAISE EXCEPTION 'FALLA 6: el certificado nuevo heredó la verificación'; END IF;
  v_ok := v_ok || '6 ';

  -- 7
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM certificate FROM public.afip_credentials WHERE org_id = v_org;
    SELECT count(*) INTO n FROM public.afip_credentials WHERE org_id = v_org;
    IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FALLA 7: un miembro lee afip_credentials'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT certificado_vence INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.certificado_vence IS NULL THEN RAISE EXCEPTION 'FALLA 7b: no se ve la vigencia'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'afip_connection_status'
             AND column_name IN ('certificate', 'private_key', 'pedido_clave', 'ta_token', 'ta_sign')) THEN
    RAISE EXCEPTION 'FALLA 7c: la vista expone un secreto'; END IF;
  v_ok := v_ok || '7 ';

  -- 8
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ nuevo', 'zz-cp2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.afip_credentials (org_id, cuit) VALUES (v_org2, '20123456786') ON CONFLICT (org_id) DO NOTHING;
  IF (SELECT modo FROM public.afip_credentials WHERE org_id = v_org2) <> 'propio' THEN RAISE EXCEPTION 'FALLA 8'; END IF;
  v_ok := v_ok || '8';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
