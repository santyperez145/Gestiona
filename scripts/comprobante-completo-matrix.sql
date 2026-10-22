-- Simulacro de 20261022000600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Factura A de servicios con gravado, exento, no gravado y una percepción:
--      el total suma todo y cada parte queda en su columna.
--   2. Servicios sin período, tributo inexistente y exento en un C: no entran.
--   3. En dólares, con cotización y cancelación en la misma moneda.
--   4. Autorizada, no se puede cambiar el exento ni los tributos.
--   5. La nota de crédito total acredita todo (exento, no gravado, percepción)
--      y copia concepto y período; una segunda ya no tiene saldo.
--   6. Una nota parcial prorratea y cierra con su total.
--   7. Con el concepto del comercio en «servicios», una factura sin concepto
--      sale de servicios con el período del día; un vendedor no lo cambia.
DO $$
DECLARE
  v_user uuid; v_org uuid; r jsonb; v_inv uuid; v_inv3 uuid; v_nc uuid; i public.invoices%ROWTYPE; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ factura completa', 'zz-fc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.crear_factura_manual(v_org,
    jsonb_build_object('name', 'ZZ Cliente SA', 'tax_id', '30712345671'),
    jsonb_build_array(
      jsonb_build_object('description', 'ZZ Servicio', 'quantity', 1, 'unit_price', 1000, 'tax_rate', 21),
      jsonb_build_object('description', 'ZZ Libro', 'quantity', 1, 'unit_price', 300, 'tratamiento', 'exento'),
      jsonb_build_object('description', 'ZZ Tasa', 'quantity', 1, 'unit_price', 50, 'tratamiento', 'no_gravado')),
    jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto', 'tax_pct', 21,
      'concepto', 2, 'servicio_desde', '2026-10-01', 'servicio_hasta', '2026-10-31',
      'tributos', jsonb_build_array(jsonb_build_object('tipo', 7, 'descripcion', 'ZZ Percepción IIBB', 'base', 1000, 'alicuota', 3))));
  v_inv := (r->>'invoice_id')::uuid;
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.tipo_comprobante <> 1 OR i.total <> 1590 OR i.subtotal <> 1000 OR i.tax_amount <> 210 OR i.importe_exento <> 300
     OR i.importe_no_gravado <> 50 OR i.importe_tributos <> 30 OR i.concepto <> 2 OR i.servicio_hasta <> DATE '2026-10-31'
     OR (i.tributos->0->>'importe')::numeric <> 30 THEN
    RAISE EXCEPTION 'FALLA 1: %', to_jsonb(i);
  END IF;
  IF (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_inv AND tratamiento = 'exento') <> 1 THEN RAISE EXCEPTION 'FALLA 1b: renglón exento'; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'),
      jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 10)),
      jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final', 'tax_pct', 21, 'concepto', 2));
    RAISE EXCEPTION 'FALLA 2a: servicio sin período';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'),
      jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 10)),
      jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final', 'tax_pct', 21,
        'tributos', jsonb_build_array(jsonb_build_object('tipo', 42, 'base', 10, 'alicuota', 1))));
    RAISE EXCEPTION 'FALLA 2b: tributo inexistente';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  RESET ROLE;
  UPDATE public.afip_credentials SET tipo_emisor = 'monotributo' WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'),
      jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 10, 'tratamiento', 'exento')),
      jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'));
    RAISE EXCEPTION 'FALLA 2c: exento en un C';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  RESET ROLE;
  UPDATE public.afip_credentials SET tipo_emisor = 'responsable_inscripto' WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  v_ok := v_ok || '2 ';

  -- 3
  r := public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ Export', 'tax_id', '30712345671'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 2, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto', 'moneda', 'USD', 'cotizacion', 1050.5, 'cancela_misma_moneda', true));
  SELECT * INTO i FROM public.invoices WHERE id = (r->>'invoice_id')::uuid;
  IF i.currency <> 'USD' OR i.moneda_cotizacion <> 1050.5 OR NOT i.cancela_misma_moneda OR i.total <> 242 THEN RAISE EXCEPTION 'FALLA 3: %', to_jsonb(i); END IF;
  v_ok := v_ok || '3 ';

  -- 4: se simula la autorización (lo hace afip-authorize con service_role)
  RESET ROLE;
  UPDATE public.invoices SET cae = '71234567890123', afip_status = 'authorized', numero_afip = 1, punto_venta = 3 WHERE id = v_inv;
  BEGIN
    UPDATE public.invoices SET importe_exento = 0, total = 1290 WHERE id = v_inv;
    RAISE EXCEPTION 'FALLA 4: se cambió una factura autorizada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.invoices SET tributos = '[]'::jsonb WHERE id = v_inv;
    RAISE EXCEPTION 'FALLA 4b: se cambiaron los tributos de una factura autorizada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_ok := v_ok || '4 ';

  -- 5
  SET LOCAL ROLE authenticated;
  v_nc := public.emitir_nota_credito(v_inv, 'ZZ anulación total', NULL);
  SELECT * INTO i FROM public.invoices WHERE id = v_nc;
  IF i.tipo_comprobante <> 3 OR i.total <> 1590 OR i.subtotal <> 1000 OR i.tax_amount <> 210 OR i.importe_exento <> 300
     OR i.importe_no_gravado <> 50 OR i.importe_tributos <> 30 OR i.concepto <> 2 OR i.servicio_desde <> DATE '2026-10-01'
     OR (i.tributos->0->>'tipo')::int <> 7 OR (i.tributos->0->>'base')::numeric <> 1000 THEN
    RAISE EXCEPTION 'FALLA 5: %', to_jsonb(i);
  END IF;
  BEGIN
    PERFORM public.emitir_nota_credito(v_inv, 'ZZ otra', NULL);
    RAISE EXCEPTION 'FALLA 5b: se acreditó dos veces';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  v_ok := v_ok || '5 ';

  -- 6
  r := public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ Parcial', 'tax_id', '30712345671'),
    jsonb_build_array(
      jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 1000, 'tax_rate', 21),
      jsonb_build_object('description', 'ZZ ex', 'quantity', 1, 'unit_price', 200, 'tratamiento', 'exento')),
    jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto',
      'tributos', jsonb_build_array(jsonb_build_object('tipo', 7, 'base', 1000, 'alicuota', 3))));
  v_inv3 := (r->>'invoice_id')::uuid;
  RESET ROLE;
  UPDATE public.invoices SET cae = '71234567890124', afip_status = 'authorized', numero_afip = 2, punto_venta = 3 WHERE id = v_inv3;
  SET LOCAL ROLE authenticated;
  v_nc := public.emitir_nota_credito(v_inv3, 'ZZ parcial', 715);
  SELECT * INTO i FROM public.invoices WHERE id = v_nc;
  IF i.total <> 715 OR round(i.subtotal + i.tax_amount + i.importe_exento + i.importe_no_gravado + i.importe_tributos, 2) <> 715
     OR i.importe_exento <= 0 OR i.importe_tributos <= 0 THEN
    RAISE EXCEPTION 'FALLA 6: %', to_jsonb(i);
  END IF;
  v_ok := v_ok || '6 ';

  -- 7
  IF public.configurar_concepto_de_facturacion(v_org, 2::smallint) <> 2 OR public.concepto_de_facturacion(v_org) <> 2 THEN
    RAISE EXCEPTION 'FALLA 7a: no se guardó el concepto';
  END IF;
  r := public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ Abono'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ Abono mensual', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final', 'tax_pct', 21));
  SELECT * INTO i FROM public.invoices WHERE id = (r->>'invoice_id')::uuid;
  IF i.concepto <> 2 OR i.servicio_desde <> i.issue_date OR i.servicio_hasta <> i.issue_date THEN RAISE EXCEPTION 'FALLA 7b: %', to_jsonb(i); END IF;
  RESET ROLE;
  INSERT INTO public.memberships (org_id, user_id, role)
  SELECT v_org, id, 'vendedor' FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1 ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.configurar_concepto_de_facturacion(v_org, 1::smallint);
    RAISE EXCEPTION 'FALLA 7c: el vendedor cambió el concepto';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '7';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
