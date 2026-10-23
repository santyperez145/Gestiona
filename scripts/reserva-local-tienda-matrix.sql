-- Simulacro de 20261023000300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Con 2 reservadas para el local, la vitrina muestra 5 − 2 = 3 en el
--      catálogo completo, el de inicio y la variante (1 − 2 → 0).
--   2. El carrito y el checkout (resolve_store_line con la tienda) aceptan 3 y
--      rechazan 4 diciendo cuántas quedan; stock_en_vitrina informa 3.
--   3. Sin contexto de tienda (el POS) se puede vender las 5.
--   4. Reserva 0: la tienda ofrece todo; una reserva negativa se rechaza.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_store uuid; v_prod uuid; v_var uuid; r jsonb; n numeric; v_slug text; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  v_slug := 'zz-rl-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Reserva local', v_slug, v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_user, 'ZZ Taladro', 50000, 5) RETURNING id INTO v_prod;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, stock, active) VALUES (v_org, v_user, v_prod, 'ZZ Rojo', 1, true) RETURNING id INTO v_var;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, reserva_local) VALUES (v_org, v_slug, 'ZZ Tienda', true, 2) RETURNING id INTO v_store;

  -- 1
  SELECT (e->>'stock')::numeric INTO n FROM json_array_elements(public.get_store_catalog_completo(v_slug)) e WHERE e->>'id' = v_prod::text;
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FALLA 1a: el catálogo completo muestra %', n; END IF;
  SELECT (e->>'stock')::numeric INTO n FROM json_array_elements(public.get_store_catalog_inicio(v_slug)->'productos') e WHERE e->>'id' = v_prod::text;
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FALLA 1b: el inicio muestra %', n; END IF;
  SELECT stock INTO n FROM public.get_store_variants(v_slug) WHERE id = v_var;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FALLA 1c: la variante muestra %', n; END IF;
  SELECT stock INTO n FROM public.get_store_catalog_products(v_slug) WHERE id = v_prod;
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FALLA 1d: el listado de productos muestra %', n; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('nerqia.store_id', v_store::text, true);
  r := public.resolve_store_line(v_org, v_prod, NULL, 3);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'FALLA 2a: no aceptó 3: %', r; END IF;
  r := public.resolve_store_line(v_org, v_prod, NULL, 4);
  IF (r->>'ok')::boolean OR (r->>'available_quantity')::numeric <> 3 THEN RAISE EXCEPTION 'FALLA 2b: aceptó 4 o no dijo cuántas quedan: %', r; END IF;
  r := public.resolve_store_line(v_org, v_prod, v_var, 1);
  IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'FALLA 2c: vendió la variante reservada: %', r; END IF;
  r := public.stock_en_vitrina(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_prod)));
  IF (r->0->>'available_quantity')::numeric <> 3 OR (r->0->>'stock')::numeric <> 3 THEN RAISE EXCEPTION 'FALLA 2d: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('nerqia.store_id', '', true);
  r := public.resolve_store_line(v_org, v_prod, NULL, 5);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'FALLA 3: sin tienda no dejó vender las 5: %', r; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  UPDATE public.ecommerce_stores SET reserva_local = 0 WHERE id = v_store;
  SELECT (e->>'stock')::numeric INTO n FROM json_array_elements(public.get_store_catalog_completo(v_slug)) e WHERE e->>'id' = v_prod::text;
  IF n IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FALLA 4a: sin reserva muestra %', n; END IF;
  BEGIN
    UPDATE public.ecommerce_stores SET reserva_local = -1 WHERE id = v_store;
    RAISE EXCEPTION 'FALLA 4b: aceptó una reserva negativa';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
