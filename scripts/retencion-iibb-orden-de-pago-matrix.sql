-- Simulacro de 20261022001600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Agente de retención ARBA: el proveedor en el padrón retiene con su
--      alícuota, el que no está con la de «sin padrón», el que no tiene CUIT
--      o no llega al mínimo, no.
--   2. La orden de pago con retención automática la recalcula, numera el
--      certificado y la deja en «Retenemos»; la siguiente sigue la numeración.
--   3. Un importe que no es el calculado, dos retenciones automáticas, una
--      base mayor a lo que se paga o un proveedor sin CUIT se rechazan.
--   4. La retención cargada a mano sigue andando con su certificado.
--   5. Un vendedor no configura retenciones y nadie llama al cálculo interno.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; v_a uuid; v_b uuid; v_c uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; r jsonb; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Retenciones', 'zz-ret-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'responsable_inscripto';
  INSERT INTO public.suppliers (org_id, name, cuit) VALUES (v_org, 'ZZ En padrón', '30712345671') RETURNING id INTO v_a;
  INSERT INTO public.suppliers (org_id, name, cuit) VALUES (v_org, 'ZZ Fuera del padrón', '30699999993') RETURNING id INTO v_b;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Sin CUIT') RETURNING id INTO v_c;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_a, 'ZZ En padrón', 'ZZ factura A1', 12100) RETURNING id INTO d1;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_a, 'ZZ En padrón', 'ZZ factura A2', 6050) RETURNING id INTO d2;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_c, 'ZZ Sin CUIT', 'ZZ factura C1', 5000) RETURNING id INTO d3;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_b, 'ZZ Fuera del padrón', 'ZZ factura B1', 3000) RETURNING id INTO d4;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.configurar_retenciones(v_org, true, 'ARBA', 3, 1000);
  IF NOT (r->>'iibb_agente')::boolean OR r->>'iibb_padron' <> 'ARBA' THEN RAISE EXCEPTION 'FALLA 1a: %', r; END IF;
  IF public.cargar_padron_iibb_retencion(v_org, 'ARBA', jsonb_build_array(
       jsonb_build_object('cuit', '30712345671', 'alicuota', 2.5, 'vigencia_desde', (current_date - 10)::text, 'vigencia_hasta', (current_date + 20)::text))) <> 1 THEN
    RAISE EXCEPTION 'FALLA 1b: no cargó el padrón';
  END IF;
  r := public.retencion_para_proveedor(v_org, v_a, 10000);
  IF NOT (r->>'aplica')::boolean OR (r->>'importe')::numeric <> 250 OR r->>'origen' <> 'padron' THEN RAISE EXCEPTION 'FALLA 1c: %', r; END IF;
  r := public.retencion_para_proveedor(v_org, v_b, 10000);
  IF NOT (r->>'aplica')::boolean OR (r->>'importe')::numeric <> 300 OR r->>'origen' <> 'sin_padron' THEN RAISE EXCEPTION 'FALLA 1d: %', r; END IF;
  r := public.retencion_para_proveedor(v_org, v_c, 10000);
  IF (r->>'aplica')::boolean OR r->>'motivo' <> 'sin_cuit' THEN RAISE EXCEPTION 'FALLA 1e: %', r; END IF;
  r := public.retencion_para_proveedor(v_org, v_a, 500);
  IF (r->>'aplica')::boolean OR r->>'motivo' <> 'bajo_minimo' THEN RAISE EXCEPTION 'FALLA 1f: %', r; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_a, 'idempotency_key', 'zz-ret-clave-1',
    'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d1, 'importe', 12100)),
    'medios', jsonb_build_array(
      jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 10000, 'importe', 250),
      jsonb_build_object('medio', 'transferencia', 'importe', 11850))));
  IF jsonb_array_length(r->'retenciones') <> 1 OR (r->'retenciones'->0->>'certificado')::int <> 1
     OR (SELECT status FROM public.supplier_debts WHERE id = d1) <> 'paid'
     OR NOT EXISTS (SELECT 1 FROM public.withholding_records WHERE org_id = v_org AND direction = 'applied' AND withholding_type = 'iibb'
                     AND jurisdiccion = 'ARBA' AND certificado_numero = 1 AND amount = 250 AND base_amount = 10000 AND rate_pct = 2.5
                     AND counterpart_cuit = '30712345671' AND reference_id = (r->>'orden_id')::uuid)
     OR NOT EXISTS (SELECT 1 FROM public.orden_de_pago_medios WHERE orden_id = (r->>'orden_id')::uuid AND medio = 'retencion'
                     AND referencia = 'Certificado IIBB ARBA N.º 00000001') THEN
    RAISE EXCEPTION 'FALLA 2a: %', r;
  END IF;
  r := public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_a, 'idempotency_key', 'zz-ret-clave-2',
    'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d2, 'importe', 6050)),
    'medios', jsonb_build_array(
      jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 5000, 'importe', 125),
      jsonb_build_object('medio', 'efectivo', 'importe', 5925))));
  IF (r->'retenciones'->0->>'certificado')::int <> 2 THEN RAISE EXCEPTION 'FALLA 2b: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_b, 'idempotency_key', 'zz-ret-clave-3',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d4, 'importe', 3000)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 3000, 'importe', 50),
                                  jsonb_build_object('medio', 'efectivo', 'importe', 2950))));
    RAISE EXCEPTION 'FALLA 3a: aceptó un importe que no es el calculado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_b, 'idempotency_key', 'zz-ret-clave-4',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d4, 'importe', 3000)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 1500, 'importe', 45),
                                  jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 1500, 'importe', 45),
                                  jsonb_build_object('medio', 'efectivo', 'importe', 2910))));
    RAISE EXCEPTION 'FALLA 3b: aceptó dos retenciones automáticas';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_b, 'idempotency_key', 'zz-ret-clave-5',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d4, 'importe', 3000)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 4000, 'importe', 120),
                                  jsonb_build_object('medio', 'efectivo', 'importe', 2880))));
    RAISE EXCEPTION 'FALLA 3c: base mayor a lo que se paga';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_c, 'idempotency_key', 'zz-ret-clave-6',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d3, 'importe', 5000)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'retencion', 'automatica', true, 'base', 5000, 'importe', 150),
                                  jsonb_build_object('medio', 'efectivo', 'importe', 4850))));
    RAISE EXCEPTION 'FALLA 3d: retuvo a un proveedor sin CUIT';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '3 ';

  -- 4
  r := public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_b, 'idempotency_key', 'zz-ret-clave-7',
    'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d4, 'importe', 3000)),
    'medios', jsonb_build_array(jsonb_build_object('medio', 'retencion', 'importe', 90, 'referencia', 'ZZ-CERT-9'),
                                jsonb_build_object('medio', 'efectivo', 'importe', 2910))));
  IF jsonb_array_length(r->'retenciones') <> 0
     OR NOT EXISTS (SELECT 1 FROM public.orden_de_pago_medios WHERE orden_id = (r->>'orden_id')::uuid AND referencia = 'ZZ-CERT-9') THEN
    RAISE EXCEPTION 'FALLA 4: %', r;
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  BEGIN
    PERFORM public.retencion_iibb_calculada(v_org, '30712345671', 10000, current_date);
    RAISE EXCEPTION 'FALLA 5a: el navegador llamó al cálculo interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.configurar_retenciones(v_org, false, NULL, NULL, 0);
    RAISE EXCEPTION 'FALLA 5b: un vendedor cambió las retenciones';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.cargar_padron_iibb_retencion(v_org, 'ARBA', '[]'::jsonb);
    RAISE EXCEPTION 'FALLA 5c: un vendedor cargó el padrón';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
