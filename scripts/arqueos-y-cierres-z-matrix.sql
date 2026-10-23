-- Simulacro de 20261023000700 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Arqueo parcial: billetes que suman lo declarado, tarjeta y QR contra el
--      sistema; una diferencia exige motivo; billetes que no suman o que no
--      existen se rechazan; un arqueo no se edita; sólo lectura no arquea.
--   2. Arqueo de cierre: cierra el turno por el camino de siempre.
--   3. Cierre Z del controlador: borrador con controles, confirmado inmutable;
--      lo inconsistente no se confirma; avisos de Z faltantes y de numeración.
--   4. Cierre diario electrónico: sólo si coincide con lo autorizado por ARCA
--      ese día (homologación no cuenta), numerado, uno por día.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_ses uuid; v_ses2 uuid; v_esp numeric; r jsonb; v_z uuid; v_ok text := '';
  v_a uuid; v_b1 uuid; v_b2 uuid; v_h uuid; v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_comp jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Arqueos', 'zz-arq-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 3, 'produccion', 'responsable_inscripto', 'ZZ SRL', 'Av. ZZ 123, CABA')
  ON CONFLICT (org_id) DO UPDATE SET environment = 'produccion', punto_venta = 3, domicilio = 'Av. ZZ 123, CABA';

  INSERT INTO public.cash_sessions (org_id, opened_by, opening_amount, status) VALUES (v_org, v_owner, 1000, 'open') RETURNING id INTO v_ses;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, description, created_by) VALUES
    (v_org, v_ses, 'sale_in', 'efectivo', 5000, 'ZZ venta', v_owner),
    (v_org, v_ses, 'sale_in', 'debito', 3000, 'ZZ venta', v_owner),
    (v_org, v_ses, 'sale_in', 'qr', 2000, 'ZZ venta', v_owner),
    (v_org, v_ses, 'refund_out', 'efectivo', 500, 'ZZ devolución', v_owner);
  v_esp := public.cash_session_expected_cash(v_ses);

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.registrar_arqueo(v_ses, 'parcial', v_esp, jsonb_build_object('monedas', v_esp), jsonb_build_object('debito', 3000, 'qr', 2000));
  IF (r->>'diferencia')::numeric <> 0 OR NOT (r->'otros_medios' @> '[{"medio": "debito", "sistema": 3000, "declarado": 3000}]'::jsonb) THEN
    RAISE EXCEPTION 'FALLA 1a: %', r;
  END IF;
  BEGIN
    PERFORM public.registrar_arqueo(v_ses, 'parcial', v_esp, jsonb_build_object('1000', 1), '{}'::jsonb);
    RAISE EXCEPTION 'FALLA 1b: aceptó billetes que no suman';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.registrar_arqueo(v_ses, 'parcial', 300, jsonb_build_object('300', 1), '{}'::jsonb);
    RAISE EXCEPTION 'FALLA 1c: aceptó un billete que no existe';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.registrar_arqueo(v_ses, 'parcial', v_esp, '{}'::jsonb, jsonb_build_object('debito', 2900));
    RAISE EXCEPTION 'FALLA 1d: una diferencia de tarjeta pasó sin motivo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  r := public.registrar_arqueo(v_ses, 'parcial', v_esp, '{}'::jsonb, jsonb_build_object('debito', 2900), 'Falta un cupón de $100 del posnet');
  RESET ROLE;
  BEGIN
    UPDATE public.arqueos_caja SET motivo = 'otro' WHERE id = (r->>'id')::uuid;
    RAISE EXCEPTION 'FALLA 1e: se pudo editar un arqueo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.registrar_arqueo(v_ses, 'parcial', v_esp);
    RAISE EXCEPTION 'FALLA 1f: un usuario de sólo lectura arqueó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.registrar_arqueo(v_ses, 'cierre', v_esp - 50, '{}'::jsonb, '{}'::jsonb, 'Faltan $50 de cambio');
  RESET ROLE;
  IF (SELECT status FROM public.cash_sessions WHERE id = v_ses) <> 'closed' OR (SELECT difference FROM public.cash_sessions WHERE id = v_ses) <> -50 THEN
    RAISE EXCEPTION 'FALLA 2: el arqueo de cierre no cerró el turno: %', r;
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  v_comp := '[{"tipo": 82, "desde": 101, "hasta": 110, "cantidad": 10, "cancelados": 0, "total": 12100, "alicuotas": [{"tasa": 21, "neto": 10000, "iva": 2100}]},
              {"tipo": 113, "desde": 5, "hasta": 5, "cantidad": 1, "total": 1210, "alicuotas": [{"tasa": 21, "neto": 1000, "iva": 210}]}]'::jsonb;
  SET LOCAL ROLE authenticated;
  r := public.registrar_cierre_z(v_org, 'controlador', 2, 41, v_hoy, '{"marca": "Epson", "modelo": "TM-T900FA", "registro": "EPSZZ0000001"}'::jsonb, v_comp, false);
  IF r->>'estado' <> 'borrador' OR (r->>'total')::numeric <> 10890 OR (r->>'iva')::numeric <> 1890 THEN RAISE EXCEPTION 'FALLA 3a: %', r; END IF;
  v_z := (r->>'id')::uuid;
  r := public.confirmar_cierre_z(v_z);
  IF r->>'estado' <> 'confirmado' THEN RAISE EXCEPTION 'FALLA 3b: %', r; END IF;
  BEGIN
    PERFORM public.registrar_cierre_z(v_org, 'controlador', 2, 41, v_hoy, '{}'::jsonb, v_comp, true);
    RAISE EXCEPTION 'FALLA 3c: se pisó un Z confirmado';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.descartar_cierre_z(v_z);
    RAISE EXCEPTION 'FALLA 3d: se borró un Z confirmado';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.registrar_cierre_z(v_org, 'manual', 2, 42, v_hoy, '{}'::jsonb,
      '[{"tipo": 82, "desde": 111, "hasta": 111, "cantidad": 1, "total": 12100, "alicuotas": [{"tasa": 21, "neto": 9000, "iva": 2100}]}]'::jsonb, true);
    RAISE EXCEPTION 'FALLA 3e: confirmó un Z que no cierra';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.registrar_cierre_z(v_org, 'manual', 2, 42, v_hoy, '{}'::jsonb,
      '[{"tipo": 6, "desde": 1, "hasta": 1, "cantidad": 1, "total": 121, "alicuotas": []}]'::jsonb, false);
    RAISE EXCEPTION 'FALLA 3f: aceptó una factura electrónica en un Z de controlador';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.registrar_cierre_z(v_org, 'manual', 2, 44, v_hoy, '{}'::jsonb,
    '[{"tipo": 82, "desde": 120, "hasta": 120, "cantidad": 1, "total": 121, "alicuotas": [{"tasa": 21, "neto": 100, "iva": 21}]}]'::jsonb, false);
  IF NOT (r->'observaciones' @> '[{"nivel": "aviso"}]'::jsonb) OR (r->>'observaciones') NOT LIKE '%Falta cargar del Z 42 al 43%' THEN RAISE EXCEPTION 'FALLA 3g: %', r; END IF;
  r := public.registrar_cierre_z(v_org, 'manual', 2, 42, v_hoy, '{}'::jsonb,
    '[{"tipo": 82, "desde": 115, "hasta": 115, "cantidad": 1, "total": 121, "alicuotas": [{"tasa": 21, "neto": 100, "iva": 21}]}]'::jsonb, true);
  IF (r->>'observaciones') NOT LIKE '%terminó en 110 y éste empieza en 115%' OR r->>'estado' <> 'confirmado' THEN RAISE EXCEPTION 'FALLA 3h: %', r; END IF;
  RESET ROLE;
  v_ok := v_ok || '3 ';

  -- 4: dos B y una A autorizadas hoy en el punto de venta 3, más una de homologación
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_b1 := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ CF'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'))->>'invoice_id')::uuid;
  v_b2 := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ CF'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 2, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'))->>'invoice_id')::uuid;
  v_a := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ RI', 'tax_id', '30712345671'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 10, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'responsable_inscripto'))->>'invoice_id')::uuid;
  v_h := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ CF'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'))->>'invoice_id')::uuid;
  RESET ROLE;
  UPDATE public.invoices SET afip_status = 'processing' WHERE id IN (v_b1, v_b2, v_a, v_h);
  UPDATE public.invoices SET cae = '71234567890001', afip_status = 'authorized', numero_afip = 1 WHERE id = v_b1;
  UPDATE public.invoices SET cae = '71234567890002', afip_status = 'authorized', numero_afip = 2 WHERE id = v_b2;
  UPDATE public.invoices SET cae = '71234567890003', afip_status = 'authorized', numero_afip = 7 WHERE id = v_a;
  UPDATE public.invoices SET cae = '71234567890004', afip_status = 'authorized', numero_afip = 3, afip_environment = 'homologacion' WHERE id = v_h;
  IF (SELECT tipo_comprobante FROM public.invoices WHERE id = v_b1) <> 6 OR (SELECT tipo_comprobante FROM public.invoices WHERE id = v_a) <> 1 THEN
    RAISE EXCEPTION 'FALLA 4a: tipos inesperados % %', (SELECT tipo_comprobante FROM public.invoices WHERE id = v_b1), (SELECT tipo_comprobante FROM public.invoices WHERE id = v_a);
  END IF;
  v_comp := jsonb_build_array(
    jsonb_build_object('tipo', 6, 'desde', 1, 'hasta', 2, 'cantidad', 2, 'total', 363, 'alicuotas', jsonb_build_array(jsonb_build_object('tasa', 21, 'neto', 300, 'iva', 63))),
    jsonb_build_object('tipo', 1, 'desde', 7, 'hasta', 7, 'cantidad', 1, 'total', 1210, 'alicuotas', jsonb_build_array(jsonb_build_object('tasa', 21, 'neto', 1000, 'iva', 210))));
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cerrar_dia_electronico(v_org, 3, v_hoy, jsonb_set(v_comp, '{0,cantidad}', '1'));
    RAISE EXCEPTION 'FALLA 4b: cerró un día que no coincide con ARCA';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.cerrar_dia_electronico(v_org, 3, v_hoy, jsonb_build_array(v_comp->0));
    RAISE EXCEPTION 'FALLA 4c: cerró un día sin la factura A';
  EXCEPTION WHEN check_violation THEN NULL; END;
  r := public.cerrar_dia_electronico(v_org, 3, v_hoy, v_comp);
  IF (r->>'numero')::int <> 1 OR (r->>'total')::numeric <> 1573 OR (r->>'iva')::numeric <> 273 THEN RAISE EXCEPTION 'FALLA 4d: %', r; END IF;
  BEGIN
    PERFORM public.cerrar_dia_electronico(v_org, 3, v_hoy, v_comp);
    RAISE EXCEPTION 'FALLA 4e: cerró dos veces el mismo día';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
