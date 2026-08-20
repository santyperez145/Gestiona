-- Verificación de C12. NO es una migración. BEGIN/ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz (caso text, valor text) ON COMMIT DROP;
DO $$
DECLARE
  v_org uuid; v_user uuid; v_prod uuid; v_v record; v_tc numeric;
BEGIN
  SELECT m.org_id, m.user_id INTO v_org, v_user FROM public.memberships m LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role','authenticated')::text, true);
  SELECT s.exchange_rate INTO v_tc FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, cost_usd, total_cost_usd)
  VALUES (v_org, v_user, 'ZZ C12v2', 100000, 5, 20, 20) RETURNING id INTO v_prod;

  -- El mismo ataque que antes funcionaba: precio 1, costo 0, ganancia 999999.
  PERFORM public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'product_name','ZZ C12v2', 'quantity', 1,
      'unit_price_ars', 1, 'total_ars', 1,
      'cost_per_unit_usd', 0, 'cost_of_goods_ars', 0,
      'profit_ars', 999999, 'profit_usd', 999999,
      'payment_method','efectivo')), 'pos');

  SELECT unit_price_ars, total_ars, profit_ars, cost_of_goods_ars, cost_per_unit_usd
    INTO v_v FROM public.sales
   WHERE org_id = v_org AND product_name = 'ZZ C12v2' LIMIT 1;

  INSERT INTO zz VALUES
    ('precio_pedido_por_el_navegador','1'),
    ('precio_guardado', v_v.unit_price_ars::text),
    ('costo_guardado_ars', v_v.cost_of_goods_ars::text),
    ('costo_esperado_ars', (20 * v_tc)::text),
    ('ganancia_pedida','999999'),
    ('ganancia_guardada', v_v.profit_ars::text);

  -- 1. El precio de override se respeta —el cajero puede descontar— pero el
  --    costo y la ganancia NO son los que pidió el navegador.
  ASSERT v_v.cost_of_goods_ars = round(20 * v_tc, 2),
    format('el costo no se recalculo: %s (esperado %s)', v_v.cost_of_goods_ars, 20 * v_tc);
  ASSERT v_v.profit_ars <> 999999,
    'la ganancia inventada por el navegador entro igual';
  ASSERT v_v.profit_ars = round(v_v.total_ars - v_v.cost_of_goods_ars, 2),
    'la ganancia no se deriva de precio menos costo';

  -- 2. Sin precio pedido, el servidor pone el suyo.
  PERFORM public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'product_name','ZZ C12v2b', 'quantity', 2,
      'payment_method','efectivo')), 'pos');
  SELECT unit_price_ars, total_ars INTO v_v FROM public.sales
   WHERE org_id = v_org AND product_name = 'ZZ C12v2b' LIMIT 1;
  INSERT INTO zz VALUES
    ('sin_precio_pedido_guardo', v_v.unit_price_ars::text),
    ('total_de_2_unidades', v_v.total_ars::text);
  ASSERT v_v.unit_price_ars = 100000,
    format('el servidor no puso el precio real: %s', v_v.unit_price_ars);
  ASSERT v_v.total_ars = 200000, 'el total no es precio x cantidad';

  -- 3. Un producto de otra organizacion no se puede vender acá.
  BEGIN
    PERFORM public.precio_pos_autoritativo(
      gen_random_uuid(), v_prod, NULL, 1);
    INSERT INTO zz VALUES ('producto_de_otra_org','NO FALLO (mal)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO zz VALUES ('producto_de_otra_org','rechazado (bien)');
  END;
END;
$$;
SELECT * FROM zz;
ROLLBACK;
