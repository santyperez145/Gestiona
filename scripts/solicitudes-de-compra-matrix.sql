-- Simulacro de 20261014001900 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con dueño y vendedor.
--   1. El vendedor pide (catálogo + ítem libre): numerada (no «temp»), total.
--   2. El vendedor no puede aprobar su solicitud.
--   3. El dueño aprueba: queda quién aprobó.
--   4. «Pedida» a mano se rechaza.
--   5. Convertir crea la orden con los renglones y vincula la solicitud.
--   6. No se convierte dos veces.
--   7. Al recibir la orden completa, la solicitud queda recibida.
--   8. Rechazar exige motivo.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; p1 uuid; v_s jsonb; v_s2 jsonb; v_o jsonb; v_item uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ solicitudes', 'zz-sol-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 0) RETURNING id INTO p1;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_s := public.guardar_solicitud_de_compra(v_org, jsonb_build_object('title', 'Reposición', 'requested_by', 'Juan', 'items', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 10, 'estimated_price', 50),
    jsonb_build_object('product_name', 'Resma A4', 'quantity', 2, 'estimated_price', 100))));
  RESET ROLE;
  IF v_s->>'request_number' IN ('temp', '') OR v_s->>'request_number' IS NULL OR (v_s->>'total_estimated')::numeric <> 700
     OR (SELECT count(*) FROM public.purchase_request_items WHERE request_id = (v_s->>'id')::uuid AND product_id = p1) <> 1 THEN
    RAISE EXCEPTION 'FALLA 1: %', v_s; END IF;

  -- 2
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.purchase_requests SET status = 'approved' WHERE id = (v_s->>'id')::uuid;
    RAISE EXCEPTION 'FALLA 2: el vendedor aprobó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.purchase_requests SET status = 'approved' WHERE id = (v_s->>'id')::uuid;
  RESET ROLE;
  IF (SELECT approved_by FROM public.purchase_requests WHERE id = (v_s->>'id')::uuid) <> v_user::text THEN RAISE EXCEPTION 'FALLA 3'; END IF;

  -- 4
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.purchase_requests SET status = 'ordered' WHERE id = (v_s->>'id')::uuid;
    RAISE EXCEPTION 'FALLA 4: pedida a mano';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5
  v_o := public.convertir_solicitud_en_orden(v_org, (v_s->>'id')::uuid, jsonb_build_object('supplier_name', 'ZZ Distribuidora', 'currency', 'ARS'));
  RESET ROLE;
  IF (v_o->>'total_amount')::numeric <> 700 OR (SELECT count(*) FROM public.purchase_order_items WHERE order_id = (v_o->>'id')::uuid) <> 2
     OR (SELECT status || '|' || purchase_order_id FROM public.purchase_requests WHERE id = (v_s->>'id')::uuid) <> 'ordered|' || (v_o->>'id') THEN
    RAISE EXCEPTION 'FALLA 5: %', v_o; END IF;

  -- 6
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.convertir_solicitud_en_orden(v_org, (v_s->>'id')::uuid, jsonb_build_object('supplier_name', 'X'));
    RAISE EXCEPTION 'FALLA 6: convirtió dos veces';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 7
  UPDATE public.purchase_orders SET status = 'confirmed' WHERE id = (v_o->>'id')::uuid;
  PERFORM public.receive_purchase_order((v_o->>'id')::uuid, (SELECT jsonb_agg(jsonb_build_object('item_id', id, 'quantity', quantity_ordered)) FROM public.purchase_order_items WHERE order_id = (v_o->>'id')::uuid));
  RESET ROLE;
  IF (SELECT status FROM public.purchase_requests WHERE id = (v_s->>'id')::uuid) <> 'received' OR (SELECT stock FROM public.products WHERE id = p1) <> 10 THEN
    RAISE EXCEPTION 'FALLA 7: %', (SELECT status FROM public.purchase_requests WHERE id = (v_s->>'id')::uuid); END IF;

  -- 8
  SET LOCAL ROLE authenticated;
  v_s2 := public.guardar_solicitud_de_compra(v_org, jsonb_build_object('title', 'Otra', 'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'quantity', 1))));
  BEGIN
    UPDATE public.purchase_requests SET status = 'rejected' WHERE id = (v_s2->>'id')::uuid;
    RAISE EXCEPTION 'FALLA 8: rechazó sin motivo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.purchase_requests SET status = 'rejected', rejected_reason = 'No hace falta' WHERE id = (v_s2->>'id')::uuid;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-8';
END $$;

ROLLBACK;
