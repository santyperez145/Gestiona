-- Smoke transaccional de C22.1. Usa un owner/admin real para evaluar RLS y
-- permisos, pero ROLLBACK elimina producto, variante, Kardex y redirect.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_funciones_expuestas) <> 0 THEN
    RAISE EXCEPTION 'Hay funciones web sin contrato de seguridad vigente';
  END IF;
  IF to_regprocedure('public.get_store_assortment(uuid,text,text,integer,integer)') IS NULL
     OR to_regprocedure('public.get_store_assortment_summary(uuid)') IS NULL THEN
    RAISE EXCEPTION 'El editor de surtido perdió su contrato RPC';
  END IF;
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', membership.user_id, 'role', 'authenticated')::text,
  true
)
FROM public.memberships membership
WHERE membership.role IN ('owner', 'admin')
ORDER BY membership.created_at
LIMIT 1;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org uuid;
  v_store uuid;
  v_location uuid;
  v_handle text := 'zz-catalog-smoke-' || replace(gen_random_uuid()::text, '-', '');
  v_simple_handle text;
  v_stage jsonb;
  v_apply jsonb;
  v_batch uuid;
  v_product uuid;
  v_variant uuid;
BEGIN
  v_simple_handle := v_handle || '-simple';
  SELECT membership.org_id INTO v_org
  FROM public.memberships membership
  WHERE membership.user_id = auth.uid()
    AND membership.role IN ('owner', 'admin')
  ORDER BY membership.created_at
  LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'No hay owner/admin para el smoke de catálogo'; END IF;

  SELECT store.id INTO v_store
  FROM public.ecommerce_stores store
  WHERE store.org_id = v_org
  ORDER BY store.is_primary DESC, store.created_at
  LIMIT 1;
  SELECT location.id INTO v_location
  FROM public.locations location
  WHERE location.org_id = v_org AND location.active
  ORDER BY location.created_at
  LIMIT 1;

  v_stage := public.stage_catalog_migration(
    v_org,
    'smoke_shopify.csv',
    'csv',
    'shopify',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'ZZ Catalog migration smoke con variante',
        'external_key', v_handle,
        'source_path', '/products/' || v_handle,
        'sale_price_ars', 1000,
        'cost_usd', 0.5,
        'stock', 2,
        'image_urls', jsonb_build_array('https://example.com/catalog-smoke.jpg'),
        'tags', jsonb_build_array('smoke'),
        'published', true,
        'maneja_stock', true,
        'provided', jsonb_build_array(
          'name', 'sale_price_ars', 'cost_usd', 'stock', 'image_urls',
          'tags', 'published', 'maneja_stock'
        ),
        'variants', jsonb_build_array(jsonb_build_object(
          'external_key', v_handle || '::sku-smoke',
          'name', 'Única',
          'variant_type', 'Opción',
          'sku', 'ZZ-' || right(v_handle, 12),
          'price_override', 1000,
          'stock', 2,
          'provided', jsonb_build_array(
            'variant_type', 'sku', 'price_override', 'stock'
          )
        ))
      ),
      jsonb_build_object(
        'name', 'ZZ Catalog migration smoke simple',
        'external_key', v_simple_handle,
        'source_path', '/products/' || v_simple_handle,
        'sale_price_ars', 500,
        'stock', 3,
        'published', true,
        'maneja_stock', true,
        'provided', jsonb_build_array(
          'name', 'sale_price_ars', 'stock', 'published', 'maneja_stock'
        ),
        'variants', '[]'::jsonb
      )
    ),
    2,
    v_store,
    'replace',
    v_location,
    1000,
    0,
    50,
    false
  );
  IF NOT COALESCE((v_stage->>'ok')::boolean, false)
     OR (v_stage->>'valid')::integer <> 2
     OR (v_stage->>'variants')::integer <> 1 THEN
    RAISE EXCEPTION 'Staging inesperado: %', v_stage;
  END IF;

  v_batch := (v_stage->>'batch_id')::uuid;
  v_apply := public.apply_catalog_migration(v_batch, false);
  IF NOT COALESCE((v_apply->>'ok')::boolean, false)
     OR NOT COALESCE((v_apply->>'reconciled')::boolean, false)
     OR v_apply->>'status' <> 'completed'
     OR (v_apply->>'created')::integer <> 2
     OR (v_apply->>'variants_created')::integer <> 1
     OR (v_apply->>'stock_movements')::integer <> 2 THEN
    RAISE EXCEPTION 'Aplicación inesperada: %', v_apply;
  END IF;

  SELECT row.result_product_id INTO v_product
  FROM public.product_import_rows row
  WHERE row.batch_id = v_batch AND row.status = 'applied';
  SELECT identity.variant_id INTO v_variant
  FROM public.catalog_import_identities identity
  WHERE identity.org_id = v_org
    AND identity.source_system = 'shopify'
    AND identity.entity_type = 'variant'
    AND identity.external_key = v_handle || '::sku-smoke';

  IF v_product IS NULL OR v_variant IS NULL
     OR (SELECT stock FROM public.products WHERE id = v_product) <> 2
     OR (SELECT stock FROM public.product_variants WHERE id = v_variant) <> 2 THEN
    RAISE EXCEPTION 'Producto, variante o stock no reconciliado';
  END IF;
  IF v_store IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.store_url_redirects redirect
    WHERE redirect.store_id = v_store
      AND redirect.source_path = '/products/' || v_handle
      AND redirect.destination_path = '/producto/' || v_product::text
  ) THEN
    RAISE EXCEPTION 'No se creó el redirect de la tienda';
  END IF;
END;
$$;

ROLLBACK;
