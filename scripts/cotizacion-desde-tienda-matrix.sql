-- Simulacro de 20261030000700 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin sesión no se pide cotización.
--   2. El comprador pide precio: nace un presupuesto en borrador con sus ítems
--      al precio de hoy (oferta y variante) y su origen.
--   3. Un producto oculto no se cotiza y no queda nada a medias.
--   4. Tope: 5 pedidos abiertos por comprador y tienda por día.
--   5. El comprador ve sus pedidos; cuando el comercio responde con link de
--      pago, lo ve; otro usuario no ve nada.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_org uuid; v_store uuid; v_a uuid; v_b uuid; v_c uuid; v_var uuid; v_quote uuid;
  v_slug text := 'zz-cotiza-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ok text := ''; v_antes integer; i integer;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_comp FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Cotiza', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, published_at)
  VALUES (v_org, v_slug, 'ZZ Cotiza', true, now()) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sku, sale_price_ars, discount_price_ars) VALUES (v_org, v_owner, 'ZZ Cemento', 'CEM', 1000, 900) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org, v_owner, 'ZZ Oculto', 500) RETURNING id INTO v_b;
  INSERT INTO public.store_product_publications (store_id, product_id, org_id, visibility) VALUES (v_store, v_b, v_org, 'hidden');
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org, v_owner, 'ZZ Pintura', 1200) RETURNING id INTO v_c;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, price_override) VALUES (v_org, v_owner, v_c, 'Blanco 20 L', 1500) RETURNING id INTO v_var;

  -- 1
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)));
    RAISE EXCEPTION 'FALLA 1: un anónimo pidió cotización';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  -- Una tienda sin venta mayorista no recibe pedidos de cotización.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)));
    RAISE EXCEPTION 'FALLA 1b: una tienda sin venta mayorista recibió un pedido';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  UPDATE public.ecommerce_stores SET mayorista_modo = 'mixto' WHERE id = v_store;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(
    jsonb_build_object('product_id', v_a, 'quantity', 10),
    jsonb_build_object('product_id', v_c, 'variant_id', v_var, 'quantity', 2)),
    jsonb_build_object('mensaje', 'Para obra en Pilar', 'nombre', 'Constructora ZZ'));
  RESET ROLE;
  SELECT id INTO v_quote FROM public.quotes WHERE org_id = v_org AND quote_number = r->>'quote_number';
  IF v_quote IS NULL OR (SELECT origen FROM public.quotes WHERE id = v_quote) <> 'tienda'
     OR (SELECT status FROM public.quotes WHERE id = v_quote) <> 'draft'
     OR (SELECT solicitado_por FROM public.quotes WHERE id = v_quote) <> v_comp
     OR (SELECT customer_name FROM public.quotes WHERE id = v_quote) <> 'Constructora ZZ' THEN
    RAISE EXCEPTION 'FALLA 2a: %', r;
  END IF;
  IF (SELECT total FROM public.quotes WHERE id = v_quote) <> 12000
     OR (SELECT (items->0->>'unitPrice')::numeric FROM public.quotes WHERE id = v_quote) <> 900
     OR (SELECT (items->1->>'unitPrice')::numeric FROM public.quotes WHERE id = v_quote) <> 1500
     OR (SELECT items->1->>'variantId' FROM public.quotes WHERE id = v_quote) <> v_var::text THEN
    RAISE EXCEPTION 'FALLA 2b: %', (SELECT items FROM public.quotes WHERE id = v_quote);
  END IF;
  IF position('Para obra en Pilar' IN (SELECT notes FROM public.quotes WHERE id = v_quote)) = 0 THEN RAISE EXCEPTION 'FALLA 2c'; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  SELECT count(*) INTO v_antes FROM public.quotes WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(
      jsonb_build_object('product_id', v_a, 'quantity', 1), jsonb_build_object('product_id', v_b, 'quantity', 1)));
    RAISE EXCEPTION 'FALLA 3a: cotizó un producto oculto';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM public.quotes WHERE org_id = v_org) <> v_antes THEN RAISE EXCEPTION 'FALLA 3b: quedó un presupuesto a medias'; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  SET LOCAL ROLE authenticated;
  FOR i IN 1..4 LOOP
    PERFORM public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)));
  END LOOP;
  BEGIN
    PERFORM public.solicitar_cotizacion_tienda(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)));
    RAISE EXCEPTION 'FALLA 4: superó el tope de pedidos abiertos';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4 ';

  -- 5
  SET LOCAL ROLE authenticated;
  r := public.mis_cotizaciones_tienda(v_slug);
  RESET ROLE;
  IF jsonb_array_length(r) <> 5 OR NOT (r @> jsonb_build_array(jsonb_build_object('estado', 'pendiente'))) THEN RAISE EXCEPTION 'FALLA 5a: %', r; END IF;
  -- Sin respuesta del comercio no se ve el importe (precio oculto en «sólo mayoristas»).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e->>'total' IS NOT NULL) THEN RAISE EXCEPTION 'FALLA 5a2: mostró el total sin respuesta: %', r; END IF;
  -- El comercio responde y genera el link de pago.
  UPDATE public.quotes SET status = 'sent' WHERE id = v_quote;
  INSERT INTO public.payment_links (id, org_id, quote_id, quote_number, customer_name, items, total_ars, status, external_ref)
  VALUES (gen_random_uuid(), v_org, v_quote, r->0->>'quote_number', 'Constructora ZZ', '[]'::jsonb, 12000, 'pending', 'link:zz');
  SET LOCAL ROLE authenticated;
  r := public.mis_cotizaciones_tienda(v_slug);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e->>'estado' = 'respondida' AND e->>'pago_id' IS NOT NULL AND (e->>'total')::numeric = 12000) THEN
    RAISE EXCEPTION 'FALLA 5b: no ve la respuesta con su link: %', r;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF jsonb_array_length(public.mis_cotizaciones_tienda(v_slug)) <> 0 THEN RAISE EXCEPTION 'FALLA 5c: otro usuario ve pedidos ajenos'; END IF;
  RESET ROLE;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
