-- C22.1 / Migración de catálogo con identidad de origen.
--
-- Extiende el staging existente en lugar de crear un segundo importador. El
-- navegador normaliza cada formato, pero el servidor valida, decide los
-- matches y aplica productos, variantes, stock, surtido y redirects en una
-- sola transacción.

BEGIN;

ALTER TABLE public.product_import_batches
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS destination_store_id uuid REFERENCES public.ecommerce_stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_created_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_updated_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redirect_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_applied_at timestamptz;

ALTER TABLE public.product_import_rows
  ADD COLUMN IF NOT EXISTS source_external_key text,
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS variant_created_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_updated_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.catalog_import_identities (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_system text NOT NULL CHECK (source_system IN ('shopify', 'tiendanube', 'empretienda', 'nerqia', 'generic')),
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'variant')),
  external_key text NOT NULL CHECK (char_length(external_key) BETWEEN 1 AND 500),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  last_batch_id uuid REFERENCES public.product_import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_system, entity_type, external_key),
  CHECK (
    (entity_type = 'product' AND variant_id IS NULL)
    OR (entity_type = 'variant' AND variant_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS catalog_import_identities_product_idx
  ON public.catalog_import_identities(product_id, source_system);
CREATE INDEX IF NOT EXISTS catalog_import_identities_variant_idx
  ON public.catalog_import_identities(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.store_url_redirects (
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_path text NOT NULL CHECK (
    char_length(source_path) BETWEEN 2 AND 500
    AND source_path LIKE '/%'
    AND source_path NOT LIKE '//%'
    AND source_path NOT LIKE '%?%'
    AND source_path NOT LIKE '%#%'
  ),
  destination_path text NOT NULL CHECK (
    char_length(destination_path) BETWEEN 2 AND 500
    AND destination_path LIKE '/%'
    AND destination_path NOT LIKE '//%'
  ),
  status_code integer NOT NULL DEFAULT 301 CHECK (status_code IN (301, 308)),
  import_batch_id uuid REFERENCES public.product_import_batches(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, source_path)
);

CREATE INDEX IF NOT EXISTS store_url_redirects_org_idx
  ON public.store_url_redirects(org_id, store_id);

ALTER TABLE public.catalog_import_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_url_redirects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read catalog import identities" ON public.catalog_import_identities;
CREATE POLICY "members read catalog import identities"
  ON public.catalog_import_identities FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "members read store url redirects" ON public.store_url_redirects;
CREATE POLICY "members read store url redirects"
  ON public.store_url_redirects FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE ALL ON public.catalog_import_identities, public.store_url_redirects
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalog_import_identities, public.store_url_redirects TO authenticated;

COMMENT ON TABLE public.catalog_import_identities IS
  'Identidad estable entre handles externos y el Business Core; evita duplicar al reimportar después de un cambio de nombre o SKU.';
COMMENT ON TABLE public.store_url_redirects IS
  'Redirects de rutas heredadas por vitrina. El destino siempre es una ruta relativa de la misma tienda.';

CREATE OR REPLACE FUNCTION public.stage_catalog_migration(
  p_org_id uuid,
  p_filename text,
  p_source_format text,
  p_source_system text,
  p_rows jsonb,
  p_source_row_count integer DEFAULT 0,
  p_destination_store_id uuid DEFAULT NULL,
  p_stock_mode text DEFAULT 'replace',
  p_location_id uuid DEFAULT NULL,
  p_exchange_rate numeric DEFAULT NULL,
  p_customs_percent numeric DEFAULT 0,
  p_default_margin_percent numeric DEFAULT 0,
  p_auto_fill_sale_price boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id uuid;
  v_core_rows jsonb;
  v_source jsonb;
  v_stage public.product_import_rows%ROWTYPE;
  v_index integer;
  v_variants jsonb;
  v_variant jsonb;
  v_images jsonb;
  v_errors text[];
  v_identity_product uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede preparar una migración de catálogo'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_system NOT IN ('shopify', 'tiendanube', 'empretienda', 'nerqia', 'generic') THEN
    RAISE EXCEPTION 'La plataforma de origen no es válida' USING ERRCODE = '22023';
  END IF;
  IF p_source_row_count < 0 OR p_source_row_count > 20000 THEN
    RAISE EXCEPTION 'La cantidad de filas de origen está fuera de rango' USING ERRCODE = '22023';
  END IF;
  IF p_destination_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ecommerce_stores store
    WHERE store.id = p_destination_store_id AND store.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La tienda de destino no pertenece a la organización'
      USING ERRCODE = '42501';
  END IF;

  -- Un producto con variantes mueve el stock por cada variante; quitar el
  -- agregado del payload evita contar esas unidades una segunda vez.
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(COALESCE(row.value->'variants', '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(row.value->'variants', '[]'::jsonb)) > 0
      THEN jsonb_set(
        (row.value - 'stock') || jsonb_build_object('source_stock_total', row.value->'stock'),
        '{provided}', COALESCE(row.value->'provided', '[]'::jsonb) - 'stock'
      )
      ELSE row.value
    END ORDER BY row.ordinality
  ) INTO v_core_rows
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS row(value, ordinality);

  v_result := public.stage_product_import(
    p_org_id, p_filename, p_source_format, v_core_rows, p_stock_mode,
    p_location_id, p_exchange_rate, p_customs_percent,
    p_default_margin_percent, p_auto_fill_sale_price
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN RETURN v_result; END IF;
  v_batch_id := (v_result->>'batch_id')::uuid;

  UPDATE public.product_import_batches
  SET source_system = p_source_system,
      destination_store_id = p_destination_store_id,
      source_row_count = p_source_row_count
  WHERE id = v_batch_id;

  FOR v_source, v_index IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    SELECT * INTO v_stage
    FROM public.product_import_rows
    WHERE batch_id = v_batch_id AND row_number = v_index
    FOR UPDATE;

    v_errors := v_stage.validation_errors;
    v_variants := COALESCE(v_source->'variants', '[]'::jsonb);
    v_images := COALESCE(v_source->'image_urls', '[]'::jsonb);

    IF NULLIF(v_source->>'external_key', '') IS NOT NULL
       AND char_length(v_source->>'external_key') > 500 THEN
      v_errors := array_append(v_errors, 'El identificador externo supera 500 caracteres');
    END IF;
    IF NULLIF(v_source->>'source_path', '') IS NOT NULL AND (
      char_length(v_source->>'source_path') NOT BETWEEN 2 AND 500
      OR v_source->>'source_path' NOT LIKE '/%'
      OR v_source->>'source_path' LIKE '//%'
      OR v_source->>'source_path' LIKE '%?%'
      OR v_source->>'source_path' LIKE '%#%'
    ) THEN
      v_errors := array_append(v_errors, 'La URL de origen no es una ruta segura');
    END IF;
    IF jsonb_typeof(v_images) <> 'array' THEN
      v_errors := array_append(v_errors, 'Las imágenes deben ser una lista de hasta 50 URLs');
      v_images := '[]'::jsonb;
    ELSIF jsonb_array_length(v_images) > 50 THEN
      v_errors := array_append(v_errors, 'Las imágenes deben ser una lista de hasta 50 URLs');
      v_images := '[]'::jsonb;
    ELSIF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_images) image(url)
      WHERE char_length(image.url) > 2048
         OR image.url !~ '^https://[^[:space:]@]+$'
    ) THEN
      v_errors := array_append(v_errors, 'Cada imagen debe usar una URL HTTPS pública y válida');
    END IF;
    IF v_source ? 'tags' THEN
      IF jsonb_typeof(v_source->'tags') <> 'array' THEN
        v_errors := array_append(v_errors, 'Los tags deben ser una lista de hasta 250 valores breves');
      ELSIF jsonb_array_length(v_source->'tags') > 250 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_source->'tags') tag(value)
        WHERE char_length(tag.value) > 120
      ) THEN
        v_errors := array_append(v_errors, 'Los tags deben ser una lista de hasta 250 valores breves');
      END IF;
    END IF;
    IF v_source ? 'weight_kg' AND (
      public.product_import_number(v_source->'weight_kg') IS NULL
      OR public.product_import_number(v_source->'weight_kg') < 0
      OR public.product_import_number(v_source->'weight_kg') > 1000000
    ) THEN v_errors := array_append(v_errors, 'El peso no es válido'); END IF;
    IF v_source ? 'height_cm' AND (
      public.product_import_number(v_source->'height_cm') IS NULL
      OR public.product_import_number(v_source->'height_cm') < 0
      OR public.product_import_number(v_source->'height_cm') > 1000000
    ) THEN v_errors := array_append(v_errors, 'El alto no es válido'); END IF;
    IF v_source ? 'width_cm' AND (
      public.product_import_number(v_source->'width_cm') IS NULL
      OR public.product_import_number(v_source->'width_cm') < 0
      OR public.product_import_number(v_source->'width_cm') > 1000000
    ) THEN v_errors := array_append(v_errors, 'El ancho no es válido'); END IF;
    IF v_source ? 'length_cm' AND (
      public.product_import_number(v_source->'length_cm') IS NULL
      OR public.product_import_number(v_source->'length_cm') < 0
      OR public.product_import_number(v_source->'length_cm') > 1000000
    ) THEN v_errors := array_append(v_errors, 'El largo no es válido'); END IF;
    IF jsonb_typeof(v_variants) <> 'array' THEN
      v_errors := array_append(v_errors, 'Las variantes deben ser una lista de hasta 250 opciones');
      v_variants := '[]'::jsonb;
    ELSIF jsonb_array_length(v_variants) > 250 THEN
      v_errors := array_append(v_errors, 'Las variantes deben ser una lista de hasta 250 opciones');
      v_variants := '[]'::jsonb;
    ELSE
      FOR v_variant IN SELECT value FROM jsonb_array_elements(v_variants)
      LOOP
        IF jsonb_typeof(v_variant) <> 'object'
           OR char_length(btrim(COALESCE(v_variant->>'name', ''))) NOT BETWEEN 1 AND 200 THEN
          v_errors := array_append(v_errors, 'Cada variante necesita un nombre de hasta 200 caracteres');
          CONTINUE;
        END IF;
        IF NULLIF(v_variant->>'external_key', '') IS NOT NULL
           AND char_length(v_variant->>'external_key') > 500 THEN
          v_errors := array_append(v_errors, 'Un identificador de variante supera 500 caracteres');
        END IF;
        IF v_variant ? 'stock' AND (
          public.product_import_number(v_variant->'stock') IS NULL
          OR public.product_import_number(v_variant->'stock') < 0
          OR public.product_import_number(v_variant->'stock') <> trunc(public.product_import_number(v_variant->'stock'))
        ) THEN
          v_errors := array_append(v_errors, 'El stock de una variante no es un entero válido');
        END IF;
        IF v_variant ? 'price_override' AND (
          public.product_import_number(v_variant->'price_override') IS NULL
          OR public.product_import_number(v_variant->'price_override') <= 0
        ) THEN
          v_errors := array_append(v_errors, 'El precio de una variante no es válido');
        END IF;
        IF NULLIF(v_variant->>'image_url', '') IS NOT NULL
           AND (char_length(v_variant->>'image_url') > 2048 OR v_variant->>'image_url' !~ '^https://[^[:space:]@]+$') THEN
          v_errors := array_append(v_errors, 'La imagen de una variante no es una URL HTTPS válida');
        END IF;
      END LOOP;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_variants) variant
        GROUP BY lower(btrim(variant->>'name')) HAVING count(*) > 1
      ) THEN
        v_errors := array_append(v_errors, 'Hay variantes repetidas dentro del producto');
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_variants) variant
        WHERE NULLIF(btrim(variant->>'sku'), '') IS NOT NULL
        GROUP BY lower(btrim(variant->>'sku')) HAVING count(*) > 1
      ) THEN
        v_errors := array_append(v_errors, 'Hay SKU de variantes repetidos dentro del producto');
      END IF;
    END IF;

    UPDATE public.product_import_rows row SET
      normalized = row.normalized || jsonb_strip_nulls(jsonb_build_object(
        'external_key', NULLIF(v_source->>'external_key', ''),
        'source_path', NULLIF(v_source->>'source_path', ''),
        'image_urls', CASE WHEN v_source ? 'image_urls' THEN v_images ELSE NULL END,
        'tags', CASE WHEN v_source ? 'tags' THEN v_source->'tags' ELSE NULL END,
        'weight_kg', CASE WHEN v_source ? 'weight_kg' THEN v_source->'weight_kg' ELSE NULL END,
        'height_cm', CASE WHEN v_source ? 'height_cm' THEN v_source->'height_cm' ELSE NULL END,
        'width_cm', CASE WHEN v_source ? 'width_cm' THEN v_source->'width_cm' ELSE NULL END,
        'length_cm', CASE WHEN v_source ? 'length_cm' THEN v_source->'length_cm' ELSE NULL END,
        'is_active', CASE WHEN v_source ? 'is_active' THEN v_source->'is_active' ELSE NULL END,
        'published', CASE WHEN v_source ? 'published' THEN v_source->'published' ELSE NULL END,
        'maneja_stock', CASE WHEN v_source ? 'maneja_stock' THEN v_source->'maneja_stock' ELSE NULL END,
        'variants', CASE WHEN v_source ? 'variants' THEN v_variants ELSE NULL END,
        'source_stock_total', CASE WHEN v_source ? 'stock' THEN v_source->'stock' ELSE NULL END
      )),
      source_external_key = NULLIF(left(v_source->>'external_key', 500), ''),
      source_path = NULLIF(left(v_source->>'source_path', 500), ''),
      validation_errors = v_errors,
      action = CASE WHEN cardinality(v_errors) > 0 THEN 'invalid' ELSE row.action END
    WHERE row.id = v_stage.id;

    IF NULLIF(v_source->>'external_key', '') IS NOT NULL THEN
      SELECT identity.product_id INTO v_identity_product
      FROM public.catalog_import_identities identity
      WHERE identity.org_id = p_org_id
        AND identity.source_system = p_source_system
        AND identity.entity_type = 'product'
        AND identity.external_key = v_source->>'external_key';

      IF v_identity_product IS NOT NULL
         AND v_stage.target_product_id IS NOT NULL
         AND v_identity_product <> v_stage.target_product_id THEN
        UPDATE public.product_import_rows SET
          action = 'invalid',
          validation_errors = array_append(validation_errors, 'La identidad externa y el SKU apuntan a productos distintos')
        WHERE id = v_stage.id;
      ELSIF v_identity_product IS NOT NULL AND cardinality(v_errors) = 0 THEN
        UPDATE public.product_import_rows SET
          action = 'update', target_product_id = v_identity_product,
          match_key = p_source_system || ':' || lower(v_source->>'external_key')
        WHERE id = v_stage.id;
      ELSE
        UPDATE public.product_import_rows SET
          match_key = p_source_system || ':' || lower(v_source->>'external_key')
        WHERE id = v_stage.id;
      END IF;
    END IF;
  END LOOP;

  WITH duplicates AS (
    SELECT lower(source_external_key) AS normalized_key
    FROM public.product_import_rows
    WHERE batch_id = v_batch_id AND source_external_key IS NOT NULL
    GROUP BY lower(source_external_key)
    HAVING count(*) > 1
  )
  UPDATE public.product_import_rows row SET
    action = 'invalid',
    validation_errors = array_append(row.validation_errors, 'El identificador externo está repetido dentro del archivo')
  FROM duplicates duplicate
  WHERE row.batch_id = v_batch_id
    AND lower(row.source_external_key) = duplicate.normalized_key
    AND NOT ('El identificador externo está repetido dentro del archivo' = ANY(row.validation_errors));

  UPDATE public.product_import_batches batch SET
    valid_rows = summary.valid_rows,
    invalid_rows = summary.invalid_rows,
    create_rows = summary.create_rows,
    update_rows = summary.update_rows,
    variant_rows = summary.variant_rows,
    image_rows = summary.image_rows
  FROM (
    SELECT
      count(*) FILTER (WHERE action IN ('create', 'update'))::integer AS valid_rows,
      count(*) FILTER (WHERE action = 'invalid')::integer AS invalid_rows,
      count(*) FILTER (WHERE action = 'create')::integer AS create_rows,
      count(*) FILTER (WHERE action = 'update')::integer AS update_rows,
      COALESCE(sum(jsonb_array_length(COALESCE(normalized->'variants', '[]'::jsonb)))
        FILTER (WHERE action IN ('create', 'update')), 0)::integer AS variant_rows,
      COALESCE(sum(jsonb_array_length(COALESCE(normalized->'image_urls', '[]'::jsonb)))
        FILTER (WHERE action IN ('create', 'update')), 0)::integer AS image_rows
    FROM public.product_import_rows WHERE batch_id = v_batch_id
  ) summary
  WHERE batch.id = v_batch_id;

  RETURN (
    SELECT jsonb_build_object(
      'ok', true, 'reused', COALESCE((v_result->>'reused')::boolean, false),
      'batch_id', batch.id, 'status', batch.status,
      'total', batch.total_rows, 'valid', batch.valid_rows,
      'invalid', batch.invalid_rows, 'creates', batch.create_rows,
      'updates', batch.update_rows, 'variants', batch.variant_rows,
      'images', batch.image_rows, 'source', batch.source_system
    ) FROM public.product_import_batches batch WHERE batch.id = v_batch_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_catalog_migration(
  p_batch_id uuid,
  p_skip_invalid boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.product_import_batches%ROWTYPE;
  v_result jsonb;
  v_stage public.product_import_rows%ROWTYPE;
  v_data jsonb;
  v_provided jsonb;
  v_product_id uuid;
  v_product_name text;
  v_variant jsonb;
  v_variant_id uuid;
  v_identity_variant uuid;
  v_sku_variant uuid;
  v_name_variant uuid;
  v_variant_name text;
  v_variant_provided jsonb;
  v_variant_before integer;
  v_variant_after integer;
  v_variant_delta integer;
  v_variant_created integer := 0;
  v_variant_updated integer := 0;
  v_row_variant_created integer;
  v_row_variant_updated integer;
  v_variant_applied integer := 0;
  v_redirects integer := 0;
  v_images text[];
  v_tags text[];
  v_visibility text;
BEGIN
  SELECT * INTO v_batch
  FROM public.product_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente'; END IF;
  IF v_actor IS NULL OR NOT public.has_org_role(v_batch.org_id, v_actor, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede aplicar una migración de catálogo'
      USING ERRCODE = '42501';
  END IF;
  IF v_batch.catalog_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'batch_id', v_batch.id, 'status', v_batch.status,
      'created', v_batch.created_count, 'updated', v_batch.updated_count,
      'variants_created', v_batch.variant_created_count,
      'variants_updated', v_batch.variant_updated_count,
      'stock_movements', v_batch.stock_movements_count,
      'redirects', v_batch.redirect_count, 'skipped', v_batch.skipped_count,
      'reconciled', true
    );
  END IF;

  v_result := public.apply_product_import(p_batch_id, p_skip_invalid);
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN RETURN v_result; END IF;
  v_batch.stock_movements_count := COALESCE((v_result->>'stock_movements')::integer, 0);

  FOR v_stage IN
    SELECT * FROM public.product_import_rows
    WHERE batch_id = v_batch.id AND status = 'applied'
    ORDER BY row_number FOR UPDATE
  LOOP
    v_data := v_stage.normalized;
    v_provided := COALESCE(v_data->'provided', '[]'::jsonb);
    v_product_id := v_stage.result_product_id;
    v_row_variant_created := 0;
    v_row_variant_updated := 0;

    SELECT product.name INTO v_product_name
    FROM public.products product
    WHERE product.id = v_product_id AND product.org_id = v_batch.org_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto aplicado de la fila % no existe', v_stage.row_number;
    END IF;

    IF v_provided ? 'image_urls' THEN
      SELECT COALESCE(array_agg(image.url ORDER BY image.ordinality), ARRAY[]::text[])
      INTO v_images
      FROM jsonb_array_elements_text(COALESCE(v_data->'image_urls', '[]'::jsonb))
        WITH ORDINALITY AS image(url, ordinality);
    END IF;
    IF v_provided ? 'tags' THEN
      SELECT COALESCE(array_agg(tag.value ORDER BY tag.ordinality), ARRAY[]::text[])
      INTO v_tags
      FROM jsonb_array_elements_text(COALESCE(v_data->'tags', '[]'::jsonb))
        WITH ORDINALITY AS tag(value, ordinality);
    END IF;

    UPDATE public.products product SET
      image_urls = CASE WHEN v_provided ? 'image_urls' THEN v_images ELSE product.image_urls END,
      image_url = CASE WHEN v_provided ? 'image_urls' THEN v_images[1] ELSE product.image_url END,
      tags = CASE WHEN v_provided ? 'tags' THEN v_tags ELSE product.tags END,
      weight_kg = CASE WHEN v_provided ? 'weight_kg' THEN public.product_import_number(v_data->'weight_kg') ELSE product.weight_kg END,
      height_cm = CASE WHEN v_provided ? 'height_cm' THEN public.product_import_number(v_data->'height_cm') ELSE product.height_cm END,
      width_cm = CASE WHEN v_provided ? 'width_cm' THEN public.product_import_number(v_data->'width_cm') ELSE product.width_cm END,
      length_cm = CASE WHEN v_provided ? 'length_cm' THEN public.product_import_number(v_data->'length_cm') ELSE product.length_cm END,
      is_active = CASE WHEN v_provided ? 'is_active' THEN (v_data->>'is_active')::boolean ELSE product.is_active END,
      maneja_stock = CASE WHEN v_provided ? 'maneja_stock' THEN (v_data->>'maneja_stock')::boolean ELSE product.maneja_stock END
    WHERE product.id = v_product_id AND product.org_id = v_batch.org_id;

    IF v_stage.source_external_key IS NOT NULL THEN
      INSERT INTO public.catalog_import_identities(
        org_id, source_system, entity_type, external_key,
        product_id, variant_id, last_batch_id, updated_at
      ) VALUES (
        v_batch.org_id, v_batch.source_system, 'product', v_stage.source_external_key,
        v_product_id, NULL, v_batch.id, now()
      )
      ON CONFLICT (org_id, source_system, entity_type, external_key) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        variant_id = NULL,
        last_batch_id = EXCLUDED.last_batch_id,
        updated_at = now();
    END IF;

    FOR v_variant IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_data->'variants', '[]'::jsonb))
    LOOP
      v_variant_id := NULL;
      v_identity_variant := NULL;
      v_sku_variant := NULL;
      v_name_variant := NULL;
      v_variant_name := left(btrim(v_variant->>'name'), 200);
      v_variant_provided := COALESCE(v_variant->'provided', '[]'::jsonb);

      IF NULLIF(v_variant->>'external_key', '') IS NOT NULL THEN
        SELECT identity.variant_id INTO v_identity_variant
        FROM public.catalog_import_identities identity
        WHERE identity.org_id = v_batch.org_id
          AND identity.source_system = v_batch.source_system
          AND identity.entity_type = 'variant'
          AND identity.external_key = v_variant->>'external_key';
        IF v_identity_variant IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.product_variants existing
          WHERE existing.id = v_identity_variant
            AND existing.product_id = v_product_id
            AND existing.org_id = v_batch.org_id
        ) THEN
          RAISE EXCEPTION 'La identidad de variante de la fila % pertenece a otro producto', v_stage.row_number;
        END IF;
      END IF;
      IF NULLIF(btrim(v_variant->>'sku'), '') IS NOT NULL THEN
        SELECT min(existing.id::text)::uuid INTO v_sku_variant
        FROM public.product_variants existing
        WHERE existing.product_id = v_product_id
          AND existing.org_id = v_batch.org_id
          AND lower(COALESCE(existing.sku, '')) = lower(btrim(v_variant->>'sku'));
      END IF;
      SELECT min(existing.id::text)::uuid INTO v_name_variant
      FROM public.product_variants existing
      WHERE existing.product_id = v_product_id
        AND existing.org_id = v_batch.org_id
        AND lower(btrim(existing.variant_name)) = lower(v_variant_name);

      IF v_identity_variant IS NOT NULL AND v_sku_variant IS NOT NULL
         AND v_identity_variant <> v_sku_variant THEN
        RAISE EXCEPTION 'La identidad y el SKU de una variante apuntan a filas distintas';
      END IF;
      IF COALESCE(v_identity_variant, v_sku_variant) IS NOT NULL
         AND v_name_variant IS NOT NULL
         AND COALESCE(v_identity_variant, v_sku_variant) <> v_name_variant THEN
        RAISE EXCEPTION 'El nombre y el SKU de una variante apuntan a filas distintas';
      END IF;
      v_variant_id := COALESCE(v_identity_variant, v_sku_variant, v_name_variant);

      IF v_variant_id IS NULL THEN
        INSERT INTO public.product_variants(
          product_id, user_id, org_id, variant_name, variant_type,
          stock, sku, barcode, price_override, image_url, active
        ) VALUES (
          v_product_id, v_actor, v_batch.org_id, v_variant_name,
          left(COALESCE(NULLIF(btrim(v_variant->>'variant_type'), ''), 'variante'), 120),
          0, NULLIF(left(btrim(v_variant->>'sku'), 120), ''),
          NULLIF(left(btrim(v_variant->>'barcode'), 160), ''),
          public.product_import_number(v_variant->'price_override'),
          NULLIF(left(btrim(v_variant->>'image_url'), 2048), ''), true
        ) RETURNING id INTO v_variant_id;
        v_variant_created := v_variant_created + 1;
        v_row_variant_created := v_row_variant_created + 1;
      ELSE
        UPDATE public.product_variants existing SET
          variant_name = v_variant_name,
          variant_type = CASE WHEN v_variant_provided ? 'variant_type'
            THEN left(COALESCE(NULLIF(btrim(v_variant->>'variant_type'), ''), 'variante'), 120)
            ELSE existing.variant_type END,
          sku = CASE WHEN v_variant_provided ? 'sku' THEN NULLIF(left(btrim(v_variant->>'sku'), 120), '') ELSE existing.sku END,
          barcode = CASE WHEN v_variant_provided ? 'barcode' THEN NULLIF(left(btrim(v_variant->>'barcode'), 160), '') ELSE existing.barcode END,
          price_override = CASE WHEN v_variant_provided ? 'price_override'
            THEN public.product_import_number(v_variant->'price_override') ELSE existing.price_override END,
          image_url = CASE WHEN v_variant_provided ? 'image_url'
            THEN NULLIF(left(btrim(v_variant->>'image_url'), 2048), '') ELSE existing.image_url END,
          active = true
        WHERE existing.id = v_variant_id
          AND existing.product_id = v_product_id
          AND existing.org_id = v_batch.org_id;
        v_variant_updated := v_variant_updated + 1;
        v_row_variant_updated := v_row_variant_updated + 1;
      END IF;

      IF v_batch.stock_mode = 'replace' AND v_variant_provided ? 'stock' THEN
        IF v_batch.location_id IS NULL THEN
          SELECT COALESCE(existing.stock, 0) INTO v_variant_before
          FROM public.product_variants existing WHERE existing.id = v_variant_id;
        ELSE
          SELECT COALESCE(stock.stock, 0) INTO v_variant_before
          FROM public.location_variant_stock stock
          WHERE stock.org_id = v_batch.org_id
            AND stock.location_id = v_batch.location_id
            AND stock.product_id = v_product_id
            AND stock.variant_id = v_variant_id;
          v_variant_before := COALESCE(v_variant_before, 0);
        END IF;
        v_variant_after := COALESCE(public.product_import_number(v_variant->'stock')::integer, 0);
        v_variant_delta := v_variant_after - v_variant_before;
        IF v_variant_delta <> 0 THEN
          PERFORM public.record_stock_movement(
            v_batch.org_id, v_product_id, v_variant_id,
            v_product_name, v_variant_name, 'adjustment', v_variant_delta,
            'product_import', v_batch.id,
            NULLIF(v_data->>'cost_usd', '')::numeric,
            public.product_import_number(v_variant->'price_override'),
            'Migración aprobada: ' || v_batch.filename,
            v_actor, v_batch.location_id
          );
          v_batch.stock_movements_count := v_batch.stock_movements_count + 1;
        END IF;
      END IF;

      IF NULLIF(v_variant->>'external_key', '') IS NOT NULL THEN
        INSERT INTO public.catalog_import_identities(
          org_id, source_system, entity_type, external_key,
          product_id, variant_id, last_batch_id, updated_at
        ) VALUES (
          v_batch.org_id, v_batch.source_system, 'variant', v_variant->>'external_key',
          v_product_id, v_variant_id, v_batch.id, now()
        )
        ON CONFLICT (org_id, source_system, entity_type, external_key) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          variant_id = EXCLUDED.variant_id,
          last_batch_id = EXCLUDED.last_batch_id,
          updated_at = now();
      END IF;
      v_variant_applied := v_variant_applied + 1;
    END LOOP;

    UPDATE public.product_import_rows SET
      variant_created_count = v_row_variant_created,
      variant_updated_count = v_row_variant_updated
    WHERE id = v_stage.id;

    IF v_batch.destination_store_id IS NOT NULL THEN
      v_visibility := CASE
        WHEN v_provided ? 'published' AND NOT (v_data->>'published')::boolean THEN 'hidden'
        ELSE 'published'
      END;
      INSERT INTO public.store_product_publications(
        store_id, product_id, org_id, visibility, updated_by
      ) VALUES (
        v_batch.destination_store_id, v_product_id, v_batch.org_id, v_visibility, v_actor
      )
      ON CONFLICT (store_id, product_id) DO UPDATE SET
        visibility = EXCLUDED.visibility,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

      IF v_stage.action = 'create' THEN
        INSERT INTO public.store_product_publications(
          store_id, product_id, org_id, visibility, updated_by
        )
        SELECT store.id, v_product_id, v_batch.org_id, 'hidden', v_actor
        FROM public.ecommerce_stores store
        WHERE store.org_id = v_batch.org_id
          AND store.id <> v_batch.destination_store_id
        ON CONFLICT (store_id, product_id) DO NOTHING;
      END IF;

      IF v_stage.source_path IS NOT NULL THEN
        INSERT INTO public.store_url_redirects(
          store_id, org_id, source_path, destination_path,
          status_code, import_batch_id, created_by, updated_at
        ) VALUES (
          v_batch.destination_store_id, v_batch.org_id,
          regexp_replace(v_stage.source_path, '/+$', ''),
          '/producto/' || v_product_id::text,
          301, v_batch.id, v_actor, now()
        )
        ON CONFLICT (store_id, source_path) DO UPDATE SET
          destination_path = EXCLUDED.destination_path,
          status_code = EXCLUDED.status_code,
          import_batch_id = EXCLUDED.import_batch_id,
          updated_at = now();
        v_redirects := v_redirects + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_variant_applied <> v_batch.variant_rows THEN
    RAISE EXCEPTION 'Reconciliación de variantes fallida: % aplicadas de %',
      v_variant_applied, v_batch.variant_rows;
  END IF;

  UPDATE public.product_import_batches SET
    variant_created_count = v_variant_created,
    variant_updated_count = v_variant_updated,
    stock_movements_count = v_batch.stock_movements_count,
    redirect_count = v_redirects,
    catalog_applied_at = now()
  WHERE id = v_batch.id;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false, 'batch_id', v_batch.id, 'status', v_result->>'status',
    'created', (v_result->>'created')::integer,
    'updated', (v_result->>'updated')::integer,
    'variants_created', v_variant_created,
    'variants_updated', v_variant_updated,
    'stock_movements', v_batch.stock_movements_count,
    'redirects', v_redirects,
    'skipped', (v_result->>'skipped')::integer,
    'reconciled', v_variant_applied = v_batch.variant_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_store_url_redirect(
  p_slug text,
  p_path text
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_path text := regexp_replace(NULLIF(btrim(COALESCE(p_path, '')), ''), '/+$', '');
  v_destination text;
BEGIN
  IF char_length(COALESCE(p_slug, '')) NOT BETWEEN 1 AND 80
     OR char_length(COALESCE(v_path, '')) NOT BETWEEN 2 AND 500
     OR v_path NOT LIKE '/%'
     OR v_path LIKE '//%'
     OR v_path LIKE '%?%'
     OR v_path LIKE '%#%' THEN
    RETURN NULL;
  END IF;

  SELECT redirect.destination_path INTO v_destination
  FROM public.store_url_redirects redirect
  JOIN public.ecommerce_stores store
    ON store.id = redirect.store_id
   AND store.org_id = redirect.org_id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND store.published_at IS NOT NULL
    AND redirect.source_path = v_path
    AND redirect.destination_path <> v_path
  LIMIT 1;

  RETURN v_destination;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_catalog_migration(uuid,text,text,text,jsonb,integer,uuid,text,uuid,numeric,numeric,numeric,boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_catalog_migration(uuid,boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_store_url_redirect(text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_catalog_migration(uuid,text,text,text,jsonb,integer,uuid,text,uuid,numeric,numeric,numeric,boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_catalog_migration(uuid,boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_store_url_redirect(text,text)
  TO anon, authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale,
  definition_hash, reviewed_on
)
SELECT
  'resolve_store_url_redirect', 'p_slug text, p_path text', 'public_storefront',
  'Resuelve una ruta heredada dentro de la misma tienda sin exponer catálogo ni datos privados.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-04'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'resolve_store_url_redirect'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_slug text, p_path text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.store_url_redirects', 'SELECT')
     OR has_table_privilege('authenticated', 'public.store_url_redirects', 'INSERT')
     OR has_table_privilege('authenticated', 'public.catalog_import_identities', 'UPDATE') THEN
    RAISE EXCEPTION 'Las tablas de migración no pueden escribirse desde el navegador ni leerse como anon';
  END IF;
  IF NOT has_function_privilege(
    'anon', 'public.resolve_store_url_redirect(text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'El storefront no puede resolver redirects heredados';
  END IF;
END;
$$;

COMMIT;
