-- Verificación de I6a. NO es una migración. Va con BEGIN/ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_res (caso text, valor text) ON COMMIT DROP;
DO $$
DECLARE
  v_org uuid; v_user uuid; v_prod uuid; v_oc uuid; v_item uuid;
  v_s1 int; v_s2 int; v_s3 int; v_r jsonb;
BEGIN
  SELECT m.org_id, m.user_id INTO v_org, v_user FROM public.memberships m LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role','authenticated')::text, true);

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, cost_usd)
  VALUES (v_org, v_user, 'ZZ I6a', 1000, 0, 1) RETURNING id INTO v_prod;
  INSERT INTO public.purchase_orders (org_id, order_number, supplier_name, status, total_amount)
  VALUES (v_org, 'ZZ-OC-I6A', 'ZZ Prov', 'confirmed', 1000) RETURNING id INTO v_oc;
  INSERT INTO public.purchase_order_items
    (order_id, org_id, product_id, product_name, quantity_ordered, quantity_received, unit_cost, total_cost)
  VALUES (v_oc, v_org, v_prod, 'ZZ I6a', 10, 0, 100, 1000) RETURNING id INTO v_item;

  -- 1ra recepcion parcial de 4, con clave.
  PERFORM public.receive_purchase_order_idem(v_oc,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 4)),
    NULL, NULL, 'zz-clave-A');
  SELECT stock INTO v_s1 FROM public.products WHERE id = v_prod;

  -- 2da con la MISMA clave: es el reintento que antes duplicaba.
  v_r := public.receive_purchase_order_idem(v_oc,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 4)),
    NULL, NULL, 'zz-clave-A');
  SELECT stock INTO v_s2 FROM public.products WHERE id = v_prod;

  INSERT INTO zz_res VALUES
    ('tras_1ra', v_s1::text),
    ('tras_reintegro_misma_clave', v_s2::text),
    ('viene_marcado_reintento', COALESCE((v_r->>'reintento'),'no')::text);

  ASSERT v_s2 = v_s1,
    format('el reintento duplico el stock: %s -> %s', v_s1, v_s2);

  -- Y lo que NO se puede romper: una segunda recepcion legitima, con otra
  -- clave, tiene que entrar. Frenarla seria peor que el problema original.
  PERFORM public.receive_purchase_order_idem(v_oc,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 3)),
    NULL, NULL, 'zz-clave-B');
  SELECT stock INTO v_s3 FROM public.products WHERE id = v_prod;
  INSERT INTO zz_res VALUES ('recepcion_legitima_con_otra_clave', v_s3::text);

  ASSERT v_s3 = v_s1 + 3,
    format('la segunda recepcion legitima no entro: %s (esperado %s)', v_s3, v_s1 + 3);

  -- Y la misma clave con OTRO pedido tiene que ser un error, no la respuesta
  -- vieja: devolverla seria dar por recibida mercaderia que no llego.
  BEGIN
    PERFORM public.receive_purchase_order_idem(v_oc,
      jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 99)),
      NULL, NULL, 'zz-clave-A');
    INSERT INTO zz_res VALUES ('clave_reusada_con_otro_pedido', 'NO FALLO (mal)');
  EXCEPTION WHEN sqlstate '23505' THEN
    INSERT INTO zz_res VALUES ('clave_reusada_con_otro_pedido', 'rechazada (bien)');
  END;
END;
$$;
SELECT * FROM zz_res;
ROLLBACK;
