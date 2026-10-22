-- Simulacro de 20261022001100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El dueño configura un punto de venta de exportación distinto del de CAE.
--   2. Una factura con datos de exportación nace tipo 19, cliente del exterior,
--      todo exento; sin Incoterm en bienes no se crea.
--   3. Al autorizarse toma el punto de venta de exportación y no informa
--      documento argentino; el Id del pedido sólo lo asigna el servidor.
--   4. Autorizada, su nota de crédito es 21 y la de débito 20, exenta.
--   5. El vendedor no configura y el navegador no escribe parámetros ni el Id.
--   6. Un rechazo explícito libera el número candidato y el Id del pedido.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; r jsonb; v_inv uuid; v_rech uuid; v_nc uuid; v_nd uuid; i public.invoices%ROWTYPE; v_ok text := '';
  expo jsonb := jsonb_build_object('tipo_expo', 1, 'pais_destino', 220, 'domicilio_cliente', 'ZZ Avenida 1, Asuncion',
    'id_impositivo', 'ZZ-99', 'idioma', 2, 'forma_pago', 'Transferencia', 'incoterms', 'fob', 'permiso_existente', 'N');
  items jsonb := jsonb_build_array(jsonb_build_object('description', 'ZZ Vino', 'quantity', 100, 'unit_price', 12.5, 'tax_rate', 21));
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Exportadora', 'zz-expo-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL', 'ZZ Calle 1')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto', domicilio = 'ZZ Calle 1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  BEGIN
    PERFORM public.configurar_exportacion(v_org, 3);
    RAISE EXCEPTION 'FALLA 1a: aceptó el mismo punto de venta que CAE';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.configurar_exportacion(v_org, 5);
  IF (r->>'punto_venta_exportacion')::int <> 5 THEN RAISE EXCEPTION 'FALLA 1b: %', r; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ Importadora SA'), items,
    jsonb_build_object('enabled', true, 'moneda', 'USD', 'cotizacion', 1015.5, 'exportacion', expo));
  v_inv := (r->>'invoice_id')::uuid;
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.tipo_comprobante <> 19 OR i.condicion_iva_receptor <> 9 OR i.tax_amount <> 0 OR i.subtotal <> 0
     OR i.importe_exento <> 1250 OR i.total <> 1250 OR i.exportacion->>'incoterms' <> 'FOB' OR i.customer_tax_id <> 'ZZ-99'
     OR i.customer_address <> 'ZZ Avenida 1, Asuncion' THEN
    RAISE EXCEPTION 'FALLA 2a: %', to_jsonb(i);
  END IF;
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'), items,
      jsonb_build_object('enabled', true, 'exportacion', expo - 'incoterms'));
    RAISE EXCEPTION 'FALLA 2b: creó una exportación de bienes sin Incoterm';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    UPDATE public.invoices SET fex_request_id = 123 WHERE id = v_inv;
    RAISE EXCEPTION 'FALLA 3a: el navegador escribió el Id del pedido';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  IF public.afip_fex_asignar_id(v_inv, 17612345678901) <> 17612345678901 OR public.afip_fex_asignar_id(v_inv, 999) <> 17612345678901 THEN
    RAISE EXCEPTION 'FALLA 3b: el Id cambió';
  END IF;
  r := public.afip_autorizacion_reservar(v_inv, v_user, 5, 19, 'homologacion');
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.punto_venta <> 5 OR i.receptor_tipo_documento <> 99 OR i.afip_status <> 'processing' THEN
    RAISE EXCEPTION 'FALLA 3c: %', to_jsonb(i);
  END IF;
  r := public.afip_autorizacion_resultado(v_inv, 'authorized', '76123456789012', CURRENT_DATE + 10, 1, 'homologacion', NULL);
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.cae <> '76123456789012' OR i.arca_qr_payload->>'tipoCmp' <> '19' OR i.arca_qr_payload ? 'nroDocRec' THEN
    RAISE EXCEPTION 'FALLA 3d: %', to_jsonb(i);
  END IF;
  RESET ROLE;
  v_ok := v_ok || '3 ';

  -- 4
  SET LOCAL ROLE authenticated;
  v_nc := public.emitir_nota_credito(v_inv, 'ZZ devolución', 100);
  v_nd := public.emitir_nota_debito(v_inv, 'ZZ flete', 50, NULL);
  IF (SELECT tipo_comprobante FROM public.invoices WHERE id = v_nc) <> 21 THEN RAISE EXCEPTION 'FALLA 4a'; END IF;
  SELECT * INTO i FROM public.invoices WHERE id = v_nd;
  IF i.tipo_comprobante <> 20 OR i.importe_exento <> 50 OR i.tax_amount <> 0 OR i.total <> 50 THEN RAISE EXCEPTION 'FALLA 4b: %', to_jsonb(i); END IF;
  BEGIN
    UPDATE public.invoices SET exportacion = expo WHERE id = v_inv;
    RAISE EXCEPTION 'FALLA 4c: cambió la exportación de una factura autorizada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  v_ok := v_ok || '4 ';

  -- 5
  BEGIN
    INSERT INTO public.arca_parametros_fex (environment, tipo, datos) VALUES ('homologacion', 'paises', '[]');
    RAISE EXCEPTION 'FALLA 5a: el navegador escribió parámetros';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.afip_fex_asignar_id(v_inv, 1);
    RAISE EXCEPTION 'FALLA 5b: el navegador asignó el Id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.configurar_exportacion(v_org, 7);
    RAISE EXCEPTION 'FALLA 5c: el vendedor configuró la exportación';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5 ';

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_rech := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ Importadora SA'), items,
    jsonb_build_object('enabled', true, 'exportacion', expo))->>'invoice_id')::uuid;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM public.afip_fex_asignar_id(v_rech, 17612345678902);
  PERFORM public.afip_autorizacion_reservar(v_rech, v_user, 5, 19, 'homologacion');
  PERFORM public.afip_autorizacion_candidato(v_rech, 2);
  PERFORM public.afip_autorizacion_resultado(v_rech, 'rejected', NULL, NULL, 2, 'homologacion', 'ZZ rechazo');
  SELECT * INTO i FROM public.invoices WHERE id = v_rech;
  IF i.afip_status <> 'rejected' OR i.afip_candidate_number IS NOT NULL OR i.fex_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'FALLA 6: %', to_jsonb(i);
  END IF;
  RESET ROLE;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
