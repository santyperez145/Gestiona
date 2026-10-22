-- Simulacro de 20261022000900 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El dueño habilita la contingencia con un punto de venta CAEA distinto.
--   2. Con un CAEA vigente, una factura sale autorizada con «A», en el punto
--      CAEA, número 1, con el QR de tipo «A»; la siguiente es la 2.
--   3. Con un pedido de CAE sin confirmar, no se emite en contingencia.
--   4. Informada, queda con fecha; rechazada, guarda el motivo.
--   5. El navegador no puede emitir en contingencia ni escribir CAEA; el
--      vendedor no configura.
--   6. Una Factura de Crédito MiPyME no se emite en contingencia; el cron
--      quedó programado.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; r jsonb; v_inv uuid; v_inv2 uuid; v_inv3 uuid; i public.invoices%ROWTYPE; v_ok text := '';
  f jsonb := jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final', 'tax_pct', 21);
  items jsonb := jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21));
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ CAEA', 'zz-caea-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL', 'ZZ Calle 1')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto', domicilio = 'ZZ Calle 1';
  INSERT INTO public.afip_caea (org_id, environment, periodo, orden, caea, vig_desde, vig_hasta, tope_informe)
  VALUES (v_org, 'homologacion', 202610, 2, '31234567890123', current_date - 3, current_date + 10, current_date + 18);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  BEGIN
    PERFORM public.configurar_contingencia(v_org, true, 3);
    RAISE EXCEPTION 'FALLA 1a: aceptó el mismo punto de venta que CAE';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.configurar_contingencia(v_org, true, 9);
  IF NOT (r->>'habilitada')::boolean OR (r->>'punto_venta_caea')::int <> 9 OR r->'caea_vigente'->>'caea' <> '31234567890123' THEN
    RAISE EXCEPTION 'FALLA 1b: %', r;
  END IF;
  v_inv := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'), items, f)->>'invoice_id')::uuid;
  v_inv2 := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'), items, f)->>'invoice_id')::uuid;
  v_inv3 := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ'), items, f)->>'invoice_id')::uuid;
  v_ok := v_ok || '1 ';

  -- 2 (lo llama el servidor)
  RESET ROLE;
  SET LOCAL ROLE service_role;
  r := public.afip_caea_emitir(v_inv, v_user);
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.codigo_autorizacion_tipo <> 'A' OR i.cae <> '31234567890123' OR i.punto_venta <> 9 OR i.numero_afip <> 1
     OR i.afip_status <> 'authorized' OR i.arca_qr_payload->>'tipoCodAut' <> 'A' OR i.caea_informado_at IS NOT NULL THEN
    RAISE EXCEPTION 'FALLA 2a: %', to_jsonb(i);
  END IF;
  r := public.afip_caea_emitir(v_inv2, v_user);
  IF (r->>'numero_afip')::int <> 2 THEN RAISE EXCEPTION 'FALLA 2b: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  RESET ROLE;
  UPDATE public.invoices SET afip_candidate_number = 7, afip_candidate_set_at = now() WHERE id = v_inv3;
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.afip_caea_emitir(v_inv3, v_user);
    RAISE EXCEPTION 'FALLA 3: emitió con un CAE sin confirmar';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM public.afip_caea_informado(v_inv, true, NULL);
  PERFORM public.afip_caea_informado(v_inv2, false, '10015: Documento invalido');
  IF (SELECT caea_informado_at FROM public.invoices WHERE id = v_inv) IS NULL
     OR (SELECT caea_informe_error FROM public.invoices WHERE id = v_inv2) <> '10015: Documento invalido' THEN
    RAISE EXCEPTION 'FALLA 4';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.afip_caea_emitir(v_inv3, v_user);
    RAISE EXCEPTION 'FALLA 5a: el navegador emitió en contingencia';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.afip_caea (org_id, environment, periodo, orden, caea, vig_desde, vig_hasta, tope_informe)
    VALUES (v_org, 'homologacion', 202611, 1, '31234567890124', current_date, current_date, current_date);
    RAISE EXCEPTION 'FALLA 5b: el navegador escribió un CAEA';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.configurar_contingencia(v_org, false, NULL);
    RAISE EXCEPTION 'FALLA 5c: el vendedor configuró la contingencia';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5 ';

  -- 6 (si la validación de FCE frena el cambio de tipo, también vale: no se emitió)
  BEGIN
    UPDATE public.invoices SET tipo_comprobante = 201, afip_candidate_number = NULL, afip_candidate_set_at = NULL WHERE id = v_inv3;
    SET LOCAL ROLE service_role;
    PERFORM public.afip_caea_emitir(v_inv3, v_user);
    RAISE EXCEPTION 'FALLA 6a: emitió una FCE en contingencia';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF; END;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arca-caea-ciclo' AND command LIKE '%arca-caea%') THEN
    RAISE EXCEPTION 'FALLA 6b: no quedó programado el cron';
  END IF;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
