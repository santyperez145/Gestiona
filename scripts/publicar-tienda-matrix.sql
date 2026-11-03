-- Simulacro de 20261103000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Una tienda completa como la del alta (transferencia con alias, retiro con
-- dirección, términos y privacidad publicados, un producto con precio y envío
-- por zonas con retiro) y el dueño publicando con su sesión:
--   1. La tienda completa no tiene bloqueantes.
--   2. Cada bloqueante del checklist, solo, impide publicarla, con un mensaje
--      que lo nombra, y la tienda sigue sin publicar.
--   3. Completa, se publica y se sella published_at.
--   4. Ya publicada, se sigue guardando entera aunque le falte algo (las
--      tiendas de producción no se rompen).
--   5. Despublicada, volver a publicarla con dos faltantes nombra los dos.
--   6. Sólo con Nerqia Pay conectado también se publica.
--   7. Crear una tienda ya publicada sin términos no pasa.
--   8. La base (semillas, matrices) arma vitrinas activas sin el checklist.
--   9. anon no revisa tiendas y un usuario de otro negocio tampoco.
DO $$
DECLARE
  v_owner uuid; v_otro uuid; v_org uuid; v_store uuid; v_otra uuid;
  v_sfx text := substr(md5(random()::text), 1, 8);
  v_slug text;
  v_legal text := 'Vende ZZ Ferretería SRL, Av. ZZ 123, CABA. Los datos del pedido se usan sólo para entregarlo y facturarlo.';
  v_caso record; v_msg text; v_paso boolean; v_fila public.ecommerce_stores; v_ok text := '';
