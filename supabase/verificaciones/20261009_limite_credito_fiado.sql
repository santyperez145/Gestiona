-- Límite de crédito del fiado. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_fiado_ctx(org_id uuid, owner_id uuid, seller_id uuid, product_id uuid, customer_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_seller uuid; v_product uuid := gen_random_uuid(); v_customer uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_seller FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Fiado', 'zz-fiado-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_seller, 'vendedor');
  INSERT INTO public.settings(org_id, user_id, discount_cash_percent, discount_transfer_percent, discount_debit_percent, discount_credit_percent)
  VALUES (v_org, v_owner, 0, 0, 0, 0)
  ON CONFLICT (org_id) DO UPDATE SET discount_cash_percent = 0, discount_transfer_percent = 0, discount_debit_percent = 0, discount_credit_percent = 0;
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock) VALUES (v_product, v_org, v_owner, 'ZZ Yerba', 1000, false);
  INSERT INTO public.customers(id, org_id, user_id, name, credit_limit_ars) VALUES (v_customer, v_org, v_owner, 'ZZ Vecina', 1500);
  INSERT INTO zz_fiado_ctx VALUES (v_org, v_owner, v_seller, v_product, v_customer);
END;
$$;
GRANT SELECT ON zz_fiado_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; linea jsonb; v_denied boolean;
BEGIN
  SELECT * INTO c FROM zz_fiado_ctx;
  linea := jsonb_build_object('product_id', c.product_id, 'product_name', 'ZZ Yerba', 'quantity', 1,
    'payment_method', 'fiado', 'paid', false, 'customer_id', c.customer_id, 'customer_name', 'ZZ Vecina');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.seller_id, 'role', 'authenticated')::text, true);

  -- 1000 de 1500: entra y queda como deuda.
  PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea), 'pos');
  ASSERT public.saldo_fiado_cliente(c.org_id, c.customer_id) = 1000, 'La venta fiado no generó la deuda';

  -- Otros 1000 superan el límite: la venta entera se rechaza.
  v_denied := false;
  BEGIN PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea), 'pos');
  EXCEPTION WHEN check_violation THEN v_denied := SQLERRM LIKE '%límite de crédito%disponible 500.00%'; END;
  ASSERT v_denied, 'El fiado superó el límite de crédito';

  -- Pagando en efectivo el límite no aplica.
  PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea || jsonb_build_object('payment_method', 'efectivo', 'paid', true)), 'pos');

  -- El vendedor no puede subirse el límite.
  v_denied := false;
  BEGIN UPDATE public.customers SET credit_limit_ars = 99999 WHERE id = c.customer_id;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un vendedor cambió el límite de crédito';

  -- El dueño lo sube y la venta pasa.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  UPDATE public.customers SET credit_limit_ars = 5000 WHERE id = c.customer_id;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.seller_id, 'role', 'authenticated')::text, true);
  PERFORM public.create_sales_transaction_v3(c.org_id, jsonb_build_array(linea), 'pos');
  ASSERT public.saldo_fiado_cliente(c.org_id, c.customer_id) = 2000, 'El saldo no sumó la segunda deuda';
END;
$$;
RESET ROLE;
SELECT 'limite_credito_fiado OK' AS resultado;
ROLLBACK;
