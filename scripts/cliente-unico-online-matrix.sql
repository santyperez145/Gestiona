-- Simulacro de 20261022001500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un cliente del local que compra online con otro email es el mismo
--      cliente (por CUIT): no se duplica y su email no se pisa.
--   2. Un comprador nuevo con CUIT queda con su identidad fiscal en la ficha.
--   3. Un cliente sin identidad fiscal la recibe; uno con identidad cargada a
--      mano no se pisa.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_store uuid; v_local uuid; v_sin uuid; v_conocido uuid; v_id uuid; o uuid; c public.customers%ROWTYPE; v_ok text := '';
  v_sfx text := substr(md5(random()::text), 1, 8);
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Unico', 'zz-unico-' || v_sfx, v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, 'zz-unico-' || v_sfx, 'ZZ tienda', true) RETURNING id INTO v_store;
  INSERT INTO public.customers (org_id, user_id, name, email, tax_id, vat_condition, legal_name)
  VALUES (v_org, v_user, 'ZZ Ferretería', 'local@invalid.test', '30712345671', 'responsable_inscripto', 'ZZ Ferretería SA') RETURNING id INTO v_local;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_user, 'ZZ Sin datos', 'sin@invalid.test') RETURNING id INTO v_sin;
  INSERT INTO public.customers (org_id, user_id, name, email, tax_id, vat_condition) VALUES (v_org, v_user, 'ZZ Conocido', 'conocido@invalid.test', '20111111112', 'monotributo') RETURNING id INTO v_conocido;

  -- 1
  INSERT INTO public.ecommerce_orders (org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total, payment_method,
    buyer_tax_condition, buyer_doc_type, buyer_doc_number, buyer_business_name)
  VALUES (v_org, v_store, 'ZZU-1-' || v_sfx, 'Juan de ZZ', 'compras@invalid.test', '[]', 100, 100, 'efectivo',
    'responsable_inscripto', 80, '30-71234567-1', 'ZZ Ferretería SA') RETURNING id INTO o;
  v_id := public.upsert_customer_from_order(o);
  SELECT * INTO c FROM public.customers WHERE id = v_local;
  IF v_id <> v_local OR c.email <> 'local@invalid.test' OR (SELECT count(*) FROM public.customers WHERE org_id = v_org) <> 3 THEN
    RAISE EXCEPTION 'FALLA 1: % %', v_id, to_jsonb(c);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.ecommerce_orders (org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total, payment_method,
    buyer_tax_condition, buyer_doc_type, buyer_doc_number, buyer_business_name)
  VALUES (v_org, v_store, 'ZZU-2-' || v_sfx, 'ZZ Nueva', 'nueva@invalid.test', '[]', 100, 100, 'efectivo',
    'monotributo', 80, '27222222228', 'ZZ Nueva SRL') RETURNING id INTO o;
  v_id := public.upsert_customer_from_order(o);
  SELECT * INTO c FROM public.customers WHERE id = v_id;
  IF c.tax_id <> '27222222228' OR c.tax_id_type <> 'CUIT' OR c.vat_condition <> 'monotributo' OR c.legal_name <> 'ZZ Nueva SRL' THEN
    RAISE EXCEPTION 'FALLA 2: %', to_jsonb(c);
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  INSERT INTO public.ecommerce_orders (org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total, payment_method,
    buyer_tax_condition, buyer_doc_type, buyer_doc_number)
  VALUES (v_org, v_store, 'ZZU-3-' || v_sfx, 'ZZ Sin datos', 'sin@invalid.test', '[]', 100, 100, 'efectivo',
    'exento', 80, '30699999993') RETURNING id INTO o;
  v_id := public.upsert_customer_from_order(o);
  SELECT * INTO c FROM public.customers WHERE id = v_sin;
  IF v_id <> v_sin OR c.tax_id <> '30699999993' OR c.vat_condition <> 'exento' THEN RAISE EXCEPTION 'FALLA 3a: %', to_jsonb(c); END IF;
  INSERT INTO public.ecommerce_orders (org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total, payment_method,
    buyer_tax_condition, buyer_doc_type, buyer_doc_number)
  VALUES (v_org, v_store, 'ZZU-4-' || v_sfx, 'ZZ Conocido', 'conocido@invalid.test', '[]', 100, 100, 'efectivo',
    'responsable_inscripto', 80, '30712345671') RETURNING id INTO o;
  -- Con el CUIT de otro cliente, gana el documento: es el cliente del local.
  v_id := public.upsert_customer_from_order(o);
  SELECT * INTO c FROM public.customers WHERE id = v_conocido;
  IF v_id <> v_local OR c.tax_id <> '20111111112' OR c.vat_condition <> 'monotributo' THEN RAISE EXCEPTION 'FALLA 3b: % %', v_id, to_jsonb(c); END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
