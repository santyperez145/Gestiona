-- Simulacro de 20261022000700 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El CBU se valida con sus dígitos verificadores; uno válido se guarda.
--   2. FCE a una empresa con CUIT y vencimiento: tipo 201 con el CBU del comercio.
--   3. FCE sin vencimiento o a consumidor final: no.
--   4. La nota de crédito de una FCE es FCE (203).
--   5. El vendedor no cambia el CBU; nadie lee los tickets de WSAA desde el navegador.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; r jsonb; v_inv uuid; v_nc uuid; i public.invoices%ROWTYPE; n int; v_ok text := '';
  v_venc text := to_char(current_date + 30, 'YYYY-MM-DD');
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ FCE', 'zz-fce-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL', 'Av. ZZ 123, CABA')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  BEGIN
    PERFORM public.configurar_fce(v_org, '0110599520000001234567', NULL, 'SCA');
    RAISE EXCEPTION 'FALLA 1a: aceptó un CBU inválido';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.configurar_fce(v_org, '0170099220000067797370', 'zz.cuenta', 'adc');
  IF r->>'cbu' <> '0170099220000067797370' OR r->>'transferencia' <> 'ADC' OR public.datos_fce(v_org)->>'alias' <> 'zz.cuenta' THEN
    RAISE EXCEPTION 'FALLA 1b: %', r;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.crear_factura_manual(v_org,
    jsonb_build_object('name', 'ZZ Gran Empresa SA', 'tax_id', '30712345671', 'due_date', v_venc),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 1000000, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto', 'tax_pct', 21, 'fce', true));
  v_inv := (r->>'invoice_id')::uuid;
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.tipo_comprobante <> 201 OR i.fce_cbu <> '0170099220000067797370' OR i.fce_transferencia <> 'ADC' OR i.fce_alias <> 'zz.cuenta' THEN
    RAISE EXCEPTION 'FALLA 2: %', to_jsonb(i);
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ', 'tax_id', '30712345671'),
      jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 10, 'tax_rate', 21)),
      jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto', 'fce', true));
    RAISE EXCEPTION 'FALLA 3a: FCE sin vencimiento';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ', 'due_date', v_venc),
      jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 10, 'tax_rate', 21)),
      jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final', 'fce', true));
    RAISE EXCEPTION 'FALLA 3b: FCE a consumidor final';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  v_ok := v_ok || '3 ';

  -- 4
  RESET ROLE;
  UPDATE public.invoices SET afip_status = 'processing' WHERE id = v_inv;
  UPDATE public.invoices SET cae = '71234567890125', afip_status = 'authorized', numero_afip = 1 WHERE id = v_inv;
  SET LOCAL ROLE authenticated;
  v_nc := public.emitir_nota_credito(v_inv, 'ZZ rechazada por el comprador', NULL);
  IF (SELECT tipo_comprobante FROM public.invoices WHERE id = v_nc) <> 203 THEN RAISE EXCEPTION 'FALLA 4: la nota de la FCE no es 203'; END IF;
  v_ok := v_ok || '4 ';

  -- 5
  BEGIN
    SELECT count(*) INTO n FROM public.afip_ta_por_servicio;
    RAISE EXCEPTION 'FALLA 5a: authenticated lee los tickets de WSAA';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.configurar_fce(v_org, '2850590940090418135201', NULL, 'SCA');
    RAISE EXCEPTION 'FALLA 5b: el vendedor cambió el CBU';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