BEGIN
  v_slug := 'zz-publicar-' || v_sfx;
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users u
   WHERE u.id <> v_owner AND NOT public.is_platform_admin(u.id)
   ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Publicar', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.settings (org_id, user_id, business_name, bank_alias)
  VALUES (v_org, v_owner, 'ZZ Publicar', 'zz.publicar.' || v_sfx)
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = NULL, bank_alias = EXCLUDED.bank_alias;
  -- Al nacer siembra las 6 zonas sin tarifas: con retiro no bloquean.
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_mode, pickup_enabled, pickup_address)
  VALUES (v_org, v_slug, 'ZZ Publicar', false, ARRAY['transferencia'], 'zones', true, 'Av. ZZ 123, CABA') RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Martillo', 1000, 5);
  INSERT INTO public.store_pages (org_id, store_id, slug, title, content, status) VALUES
    (v_org, v_store, 'politica-de-privacidad', 'Política de privacidad', v_legal, 'published'),
    (v_org, v_store, 'terminos-y-condiciones', 'Términos y condiciones', v_legal, 'published');

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_fila FROM public.ecommerce_stores WHERE id = v_store;
  IF v_fila.id IS NULL THEN RESET ROLE; RAISE EXCEPTION 'FALLA 1a: el dueño no ve su tienda'; END IF;
  -- IS DISTINCT FROM: con un NULL, «<>» no fallaba nunca.
  IF cardinality(public.tienda_bloqueos_para_publicar(v_fila)) IS DISTINCT FROM 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 1b: la tienda completa tiene bloqueantes: %', public.tienda_bloqueos_para_publicar(v_fila);
  END IF;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2: se rompe una cosa (como la base), el dueño intenta publicar, se arregla.
  -- $1 = tienda, $2 = negocio, $3 = link de la tienda.
  FOR v_caso IN SELECT * FROM (VALUES
    ('2a', $q$UPDATE public.ecommerce_stores SET slug = repeat(' ', 40) WHERE id = $1$q$,
           $q$UPDATE public.ecommerce_stores SET slug = $3 WHERE id = $1$q$,
           '%link de la tienda%'),
    ('2b', $q$UPDATE public.products SET is_active = false WHERE org_id = $2$q$,
           $q$UPDATE public.products SET is_active = true WHERE org_id = $2$q$,
           '%producto publicado%'),
    ('2c', $q$INSERT INTO public.store_product_publications (store_id, product_id, org_id, visibility) SELECT $1, id, $2, 'hidden' FROM public.products WHERE org_id = $2$q$,
           $q$DELETE FROM public.store_product_publications WHERE store_id = $1$q$,
           '%producto publicado%'),
    ('2d', $q$UPDATE public.ecommerce_stores SET payment_methods = ARRAY['gestiona_pay'] WHERE id = $1$q$,
           $q$UPDATE public.ecommerce_stores SET payment_methods = ARRAY['transferencia'] WHERE id = $1$q$,
           '%forma de cobrar%'),
    ('2e', $q$UPDATE public.settings SET bank_cbu = NULL, bank_alias = '   ' WHERE org_id = $2$q$,
           $q$UPDATE public.settings SET bank_alias = 'zz.publicar' WHERE org_id = $2$q$,
           '%CBU ni alias%'),
    ('2f', $q$UPDATE public.ecommerce_stores SET pickup_address = '   ' WHERE id = $1$q$,
           $q$UPDATE public.ecommerce_stores SET pickup_address = 'Av. ZZ 123, CABA' WHERE id = $1$q$,
           '%dirección de retiro%'),
    ('2g', $q$UPDATE public.store_pages SET status = 'draft' WHERE store_id = $1 AND slug = 'terminos-y-condiciones'$q$,
           $q$UPDATE public.store_pages SET status = 'published' WHERE store_id = $1 AND slug = 'terminos-y-condiciones'$q$,
           '%términos%'),
    ('2h', $q$UPDATE public.store_pages SET content = 'Completá acá los datos de tu negocio.' WHERE store_id = $1 AND slug = 'politica-de-privacidad'$q$,
           $q$UPDATE public.store_pages SET content = (SELECT p.content FROM public.store_pages p WHERE p.store_id = $1 AND p.slug = 'terminos-y-condiciones') WHERE store_id = $1 AND slug = 'politica-de-privacidad'$q$,
           '%términos%'),
    ('2i', $q$DELETE FROM public.store_pages WHERE store_id = $1 AND slug = 'politica-de-privacidad'$q$,
           $q$INSERT INTO public.store_pages (org_id, store_id, slug, title, content, status) SELECT $2, $1, 'politica-de-privacidad', 'Política de privacidad', p.content, 'published' FROM public.store_pages p WHERE p.store_id = $1 AND p.slug = 'terminos-y-condiciones'$q$,
           '%términos%'),
    ('2j', $q$UPDATE public.ecommerce_stores SET pickup_enabled = false WHERE id = $1$q$,
           $q$UPDATE public.ecommerce_stores SET pickup_enabled = true WHERE id = $1$q$,
           '%ninguna zona tiene tarifas%'),
    -- Una sola provincia con tarifa: faltan 23 de 24.
    ('2k', $q$WITH zona AS (INSERT INTO public.shipping_zones (org_id, name, provinces) VALUES ($2, 'ZZ Sólo Córdoba', ARRAY['AR-X']) RETURNING id),
                tarifa AS (INSERT INTO public.shipping_rates (org_id, zone_id, price) SELECT $2, id, 3500 FROM zona RETURNING 1)
           UPDATE public.ecommerce_stores SET pickup_enabled = false WHERE id = $1$q$,
           $q$UPDATE public.ecommerce_stores SET pickup_enabled = true WHERE id = $1$q$,
           '%mitad del país%')
  ) AS c(caso, romper, arreglar, espera) LOOP
    EXECUTE v_caso.romper USING v_store, v_org, v_slug;
    v_msg := NULL;
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.ecommerce_stores SET is_active = true WHERE id = v_store;
      v_paso := FOUND;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_paso := false;
    END;
    RESET ROLE;
    IF v_paso OR v_msg IS NULL THEN
      RAISE EXCEPTION 'FALLA %: se publicó (o el dueño no llegó a la fila) con un bloqueante sin resolver', v_caso.caso;
    END IF;
    IF v_msg NOT LIKE 'No se puede publicar la tienda: %' OR v_msg NOT LIKE v_caso.espera THEN
      RAISE EXCEPTION 'FALLA %: el mensaje no nombra el bloqueante: %', v_caso.caso, v_msg;
    END IF;
    IF (SELECT is_active FROM public.ecommerce_stores WHERE id = v_store) THEN
      RAISE EXCEPTION 'FALLA %: la tienda quedó publicada', v_caso.caso;
    END IF;
    EXECUTE v_caso.arreglar USING v_store, v_org, v_slug;
    v_ok := v_ok || v_caso.caso || ' ';
  END LOOP;

  -- 3
  SET LOCAL ROLE authenticated;
  UPDATE public.ecommerce_stores SET is_active = true WHERE id = v_store;
  RESET ROLE;
  SELECT * INTO v_fila FROM public.ecommerce_stores WHERE id = v_store;
  IF NOT v_fila.is_active OR v_fila.published_at IS NULL THEN
    RAISE EXCEPTION 'FALLA 3: la tienda completa no quedó publicada: %', row_to_json(v_fila);
  END IF;
  v_ok := v_ok || '3 ';

  -- 4: el panel guarda la fila entera, con is_active = true otra vez.
  UPDATE public.settings SET bank_cbu = NULL, bank_alias = NULL WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  UPDATE public.ecommerce_stores SET name = 'ZZ Publicar renombrada', is_active = true, pickup_address = NULL WHERE id = v_store;
  RESET ROLE;
  SELECT * INTO v_fila FROM public.ecommerce_stores WHERE id = v_store;
  IF v_fila.name IS DISTINCT FROM 'ZZ Publicar renombrada' OR NOT v_fila.is_active OR v_fila.pickup_address IS NOT NULL THEN
    RAISE EXCEPTION 'FALLA 4: no se pudo guardar la tienda ya publicada: %', row_to_json(v_fila);
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  v_msg := NULL;
  SET LOCAL ROLE authenticated;
  UPDATE public.ecommerce_stores SET is_active = false WHERE id = v_store;
  BEGIN
    UPDATE public.ecommerce_stores SET is_active = true WHERE id = v_store;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_msg IS NULL OR v_msg NOT LIKE '%CBU ni alias%' OR v_msg NOT LIKE '%dirección de retiro%' THEN
    RAISE EXCEPTION 'FALLA 5a: %', COALESCE(v_msg, 'se volvió a publicar sin CBU ni dirección de retiro');
  END IF;
  IF (SELECT is_active FROM public.ecommerce_stores WHERE id = v_store) THEN
    RAISE EXCEPTION 'FALLA 5b: la tienda quedó publicada';
  END IF;
  v_ok := v_ok || '5 ';

  -- 6: sin transferencia no hace falta CBU; Nerqia Pay listo cobra.
  UPDATE public.ecommerce_stores SET pickup_address = 'Av. ZZ 123, CABA', payment_methods = ARRAY['gestiona_pay'] WHERE id = v_store;
  INSERT INTO public.org_payment_providers (org_id, provider, habilitado, cuenta)
  VALUES (v_org, 'mercadopago', true, 'manual');
  INSERT INTO public.payment_connections (org_id, provider, external_id, access_token, live_mode)
  VALUES (v_org, 'mercadopago', 'zz-mp-' || v_sfx, 'ZZ-TOKEN-' || v_sfx, false);
  UPDATE public.org_payment_providers SET conectado_at = now() WHERE org_id = v_org AND provider = 'mercadopago';
  SET LOCAL ROLE authenticated;
  UPDATE public.ecommerce_stores SET is_active = true WHERE id = v_store;
  RESET ROLE;
  IF NOT (SELECT is_active FROM public.ecommerce_stores WHERE id = v_store) THEN
    RAISE EXCEPTION 'FALLA 6: la tienda con Nerqia Pay conectado no se publicó';
  END IF;
  v_ok := v_ok || '6 ';

  -- 7: una tienda nueva no tiene páginas legales todavía.
  v_msg := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, pickup_enabled, pickup_address)
    VALUES (v_org, v_slug || '-b', 'ZZ Publicar B', true, ARRAY['efectivo'], true, 'Av. ZZ 123, CABA');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_msg IS NULL OR v_msg NOT LIKE '%términos%' THEN
    RAISE EXCEPTION 'FALLA 7: %', COALESCE(v_msg, 'se creó publicada una tienda sin términos');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ecommerce_stores WHERE slug = v_slug || '-b') THEN
    RAISE EXCEPTION 'FALLA 7b: la tienda quedó creada';
  END IF;
  v_ok := v_ok || '7 ';

  -- 8
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_slug || '-c', 'ZZ Semilla', true) RETURNING id INTO v_otra;
  IF NOT (SELECT is_active FROM public.ecommerce_stores WHERE id = v_otra) THEN
    RAISE EXCEPTION 'FALLA 8: la base no pudo armar una vitrina activa';
  END IF;
  v_ok := v_ok || '8 ';

  -- 9
  IF has_function_privilege('anon', 'public.tienda_bloqueos_para_publicar(public.ecommerce_stores)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 9a: anon revisa tiendas';
  END IF;
  IF v_otro IS NOT NULL THEN
    SELECT * INTO v_fila FROM public.ecommerce_stores WHERE id = v_store;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.tienda_bloqueos_para_publicar(v_fila);
      v_paso := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_paso := false;
    END;
    RESET ROLE;
    IF v_paso THEN RAISE EXCEPTION 'FALLA 9b: un usuario de otro negocio revisó la tienda'; END IF;
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  v_ok := v_ok || '9';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
