-- Simulacro de 20261022001400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una orden paga dos deudas con efectivo, un cheque de terceros (sale de
--      la cartera como entregado) y un cheque propio (entra a la cartera).
--   2. Repetir la misma clave no paga dos veces.
--   3. Medios que no suman lo imputado, un cheque ya usado o una deuda de otro
--      proveedor se rechazan.
--   4. Un cheque de terceros no se marca entregado sin orden de pago, y el
--      navegador no escribe órdenes.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_prov uuid; v_otro uuid; d1 uuid; d2 uuid; d3 uuid; ch uuid; r jsonb; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Pagos', 'zz-op-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.suppliers (org_id, name, cuit) VALUES (v_org, 'ZZ Distribuidora', '30712345671') RETURNING id INTO v_prov;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Otro') RETURNING id INTO v_otro;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_prov, 'ZZ Distribuidora', 'ZZ factura 1', 1000) RETURNING id INTO d1;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_prov, 'ZZ Distribuidora', 'ZZ factura 2', 2000) RETURNING id INTO d2;
  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars) VALUES (v_org, v_otro, 'ZZ Otro', 'ZZ factura 3', 500) RETURNING id INTO d3;
  INSERT INTO public.cheques (org_id, type, customer_name, bank_name, check_number, amount_ars, due_date) VALUES (v_org, 'received', 'ZZ Cliente', 'ZZ Banco', '111', 800, current_date + 20) RETURNING id INTO ch;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_prov, 'idempotency_key', 'zz-op-clave-1',
    'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d1, 'importe', 1000), jsonb_build_object('deuda_id', d2, 'importe', 1500)),
    'medios', jsonb_build_array(
      jsonb_build_object('medio', 'efectivo', 'importe', 200),
      jsonb_build_object('medio', 'cheque_tercero', 'importe', 800, 'cheque_id', ch),
      jsonb_build_object('medio', 'cheque_propio', 'importe', 1500, 'banco', 'ZZ Banco propio', 'numero', '0001', 'vencimiento', (current_date + 30)::text))));
  IF (r->>'numero')::int <> 1 OR (r->>'total')::numeric <> 2500
     OR (SELECT status FROM public.supplier_debts WHERE id = d1) <> 'paid'
     OR (SELECT paid_ars FROM public.supplier_debts WHERE id = d2) <> 1500
     OR (SELECT status FROM public.cheques WHERE id = ch) <> 'endorsed'
     OR (SELECT entregado_a_supplier_id FROM public.cheques WHERE id = ch) <> v_prov
     OR NOT EXISTS (SELECT 1 FROM public.cheques WHERE org_id = v_org AND type = 'issued' AND check_number = '0001' AND amount_ars = 1500 AND status = 'pending')
     OR (SELECT count(*) FROM public.supplier_payments WHERE orden_de_pago_id = (r->>'orden_id')::uuid) <> 2 THEN
    RAISE EXCEPTION 'FALLA 1: %', r;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_prov, 'idempotency_key', 'zz-op-clave-1',
    'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d2, 'importe', 500)),
    'medios', jsonb_build_array(jsonb_build_object('medio', 'efectivo', 'importe', 500))));
  IF NOT (r->>'idempotente')::boolean OR (SELECT paid_ars FROM public.supplier_debts WHERE id = d2) <> 1500 THEN RAISE EXCEPTION 'FALLA 2: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_prov, 'idempotency_key', 'zz-op-clave-2',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d2, 'importe', 500)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'efectivo', 'importe', 400))));
    RAISE EXCEPTION 'FALLA 3a: medios que no suman';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_prov, 'idempotency_key', 'zz-op-clave-3',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d2, 'importe', 500)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'cheque_tercero', 'importe', 800, 'cheque_id', ch))));
    RAISE EXCEPTION 'FALLA 3b: cheque usado dos veces';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.emitir_orden_de_pago(v_org, jsonb_build_object('supplier_id', v_prov, 'idempotency_key', 'zz-op-clave-4',
      'imputaciones', jsonb_build_array(jsonb_build_object('deuda_id', d3, 'importe', 500)),
      'medios', jsonb_build_array(jsonb_build_object('medio', 'efectivo', 'importe', 500))));
    RAISE EXCEPTION 'FALLA 3c: pagó la deuda de otro proveedor';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '3 ';

  -- 4
  RESET ROLE;
  INSERT INTO public.cheques (org_id, type, customer_name, bank_name, check_number, amount_ars, due_date) VALUES (v_org, 'received', 'ZZ Cliente', 'ZZ Banco', '222', 100, current_date + 20) RETURNING id INTO ch;
  BEGIN
    UPDATE public.cheques SET status = 'endorsed' WHERE id = ch;
    RAISE EXCEPTION 'FALLA 4a: entregó un cheque sin orden de pago';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ordenes_de_pago (org_id, numero, proveedor_nombre, total, idempotency_key) VALUES (v_org, 99, 'ZZ', 1, 'zz-op-directa');
    RAISE EXCEPTION 'FALLA 4b: el navegador escribió una orden';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
