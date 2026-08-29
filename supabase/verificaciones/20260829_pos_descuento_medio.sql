-- Prueba reversible contra la base enlazada. No toca datos de un comercio:
-- crea una organización/producto ZZ, cobra por el camino real v3, comprueba
-- precio + stock + evidencia de pago, borra y finalmente hace ROLLBACK.
BEGIN;

CREATE TEMP TABLE zz_pos_discount_proof (
  check_name text,
  value text
) ON COMMIT DROP;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_user uuid;
  v_result jsonb;
  v_transaction uuid;
  v_saved public.sales%ROWTYPE;
  v_stock integer;
  v_payment public.payment_transactions%ROWTYPE;
  v_restos integer;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No hay usuario para la fixture ZZ';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org,
    'ZZ POS descuento medio',
    'zz-pos-discount-proof-' || substr(v_org::text, 1, 8),
    v_user
  );
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  UPDATE public.settings
  SET exchange_rate = 1000,
      discount_cash_percent = 10,
      discount_transfer_percent = 15,
      discount_debit_percent = 2.5,
      discount_credit_percent = 0
  WHERE org_id = v_org;

  INSERT INTO public.products (
    id, org_id, user_id, name, sale_price_ars, discount_price_ars,
    cost_usd, total_cost_usd, stock
  ) VALUES (
    v_product, v_org, v_user, 'ZZ Producto descuento medio',
    10000, 9500, 2, 2, 10
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  -- Simula además una pestaña vieja: manda lista (10.000). La autoridad debe
  -- cobrar 9.000 por el 10% de efectivo, no aceptar ese precio mayor.
  v_result := public.create_sales_transaction_v3(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_sale,
      'org_id', v_org,
      'user_id', v_user,
      'product_id', v_product,
      'product_name', 'ZZ Producto descuento medio',
      'quantity', 1,
      'unit_price_ars', 10000,
      'total_ars', 10000,
      'customer_name', 'ZZ Cliente',
      'date', now(),
      'paid', true,
      'payment_method', 'efectivo',
      'source', 'pos',
      'offline_transaction_id', v_ticket,
      'offline_origin', false
    )),
    'pos'
  );
  v_transaction := (v_result->>'transaction_id')::uuid;

  SELECT * INTO v_saved FROM public.sales WHERE id = v_sale;
  SELECT stock INTO v_stock FROM public.products WHERE id = v_product;
  SELECT * INTO v_payment
  FROM public.payment_transactions
  WHERE org_id = v_org AND source = 'pos' AND source_id = v_transaction;

  ASSERT v_saved.total_ars = 9000,
    'el servidor cobro ' || v_saved.total_ars || ' en vez de 9000';
  ASSERT v_saved.unit_price_ars = 9000,
    'la linea no conservo el precio final de 9000';
  ASSERT v_saved.precio_autoritativo = 9000 AND NOT v_saved.override_de_precio,
    'el descuento automatico se marco como override manual';
  ASSERT v_saved.payment_discount_percent = 10
    AND v_saved.payment_discount_ars = 500,
    'la evidencia del descuento no coincide con oferta 9500 -> efectivo 9000';
  ASSERT (v_result->>'precios_viejos_ignorados')::integer = 1,
    'la pestaña vieja no quedo identificada';
  ASSERT v_stock = 9, 'la venta no movio exactamente una unidad de stock';
  ASSERT v_payment.gross_amount = 9000
    AND v_payment.status = 'approved'
    AND v_payment.provider = 'efectivo',
    'la evidencia de cobro no coincide con el ticket final';

  INSERT INTO zz_pos_discount_proof VALUES
    ('precio_final', v_saved.total_ars::text),
    ('descuento_pct', v_saved.payment_discount_percent::text),
    ('descuento_ars', v_saved.payment_discount_ars::text),
    ('stock_final', v_stock::text),
    ('pago', v_payment.provider || ':' || v_payment.status || ':' || v_payment.gross_amount);

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sale_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.stock_movements WHERE org_id = v_org)
  INTO v_restos;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' restos ZZ';
  INSERT INTO zz_pos_discount_proof VALUES ('restos', v_restos::text);
END;
$proof$;

SELECT check_name, value FROM zz_pos_discount_proof ORDER BY check_name;

ROLLBACK;
