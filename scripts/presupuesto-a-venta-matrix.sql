-- Simulacro de 20261014000900 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con presupuestos.
--   1. Una venta de dos renglones con el mismo presupuesto lo convierte.
--   2. Otra venta con el mismo presupuesto se rechaza (23505).
--   3. Un presupuesto de otro negocio se rechaza.
--   4. Un insert suelto de un presupuesto ya convertido (otra transacción) se rechaza.
--   5. Un presupuesto rechazado no se convierte.
--   6. Un presupuesto vendido no cambia de total ni se «desconvierte».
--   7. Desde la app no se puede marcar uno como vendido a mano.
--   8. Notas de un presupuesto vendido siguen editables.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_org2 uuid; q1 uuid; q2 uuid; q3 uuid; v_r jsonb; v_txn uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ presupuestos', 'zz-pre-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-pre2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.quotes (org_id, quote_number, customer_name, items, subtotal, total, status)
    VALUES (v_org, 'ZZ-1', 'ZZ Cliente', '[]', 100, 100, 'sent') RETURNING id INTO q1;
  INSERT INTO public.quotes (org_id, quote_number, customer_name, items, subtotal, total, status)
    VALUES (v_org2, 'ZZ-2', 'ZZ Ajeno', '[]', 100, 100, 'sent') RETURNING id INTO q2;
  INSERT INTO public.quotes (org_id, quote_number, customer_name, items, subtotal, total, status)
    VALUES (v_org, 'ZZ-3', 'ZZ Cliente', '[]', 100, 100, 'rejected') RETURNING id INTO q3;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- 1
  v_r := public.create_sales_transaction(v_org, jsonb_build_array(
    jsonb_build_object('product_name', 'ZZ tornillo', 'quantity', 2, 'unit_price_ars', 30, 'total_ars', 60, 'quote_id', q1, 'override_de_precio', false, 'payment_discount_percent', 0, 'payment_discount_ars', 0),
    jsonb_build_object('product_name', 'ZZ tuerca', 'quantity', 1, 'unit_price_ars', 40, 'total_ars', 40, 'quote_id', q1, 'override_de_precio', false, 'payment_discount_percent', 0, 'payment_discount_ars', 0)), 'presupuesto');
  SELECT converted_transaction_id INTO v_txn FROM public.quotes WHERE id = q1;
  IF v_txn IS NULL OR (SELECT status FROM public.quotes WHERE id = q1) <> 'accepted'
     OR (SELECT count(*) FROM public.sales WHERE quote_id = q1 AND sale_transaction_id = v_txn) <> 2 THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;

  -- 2
  BEGIN
    PERFORM public.create_sales_transaction(v_org, jsonb_build_array(
      jsonb_build_object('product_name', 'ZZ tornillo', 'quantity', 2, 'unit_price_ars', 30, 'total_ars', 60, 'quote_id', q1, 'override_de_precio', false, 'payment_discount_percent', 0, 'payment_discount_ars', 0)), 'presupuesto');
    RAISE EXCEPTION 'FALLA 2: convirtió dos veces';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 3
  BEGIN
    PERFORM public.create_sales_transaction(v_org, jsonb_build_array(
      jsonb_build_object('product_name', 'ZZ algo', 'quantity', 1, 'unit_price_ars', 10, 'total_ars', 10, 'quote_id', q2, 'override_de_precio', false, 'payment_discount_percent', 0, 'payment_discount_ars', 0)), 'presupuesto');
    RAISE EXCEPTION 'FALLA 3: aceptó un presupuesto ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 4
  BEGIN
    PERFORM set_config('gestiona.sale_transaction_id', '', true);
    INSERT INTO public.sales (org_id, user_id, product_name, quantity, total_ars, quote_id) VALUES (v_org, v_user, 'ZZ suelta', 1, 10, q1);
    RAISE EXCEPTION 'FALLA 4: aceptó un insert suelto de un presupuesto convertido';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 5
  BEGIN
    PERFORM public.create_sales_transaction(v_org, jsonb_build_array(
      jsonb_build_object('product_name', 'ZZ algo', 'quantity', 1, 'unit_price_ars', 10, 'total_ars', 10, 'quote_id', q3, 'override_de_precio', false, 'payment_discount_percent', 0, 'payment_discount_ars', 0)), 'presupuesto');
    RAISE EXCEPTION 'FALLA 5: convirtió un rechazado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- 6
  BEGIN
    UPDATE public.quotes SET total = 1 WHERE id = q1;
    RAISE EXCEPTION 'FALLA 6: cambió el total de un vendido';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE public.quotes SET converted_transaction_id = NULL, converted_at = NULL WHERE id = q1;
    RAISE EXCEPTION 'FALLA 6: desconvirtió';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- 7
  PERFORM set_config('gestiona.presupuesto_convirtiendo', '', true);
  BEGIN
    UPDATE public.quotes SET converted_transaction_id = gen_random_uuid() WHERE id = q3;
    RAISE EXCEPTION 'FALLA 7: marcó vendido a mano';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 8
  UPDATE public.quotes SET notes = 'ZZ nota' WHERE id = q1;
  RAISE EXCEPTION 'OK 1-8';
END $$;

ROLLBACK;
