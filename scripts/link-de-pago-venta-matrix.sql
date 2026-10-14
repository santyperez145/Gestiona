-- Simulacro de 20261014001100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con un tornillo (stock 10) y
-- un cable por metro; otro negocio con un producto ajeno.
--   1. Un link cobrado registra la venta: un renglón por ítem, el total
--      cobrado repartido (había descuento) y el stock baja.
--   2. Repetir no duplica (Mercado Pago reintenta).
--   3. Un link sin cobrar no registra nada.
--   4. Un producto ajeno o una cantidad con decimales en un producto por
--      unidad se registran como renglón libre, sin rechazar el cobro.
--   5. Un link de un presupuesto sin vender lo marca vendido; si ya se vendió
--      en la caja, la venta igual se registra sin vincularlo.
--   6. Desde la app no se puede llamar.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_org2 uuid; p1 uuid; p2 uuid; ajeno uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; q1 uuid; q2 uuid;
  v_r jsonb; v_n int; v_suma numeric;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ links', 'zz-lk-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-lk2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 100, 10) RETURNING id INTO p1;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, unidad_medida) VALUES (v_org, v_user, 'ZZ Cable', 50, 100, 'metro') RETURNING id INTO p2;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org2, v_user, 'ZZ Ajeno', 10) RETURNING id INTO ajeno;

  -- 1. Ítems por 1.300; se cobraron 1.200.
  INSERT INTO public.payment_links (org_id, customer_name, items, total_ars, status, paid_at, external_ref) VALUES (v_org, 'ZZ Cliente',
    jsonb_build_array(
      jsonb_build_object('description', 'ZZ Tornillo', 'qty', 3, 'unitPrice', 100, 'total', 300, 'productId', p1),
      jsonb_build_object('description', 'ZZ Cable', 'qty', 12.5, 'unitPrice', 40, 'total', 500, 'productId', p2),
      jsonb_build_object('description', 'Flete', 'qty', 1, 'unitPrice', 500, 'total', 500)),
    1200, 'paid', now(), 'link:zz1') RETURNING id INTO l1;
  v_r := public.registrar_venta_de_link(l1);
  SELECT count(*), sum(total_ars) INTO v_n, v_suma FROM public.sales WHERE sale_transaction_id = (v_r->>'sale_transaction_id')::uuid AND source = 'link_de_pago';
  IF v_n <> 3 OR v_suma <> 1200 OR (SELECT stock FROM public.products WHERE id = p1) <> 7 OR (SELECT stock FROM public.products WHERE id = p2) <> 87.5 THEN
    RAISE EXCEPTION 'FALLA 1: % lineas=% suma=% stock=%/%', v_r, v_n, v_suma, (SELECT stock FROM public.products WHERE id = p1), (SELECT stock FROM public.products WHERE id = p2); END IF;

  -- 2
  v_r := public.registrar_venta_de_link(l1);
  IF NOT (v_r->>'repetido')::boolean OR (SELECT count(*) FROM public.sales WHERE org_id = v_org) <> 3 THEN RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;

  -- 3
  INSERT INTO public.payment_links (org_id, customer_name, items, total_ars, status, external_ref) VALUES (v_org, 'ZZ', '[]', 10, 'pending', 'link:zz2') RETURNING id INTO l2;
  BEGIN
    PERFORM public.registrar_venta_de_link(l2);
    RAISE EXCEPTION 'FALLA 3: registró un link sin cobrar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- 4
  INSERT INTO public.payment_links (org_id, customer_name, items, total_ars, status, paid_at, external_ref) VALUES (v_org, 'ZZ',
    jsonb_build_array(
      jsonb_build_object('description', 'Ajeno', 'qty', 1, 'unitPrice', 10, 'total', 10, 'productId', ajeno),
      jsonb_build_object('description', 'Tornillo suelto', 'qty', 1.5, 'unitPrice', 100, 'total', 150, 'productId', p1)),
    160, 'paid', now(), 'link:zz3') RETURNING id INTO l3;
  v_r := public.registrar_venta_de_link(l3);
  IF jsonb_array_length(v_r->'libres') <> 2 OR (SELECT stock FROM public.products WHERE id = p1) <> 7
     OR EXISTS (SELECT 1 FROM public.sales WHERE sale_transaction_id = (v_r->>'sale_transaction_id')::uuid AND product_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FALLA 4: %', v_r; END IF;

  -- 5
  INSERT INTO public.quotes (org_id, quote_number, customer_name, items, subtotal, total, status) VALUES (v_org, 'ZZ-Q1', 'ZZ', '[]', 100, 100, 'sent') RETURNING id INTO q1;
  INSERT INTO public.quotes (org_id, quote_number, customer_name, items, subtotal, total, status) VALUES (v_org, 'ZZ-Q2', 'ZZ', '[]', 100, 100, 'sent') RETURNING id INTO q2;
  PERFORM set_config('gestiona.presupuesto_convirtiendo', q2::text, true);
  UPDATE public.quotes SET converted_transaction_id = gen_random_uuid(), converted_at = now(), status = 'accepted' WHERE id = q2;
  INSERT INTO public.payment_links (org_id, quote_id, quote_number, customer_name, items, total_ars, status, paid_at, external_ref)
    VALUES (v_org, q1, 'ZZ-Q1', 'ZZ', '[]', 100, 'paid', now(), 'link:zz4') RETURNING id INTO l4;
  INSERT INTO public.payment_links (org_id, quote_id, quote_number, customer_name, items, total_ars, status, paid_at, external_ref)
    VALUES (v_org, q2, 'ZZ-Q2', 'ZZ', '[]', 100, 'paid', now(), 'link:zz5') RETURNING id INTO l5;
  v_r := public.registrar_venta_de_link(l4);
  IF (SELECT converted_transaction_id FROM public.quotes WHERE id = q1) IS DISTINCT FROM (v_r->>'sale_transaction_id')::uuid THEN RAISE EXCEPTION 'FALLA 5a: %', v_r; END IF;
  v_r := public.registrar_venta_de_link(l5);
  IF v_r->>'presupuesto' IS NOT NULL OR (SELECT count(*) FROM public.sales WHERE sale_transaction_id = (v_r->>'sale_transaction_id')::uuid) <> 1 THEN RAISE EXCEPTION 'FALLA 5b: %', v_r; END IF;

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.registrar_venta_de_link(l1);
    RAISE EXCEPTION 'FALLA 6: la app pudo llamarla';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-6';
END $$;

ROLLBACK;
