-- Verificación no destructiva de C21.2 sobre la base vinculada.
-- Crea una segunda vitrina y overrides dentro de una transacción que siempre
-- termina en ROLLBACK. No cambia productos, stock ni configuración real.

BEGIN;

DO $verify_assortment$
DECLARE
  v_store record;
  v_test_store uuid;
  v_product record;
  v_member uuid;
  v_original_count bigint;
  v_test_count bigint;
  v_after_hide bigint;
  v_test_price numeric;
  v_expected_price numeric;
  v_line jsonb;
  v_foreign_category text;
BEGIN
  SELECT store.id, store.org_id, store.slug
  INTO v_store
  FROM public.ecommerce_stores store
  WHERE store.is_active
    AND EXISTS (
      SELECT 1 FROM public.products product
      WHERE product.org_id = store.org_id
        AND COALESCE(product.is_active, true)
        AND COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) > 0
    )
  ORDER BY store.is_primary DESC, store.created_at
  LIMIT 1;

  IF v_store.id IS NULL THEN
    RAISE NOTICE 'Verificación omitida: no hay una tienda con productos publicables';
    RETURN;
  END IF;

  SELECT membership.user_id INTO v_member
  FROM public.memberships membership
  WHERE membership.org_id = v_store.org_id
    AND membership.role IN ('owner', 'admin')
  ORDER BY membership.created_at
  LIMIT 1;

  SELECT product.id,
         COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) AS price
  INTO v_product
  FROM public.products product
  WHERE product.org_id = v_store.org_id
    AND COALESCE(product.is_active, true)
    AND COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) > 0
    AND COALESCE(product.stock, 0) > 0
  ORDER BY product.created_at
  LIMIT 1;

  IF v_member IS NULL OR v_product.id IS NULL THEN
    RAISE EXCEPTION 'Verificación falló: faltan actor o producto de prueba';
  END IF;

  INSERT INTO public.ecommerce_stores(org_id, name, slug, is_active)
  VALUES (
    v_store.org_id,
    'ZZ Verificación surtido',
    'zz-assortment-' || substr(md5(clock_timestamp()::text), 1, 12),
    true
  )
  RETURNING id INTO v_test_store;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_member, 'role', 'authenticated')::text,
    true
  );

  -- El resolver sigue sirviendo al Core cuando no existe contexto de tienda.
  v_line := public.resolve_store_line(
    v_store.org_id, v_product.id, NULL, 1, NULL
  );
  IF COALESCE((v_line->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Verificación falló: el resolver del Core dejó de funcionar';
  END IF;

  PERFORM set_config('nerqia.store_id', v_test_store::text, true);

  INSERT INTO public.ecommerce_categories(org_id, store_id, name, slug)
  VALUES (
    v_store.org_id,
    v_store.id,
    'ZZ Categoría de otra vitrina',
    'zz-foreign-' || substr(md5(clock_timestamp()::text), 1, 12)
  )
  RETURNING slug INTO v_foreign_category;

  BEGIN
    PERFORM public.save_store_product_publications(
      v_test_store,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'visibility', 'published',
        'category_slug', v_foreign_category
      ))
    );
    RAISE EXCEPTION 'Verificación falló: aceptó una categoría privada de otra vitrina';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  SELECT count(*) INTO v_original_count
  FROM public.get_store_catalog_products(v_store.slug);
  SELECT count(*) INTO v_test_count
  FROM public.get_store_catalog_products(
    (SELECT slug FROM public.ecommerce_stores WHERE id = v_test_store)
  );

  IF v_original_count <> v_test_count THEN
    RAISE EXCEPTION 'Verificación falló: una vitrina nueva no hereda el catálogo';
  END IF;

  PERFORM public.save_store_product_publications(
    v_test_store,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'visibility', 'hidden'
    ))
  );

  SELECT count(*) INTO v_after_hide
  FROM public.get_store_catalog_products(
    (SELECT slug FROM public.ecommerce_stores WHERE id = v_test_store)
  );
  IF v_after_hide <> v_test_count - 1 THEN
    RAISE EXCEPTION 'Verificación falló: ocultar no aisló el producto de la segunda vitrina';
  END IF;
  v_line := public.resolve_store_line(
    v_store.org_id, v_product.id, NULL, 1, NULL
  );
  IF COALESCE((v_line->>'ok')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'Verificación falló: checkout aceptó un producto oculto';
  END IF;
  IF (SELECT count(*) FROM public.get_store_catalog_products(v_store.slug))
     <> v_original_count THEN
    RAISE EXCEPTION 'Verificación falló: el override contaminó la tienda original';
  END IF;

  v_expected_price := greatest(v_product.price + 137, 1);
  PERFORM public.save_store_product_publications(
    v_test_store,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'visibility', 'published',
      'price_ars', v_expected_price
    ))
  );

  SELECT sale_price_ars INTO v_test_price
  FROM public.get_store_catalog_products(
    (SELECT slug FROM public.ecommerce_stores WHERE id = v_test_store)
  )
  WHERE id = v_product.id;
  IF v_test_price IS DISTINCT FROM v_expected_price THEN
    RAISE EXCEPTION 'Verificación falló: el precio por vitrina no fue autoritativo';
  END IF;
  v_line := public.resolve_store_line(
    v_store.org_id, v_product.id, NULL, 1, NULL
  );
  IF COALESCE((v_line->>'ok')::boolean, false) IS NOT TRUE
     OR (v_line#>>'{line,unit_price}')::numeric IS DISTINCT FROM v_expected_price THEN
    RAISE EXCEPTION 'Verificación falló: checkout no respetó el precio de la vitrina';
  END IF;

  IF (public.get_store_assortment_summary(v_test_store)->>'published')::bigint
     <> v_test_count THEN
    RAISE EXCEPTION 'Verificación falló: el resumen no coincide con el catálogo';
  END IF;
END;
$verify_assortment$;

ROLLBACK;
