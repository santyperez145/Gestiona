-- C21.2 / Surtido multi-tienda.
--
-- Un producto sigue perteneciendo una sola vez al Business Core. Esta tabla
-- guarda únicamente las decisiones de publicación de cada vitrina. Sin fila,
-- el producto hereda catálogo, precio, categoría y destacado del Core; es el
-- default compatible con las tiendas que ya estaban vendiendo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_product_publications (
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'published'
    CHECK (visibility IN ('published', 'hidden')),
  price_ars numeric,
  compare_at_price_ars numeric,
  category_slug text,
  featured boolean,
  sort_order integer,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id),
  CHECK (price_ars IS NULL OR (price_ars > 0 AND price_ars <= 999999999999)),
  CHECK (
    compare_at_price_ars IS NULL
    OR (compare_at_price_ars > 0 AND compare_at_price_ars <= 999999999999)
  ),
  CHECK (
    price_ars IS NULL OR compare_at_price_ars IS NULL
    OR compare_at_price_ars > price_ars
  ),
  CHECK (category_slug IS NULL OR char_length(category_slug) BETWEEN 1 AND 120),
  CHECK (sort_order IS NULL OR sort_order BETWEEN 0 AND 2147483647)
);

CREATE INDEX IF NOT EXISTS store_product_publications_org_store_idx
  ON public.store_product_publications(org_id, store_id, visibility, sort_order);
CREATE INDEX IF NOT EXISTS store_product_publications_product_idx
  ON public.store_product_publications(product_id, store_id);

CREATE OR REPLACE FUNCTION public.validate_store_product_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store_org uuid;
  v_product_org uuid;
BEGIN
  SELECT org_id INTO v_store_org
  FROM public.ecommerce_stores
  WHERE id = NEW.store_id;

  SELECT org_id INTO v_product_org
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_store_org IS NULL OR v_product_org IS NULL
     OR NEW.org_id <> v_store_org OR NEW.org_id <> v_product_org THEN
    RAISE EXCEPTION 'La tienda y el producto deben pertenecer a la misma organización'
      USING ERRCODE = '23514';
  END IF;

  NEW.category_slug := NULLIF(btrim(NEW.category_slug), '');
  IF NEW.category_slug IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.ecommerce_categories category
    WHERE category.org_id = NEW.org_id
      AND category.slug = NEW.category_slug
      AND (category.store_id IS NULL OR category.store_id = NEW.store_id)
  ) THEN
    RAISE EXCEPTION 'La categoría elegida no pertenece a la organización'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_store_product_publication
  ON public.store_product_publications;
CREATE TRIGGER trg_validate_store_product_publication
  BEFORE INSERT OR UPDATE ON public.store_product_publications
  FOR EACH ROW EXECUTE FUNCTION public.validate_store_product_publication();

REVOKE ALL ON FUNCTION public.validate_store_product_publication()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.store_product_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_product_publications_member_read"
  ON public.store_product_publications;
CREATE POLICY "store_product_publications_member_read"
  ON public.store_product_publications
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "store_product_publications_catalog_write"
  ON public.store_product_publications;
CREATE POLICY "store_product_publications_catalog_write"
  ON public.store_product_publications
  FOR ALL TO authenticated
  USING (
    public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin', 'manager'])
  )
  WITH CHECK (
    public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin', 'manager'])
  );

REVOKE ALL ON public.store_product_publications FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_product_publications
  TO authenticated;

COMMENT ON TABLE public.store_product_publications IS
  'Overrides de surtido por vitrina. Producto, variantes, costo y stock siguen en el Business Core.';

-- Lectura paginada del editor. No devuelve costo, margen ni secretos.
DROP FUNCTION IF EXISTS public.get_store_assortment(
  uuid, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.get_store_assortment(
  p_store_id uuid,
  p_query text DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  product_id uuid,
  name text,
  brand text,
  image_url text,
  core_category text,
  effective_category text,
  core_price_ars numeric,
  core_discount_price_ars numeric,
  override_price_ars numeric,
  override_compare_at_price_ars numeric,
  override_category_slug text,
  featured_override boolean,
  effective_price_ars numeric,
  effective_compare_at_price_ars numeric,
  stock integer,
  active boolean,
  visibility text,
  featured boolean,
  sort_order integer,
  customized boolean,
  has_variants boolean,
  sellable boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_query text := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_filter text := lower(COALESCE(p_filter, 'all'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT store.org_id INTO v_org
  FROM public.ecommerce_stores store
  WHERE store.id = p_store_id;

  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado para consultar el surtido'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(v_query, '')) > 120
     OR v_filter NOT IN ('all', 'published', 'hidden', 'customized', 'unavailable')
     OR v_offset > 1000000 THEN
    RAISE EXCEPTION 'Los filtros del surtido no son válidos'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH assortment AS (
    SELECT
      product.id AS product_id,
      product.name,
      product.brand,
      product.image_url,
      product.category AS core_category,
      COALESCE(publication.category_slug, product.category) AS effective_category,
      product.sale_price_ars AS core_price_ars,
      product.discount_price_ars AS core_discount_price_ars,
      publication.price_ars AS override_price_ars,
      publication.compare_at_price_ars AS override_compare_at_price_ars,
      publication.category_slug AS override_category_slug,
      publication.featured AS featured_override,
      CASE
        WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
      END AS effective_price_ars,
      CASE
        WHEN publication.price_ars IS NOT NULL THEN publication.compare_at_price_ars
        WHEN COALESCE(product.discount_price_ars, 0) > 0
          AND product.discount_price_ars < product.sale_price_ars
          THEN product.sale_price_ars
        ELSE NULL::numeric
      END AS effective_compare_at_price_ars,
      product.stock,
      COALESCE(product.is_active, true) AS active,
      COALESCE(publication.visibility, 'published') AS visibility,
      COALESCE(publication.featured, product.featured, false) AS featured,
      publication.sort_order,
      publication.product_id IS NOT NULL AS customized,
      EXISTS (
        SELECT 1 FROM public.product_variants variant
        WHERE variant.product_id = product.id
          AND variant.org_id = product.org_id
          AND variant.active
      ) AS has_variants,
      COALESCE(product.is_active, true)
        AND COALESCE(publication.visibility, 'published') = 'published'
        AND CASE
          WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
          ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        END > 0 AS sellable
    FROM public.products product
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = p_store_id
     AND publication.product_id = product.id
    WHERE product.org_id = v_org
      AND (
        v_query IS NULL
        OR product.name ILIKE '%' || v_query || '%'
        OR product.brand ILIKE '%' || v_query || '%'
      )
  ), filtered AS (
    SELECT *
    FROM assortment row
    WHERE v_filter = 'all'
       OR (v_filter = 'published' AND row.visibility = 'published')
       OR (v_filter = 'hidden' AND row.visibility = 'hidden')
       OR (v_filter = 'customized' AND row.customized)
       OR (v_filter = 'unavailable' AND NOT row.sellable)
  )
  SELECT
    row.product_id, row.name, row.brand, row.image_url,
    row.core_category, row.effective_category,
    row.core_price_ars, row.core_discount_price_ars,
    row.override_price_ars, row.override_compare_at_price_ars,
    row.override_category_slug, row.featured_override,
    row.effective_price_ars, row.effective_compare_at_price_ars,
    row.stock, row.active, row.visibility, row.featured, row.sort_order,
    row.customized, row.has_variants, row.sellable,
    count(*) OVER () AS total_count
  FROM filtered row
  ORDER BY
    (row.visibility = 'published') DESC,
    row.sort_order ASC NULLS LAST,
    row.name ASC,
    row.product_id ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_assortment(uuid, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_assortment(uuid, text, text, integer, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_store_assortment_summary(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_result jsonb;
BEGIN
  SELECT store.org_id INTO v_org
  FROM public.ecommerce_stores store
  WHERE store.id = p_store_id;

  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado para consultar el surtido'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'published', count(*) FILTER (
      WHERE COALESCE(publication.visibility, 'published') = 'published'
        AND COALESCE(product.is_active, true)
        AND CASE
          WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
          ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        END > 0
    ),
    'hidden', count(*) FILTER (
      WHERE COALESCE(publication.visibility, 'published') = 'hidden'
    ),
    'customized', count(publication.product_id),
    'unavailable', count(*) FILTER (
      WHERE COALESCE(publication.visibility, 'published') = 'published'
        AND (
          NOT COALESCE(product.is_active, true)
          OR CASE
            WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
            ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
          END <= 0
        )
    ),
    'without_weight', count(*) FILTER (
      WHERE COALESCE(publication.visibility, 'published') = 'published'
        AND COALESCE(product.is_active, true)
        AND COALESCE(product.weight_kg, 0) <= 0
    )
  ) INTO v_result
  FROM public.products product
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = p_store_id
   AND publication.product_id = product.id
  WHERE product.org_id = v_org;

  RETURN COALESCE(v_result, jsonb_build_object(
    'total', 0, 'published', 0, 'hidden', 0,
    'customized', 0, 'unavailable', 0, 'without_weight', 0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_assortment_summary(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_assortment_summary(uuid)
  TO authenticated;

-- Escritura masiva atómica. El navegador manda intención, no org_id.
CREATE OR REPLACE FUNCTION public.save_store_product_publications(
  p_store_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_change jsonb;
  v_product_id uuid;
  v_visibility text;
  v_price numeric;
  v_compare numeric;
  v_category text;
  v_featured boolean;
  v_sort integer;
  v_updated integer := 0;
BEGIN
  SELECT store.org_id INTO v_org
  FROM public.ecommerce_stores store
  WHERE store.id = p_store_id;

  IF v_org IS NULL OR v_actor IS NULL OR NOT public.has_org_role(
    v_org, v_actor, ARRAY['owner', 'admin', 'manager']
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para editar el surtido'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_changes, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_changes, '[]'::jsonb)) < 1
     OR jsonb_array_length(COALESCE(p_changes, '[]'::jsonb)) > 250 THEN
    RAISE EXCEPTION 'El lote debe contener entre 1 y 250 productos'
      USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT value->>'product_id')
    FROM jsonb_array_elements(p_changes)
  ) THEN
    RAISE EXCEPTION 'El lote contiene productos repetidos'
      USING ERRCODE = '22023';
  END IF;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    BEGIN
      v_product_id := (v_change->>'product_id')::uuid;
      v_visibility := lower(COALESCE(NULLIF(v_change->>'visibility', ''), 'published'));
      v_price := NULLIF(v_change->>'price_ars', '')::numeric;
      v_compare := NULLIF(v_change->>'compare_at_price_ars', '')::numeric;
      v_category := NULLIF(btrim(COALESCE(v_change->>'category_slug', '')), '');
      v_featured := CASE
        WHEN v_change ? 'featured' AND jsonb_typeof(v_change->'featured') = 'boolean'
          THEN (v_change->>'featured')::boolean
        ELSE NULL
      END;
      v_sort := NULLIF(v_change->>'sort_order', '')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Un cambio del surtido tiene un formato inválido'
        USING ERRCODE = '22023';
    END;

    IF v_product_id IS NULL OR v_visibility NOT IN ('published', 'hidden')
       OR NOT EXISTS (
         SELECT 1 FROM public.products product
         WHERE product.id = v_product_id AND product.org_id = v_org
       ) THEN
      RAISE EXCEPTION 'El producto o la visibilidad no son válidos'
        USING ERRCODE = '22023';
    END IF;
    IF v_price IS NOT NULL AND (v_price <= 0 OR v_price > 999999999999)
       OR v_compare IS NOT NULL AND (v_compare <= 0 OR v_compare > 999999999999)
       OR v_price IS NOT NULL AND v_compare IS NOT NULL AND v_compare <= v_price
       OR v_sort IS NOT NULL AND (v_sort < 0 OR v_sort > 2147483647) THEN
      RAISE EXCEPTION 'El precio o el orden no son válidos'
        USING ERRCODE = '22023';
    END IF;
    IF v_compare IS NOT NULL AND v_price IS NULL THEN
      RAISE EXCEPTION 'Un precio de referencia requiere un precio propio'
        USING ERRCODE = '22023';
    END IF;
    IF v_category IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ecommerce_categories category
      WHERE category.org_id = v_org
        AND category.slug = v_category
        AND (category.store_id IS NULL OR category.store_id = p_store_id)
    ) THEN
      RAISE EXCEPTION 'La categoría elegida no existe'
        USING ERRCODE = '22023';
    END IF;

    IF v_visibility = 'published' AND v_price IS NULL AND v_compare IS NULL
       AND v_category IS NULL AND v_featured IS NULL AND v_sort IS NULL THEN
      DELETE FROM public.store_product_publications
      WHERE store_id = p_store_id AND product_id = v_product_id;
    ELSE
      INSERT INTO public.store_product_publications (
        store_id, product_id, org_id, visibility, price_ars,
        compare_at_price_ars, category_slug, featured, sort_order, updated_by
      ) VALUES (
        p_store_id, v_product_id, v_org, v_visibility, v_price,
        v_compare, v_category, v_featured, v_sort, v_actor
      )
      ON CONFLICT (store_id, product_id) DO UPDATE SET
        visibility = EXCLUDED.visibility,
        price_ars = EXCLUDED.price_ars,
        compare_at_price_ars = EXCLUDED.compare_at_price_ars,
        category_slug = EXCLUDED.category_slug,
        featured = EXCLUDED.featured,
        sort_order = EXCLUDED.sort_order,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  INSERT INTO public.audit_logs (
    org_id, user_id, action, entity_type, entity_id, entity_label,
    new_values, severity
  ) VALUES (
    v_org, v_actor, 'store.assortment.update', 'ecommerce_store', p_store_id,
    'Surtido de tienda', jsonb_build_object('products_changed', v_updated), 'info'
  );

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.save_store_product_publications(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_store_product_publications(uuid, jsonb)
  TO authenticated;

-- El catálogo legado representa la tienda principal. Los consumidores modernos
-- usan el RPC por slug que aparece a continuación.
CREATE OR REPLACE VIEW public.store_catalog_products AS
SELECT
  product.id,
  product.org_id,
  product.user_id,
  product.name,
  product.brand,
  COALESCE(publication.category_slug, product.category) AS category,
  product.gender,
  product.description,
  product.image_url,
  product.image_urls,
  CASE
    WHEN publication.price_ars IS NOT NULL
      THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
    ELSE product.sale_price_ars
  END AS sale_price_ars,
  CASE
    WHEN publication.price_ars IS NOT NULL
      AND publication.compare_at_price_ars > publication.price_ars
      THEN publication.price_ars
    WHEN publication.price_ars IS NULL THEN product.discount_price_ars
    ELSE NULL::numeric
  END AS discount_price_ars,
  product.price_2x_ars,
  product.stock,
  product.content_ml,
  product.total_sold,
  COALESCE(publication.featured, product.featured, false) AS featured,
  product.offer_expires_at,
  product.created_at,
  CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
    COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 10
    * COALESCE(settings.exchange_rate, 0)
    * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
  ) END AS decant_price_10ml,
  CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
    COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 5
    * COALESCE(settings.exchange_rate, 0)
    * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
  ) END AS decant_price_5ml,
  CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
    COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 2.5
    * COALESCE(settings.exchange_rate, 0)
    * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
  ) END AS decant_price_2_5ml,
  CASE
    WHEN COALESCE(product.offer_stacks_payment, store.payment_discount_stacks, false)
      THEN COALESCE(
        CASE WHEN publication.price_ars IS NOT NULL
          THEN publication.price_ars END,
        NULLIF(product.discount_price_ars, 0),
        product.sale_price_ars
      )
    ELSE CASE
      WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
      ELSE product.sale_price_ars
    END
  END AS payment_base_price,
  public.store_promo_price(
    product.org_id,
    product.id,
    COALESCE(publication.category_slug, product.category),
    CASE
      WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
      ELSE product.sale_price_ars
    END,
    NULL::numeric
  ) AS promo_price
FROM public.products product
JOIN LATERAL (
  SELECT candidate.*
  FROM public.ecommerce_stores candidate
  WHERE candidate.org_id = product.org_id AND candidate.is_active
  ORDER BY candidate.is_primary DESC, candidate.created_at ASC, candidate.id ASC
  LIMIT 1
) store ON true
LEFT JOIN public.store_product_publications publication
  ON publication.store_id = store.id
 AND publication.product_id = product.id
LEFT JOIN public.settings settings ON settings.org_id = product.org_id
WHERE COALESCE(product.is_active, true)
  AND COALESCE(publication.visibility, 'published') = 'published'
  AND CASE
    WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
    ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
  END > 0;

ALTER VIEW public.store_catalog_products SET (security_invoker = false);
REVOKE ALL ON public.store_catalog_products FROM PUBLIC;
GRANT SELECT ON public.store_catalog_products TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_catalog_products(p_slug text)
RETURNS SETOF public.store_catalog_products
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    product.id,
    product.org_id,
    product.user_id,
    product.name,
    product.brand,
    COALESCE(publication.category_slug, product.category),
    product.gender,
    product.description,
    product.image_url,
    product.image_urls,
    CASE
      WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
      ELSE product.sale_price_ars
    END,
    CASE
      WHEN publication.price_ars IS NOT NULL
        AND publication.compare_at_price_ars > publication.price_ars
        THEN publication.price_ars
      WHEN publication.price_ars IS NULL THEN product.discount_price_ars
      ELSE NULL::numeric
    END,
    product.price_2x_ars,
    product.stock,
    product.content_ml,
    product.total_sold,
    COALESCE(publication.featured, product.featured, false),
    product.offer_expires_at,
    product.created_at,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 10
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 2.5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
    ) END,
    CASE
      WHEN COALESCE(product.offer_stacks_payment, store.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL
            THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars
        )
      ELSE CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END
    END,
    public.store_promo_price(
      product.org_id,
      product.id,
      COALESCE(publication.category_slug, product.category),
      CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END,
      NULL::numeric
    )
  FROM public.ecommerce_stores store
  JOIN public.products product ON product.org_id = store.org_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  LEFT JOIN public.settings settings ON settings.org_id = product.org_id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
    AND CASE
      WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
      ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
    END > 0
  ORDER BY
    COALESCE(publication.sort_order, 2147483647),
    COALESCE(publication.featured, product.featured, false) DESC,
    product.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_store_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_products(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_categories(p_slug text)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  parent_id uuid,
  image_url text,
  description text,
  sort_order integer,
  productos bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    category.id,
    category.name,
    category.slug,
    category.parent_id,
    category.image_url,
    category.description,
    COALESCE(category.sort_order, 0),
    count(product.id) FILTER (
      WHERE COALESCE(publication.category_slug, product.category) = category.slug
        AND COALESCE(publication.visibility, 'published') = 'published'
        AND COALESCE(product.is_active, true)
        AND CASE
          WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
          ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        END > 0
    )::bigint
  FROM public.ecommerce_stores store
  JOIN public.ecommerce_categories category
    ON category.org_id = store.org_id AND category.is_active
  LEFT JOIN public.products product ON product.org_id = store.org_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  GROUP BY category.id, category.name, category.slug, category.parent_id,
           category.image_url, category.description, category.sort_order
  HAVING count(product.id) FILTER (
    WHERE COALESCE(publication.category_slug, product.category) = category.slug
      AND COALESCE(publication.visibility, 'published') = 'published'
      AND COALESCE(product.is_active, true)
      AND CASE
        WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
      END > 0
  ) > 0
  ORDER BY COALESCE(category.sort_order, 0), category.name;
$$;

REVOKE ALL ON FUNCTION public.get_store_categories(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_categories(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_variants(p_slug text)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  variant_name text,
  variant_type text,
  stock integer,
  price_override numeric,
  image_url text,
  sku text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    variant.id, variant.product_id, variant.variant_name, variant.variant_type,
    variant.stock, variant.price_override, variant.image_url, variant.sku
  FROM public.ecommerce_stores store
  JOIN public.product_variants variant ON variant.org_id = store.org_id
  JOIN public.products product ON product.id = variant.product_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND variant.active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
  ORDER BY variant.product_id, (variant.stock > 0) DESC, variant.variant_name;
$$;

REVOKE ALL ON FUNCTION public.get_store_variants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_variants(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_perfume_details(p_slug text)
RETURNS TABLE (
  product_id uuid,
  familia_olfativa text,
  duracion text,
  proyeccion text,
  notas_salida text[],
  notas_corazon text[],
  notas_fondo text[],
  estacion text[],
  ocasion text[],
  inspiracion text,
  modelo text,
  edad_recomendada text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    detail.product_id, detail.familia_olfativa, detail.duracion,
    detail.proyeccion, detail.notas_salida, detail.notas_corazon,
    detail.notas_fondo, detail.estacion, detail.ocasion,
    detail.inspiracion, detail.modelo, detail.edad_recomendada
  FROM public.ecommerce_stores store
  JOIN public.product_perfume_details detail ON detail.org_id = store.org_id
  JOIN public.products product ON product.id = detail.product_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published';
$$;

REVOKE ALL ON FUNCTION public.get_store_perfume_details(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_perfume_details(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_store_product_recommendations(
  p_slug text,
  p_product_id uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(recommended_product_id uuid, score integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store uuid;
  v_org uuid;
BEGIN
  IF p_slug IS NULL OR char_length(btrim(p_slug)) = 0 OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT store.id, store.org_id INTO v_store, v_org
  FROM public.ecommerce_stores store
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  LIMIT 1;

  IF v_org IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.products product
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = v_store
     AND publication.product_id = product.id
    WHERE product.id = p_product_id
      AND product.org_id = v_org
      AND COALESCE(publication.visibility, 'published') = 'published'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT candidate.product_id, candidate.score
  FROM (
    SELECT
      CASE
        WHEN cooccurrence.product_a_id = p_product_id
          THEN cooccurrence.product_b_id
        ELSE cooccurrence.product_a_id
      END AS product_id,
      cooccurrence.cooccurrence_count::integer AS score
    FROM public.product_cooccurrences cooccurrence
    WHERE cooccurrence.org_id = v_org
      AND (
        cooccurrence.product_a_id = p_product_id
        OR cooccurrence.product_b_id = p_product_id
      )
  ) candidate
  JOIN public.products product ON product.id = candidate.product_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = v_store
   AND publication.product_id = candidate.product_id
  WHERE COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
  ORDER BY candidate.score DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 24));
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_product_recommendations(text, uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_product_recommendations(text, uuid, integer)
  TO anon, authenticated;

-- resolve_store_line sigue siendo la autoridad compartida. Cuando el checkout
-- o el carrito fijan nerqia.store_id, aplica visibilidad y precio de esa
-- vitrina; POS y otros canales sin ese contexto conservan el precio del Core.
CREATE OR REPLACE FUNCTION public.resolve_store_line(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_qty integer,
  p_order_subtotal numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product record;
  v_variant record;
  v_publication public.store_product_publications%ROWTYPE;
  v_store_id uuid;
  v_unit numeric;
  v_list numeric;
  v_offer numeric;
  v_stacks boolean;
  v_promo numeric;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 999 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La cantidad no es válida');
  END IF;

  BEGIN
    v_store_id := NULLIF(current_setting('nerqia.store_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_store_id := NULL;
  END;

  SELECT
    product.id, product.name, product.brand, product.category, product.stock,
    product.sale_price_ars, product.discount_price_ars, product.image_url,
    product.offer_stacks_payment, COALESCE(product.is_active, true) AS active
  INTO v_product
  FROM public.products product
  WHERE product.id = p_product_id AND product.org_id = p_org_id;

  IF v_product.id IS NULL OR NOT v_product.active THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no está disponible'
    );
  END IF;

  IF v_store_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ecommerce_stores store
      WHERE store.id = v_store_id AND store.org_id = p_org_id AND store.is_active
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'La tienda ya no está disponible');
    END IF;

    SELECT publication.* INTO v_publication
    FROM public.store_product_publications publication
    WHERE publication.store_id = v_store_id
      AND publication.product_id = p_product_id;

    IF COALESCE(v_publication.visibility, 'published') <> 'published' THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'Este producto ya no está publicado en la tienda'
      );
    END IF;
  END IF;

  v_product.category := COALESCE(v_publication.category_slug, v_product.category);
  v_list := CASE
    WHEN v_publication.price_ars IS NOT NULL
      THEN COALESCE(v_publication.compare_at_price_ars, v_publication.price_ars)
    ELSE v_product.sale_price_ars
  END;
  v_offer := CASE
    WHEN v_publication.price_ars IS NOT NULL THEN v_publication.price_ars
    ELSE COALESCE(NULLIF(v_product.discount_price_ars, 0), v_product.sale_price_ars)
  END;

  IF COALESCE(v_offer, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no tiene precio disponible'
    );
  END IF;

  v_unit := v_offer;
  v_promo := public.store_promo_price(
    p_org_id, v_product.id, v_product.category, v_list, p_order_subtotal
  );
  IF v_promo IS NOT NULL AND v_promo < v_unit THEN
    v_unit := v_promo;
  END IF;

  v_stacks := COALESCE(
    v_product.offer_stacks_payment,
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.id = v_store_id),
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.org_id = p_org_id
     ORDER BY store.is_primary DESC, store.created_at ASC
     LIMIT 1),
    false
  );

  IF p_variant_id IS NULL THEN
    IF v_product.stock < p_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Sin stock suficiente de %s (quedan %s)', v_product.name, v_product.stock
        )
      );
    END IF;
    RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', NULL,
      'name', v_product.name,
      'brand', v_product.brand,
      'quantity', p_qty,
      'unit_price', v_unit,
      'list_price', CASE WHEN v_stacks THEN v_unit ELSE v_list END,
      'total', v_unit * p_qty,
      'image_url', v_product.image_url
    ));
  END IF;

  SELECT
    variant.id, variant.variant_name, variant.stock,
    variant.price_override, variant.image_url
  INTO v_variant
  FROM public.product_variants variant
  WHERE variant.id = p_variant_id
    AND variant.product_id = p_product_id
    AND variant.org_id = p_org_id
    AND variant.active;

  IF v_variant.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa variante ya no está disponible');
  END IF;
  IF v_variant.stock < p_qty THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        'Sin stock suficiente de %s %s (quedan %s)',
        v_product.name, v_variant.variant_name, v_variant.stock
      )
    );
  END IF;
  IF COALESCE(v_variant.price_override, 0) > 0 THEN
    v_unit := v_variant.price_override;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
    'product_id', v_product.id,
    'variant_id', v_variant.id,
    'name', v_product.name || ' — ' || v_variant.variant_name,
    'brand', v_product.brand,
    'quantity', p_qty,
    'unit_price', v_unit,
    'list_price', CASE
      WHEN COALESCE(v_variant.price_override, 0) > 0 THEN v_variant.price_override
      WHEN v_stacks THEN v_unit
      ELSE v_list
    END,
    'total', v_unit * p_qty,
    'image_url', COALESCE(v_variant.image_url, v_product.image_url)
  ));
END;
$$;

-- Son helpers internos: exponerlos permitía resolver productos sin una tienda.
REVOKE ALL ON FUNCTION public.resolve_store_line(uuid, uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_store_cart_items(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- Wrappers de compatibilidad: conservan las firmas públicas y fijan el contexto
-- de vitrina antes de delegar en la implementación ya probada.
DO $rename_checkout$
BEGIN
  IF to_regprocedure(
    'public.create_store_order_core(text,jsonb,text,text,text,jsonb,text,text,text,text,jsonb)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_store_order(
      text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
    ) RENAME TO create_store_order_core;
  END IF;
END;
$rename_checkout$;

REVOKE ALL ON FUNCTION public.create_store_order_core(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping jsonb,
  p_payment_method text,
  p_notes text DEFAULT NULL,
  p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL,
  p_fiscal jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store uuid;
BEGIN
  SELECT store.id INTO v_store
  FROM public.ecommerce_stores store
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  LIMIT 1;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('nerqia.store_id', v_store::text, true);
  RETURN public.create_store_order_core(
    p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
    p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option, p_fiscal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
) TO anon, authenticated;

DO $rename_cart_v2$
BEGIN
  IF to_regprocedure(
    'public.save_store_cart_v2_core(text,text,jsonb,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.save_store_cart_v2(text, text, jsonb, text)
      RENAME TO save_store_cart_v2_core;
  END IF;
END;
$rename_cart_v2$;

REVOKE ALL ON FUNCTION public.save_store_cart_v2_core(text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_store_cart_v2(
  p_slug text,
  p_token text,
  p_items jsonb,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store uuid;
BEGIN
  SELECT store.id INTO v_store
  FROM public.ecommerce_stores store
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  LIMIT 1;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('nerqia.store_id', v_store::text, true);
  RETURN public.save_store_cart_v2_core(p_slug, p_token, p_items, p_email);
END;
$$;

REVOKE ALL ON FUNCTION public.save_store_cart_v2(text, text, jsonb, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_store_cart_v2(text, text, jsonb, text)
  TO anon, authenticated;

-- Los cuerpos públicos cambiaron: el contrato versionado se vuelve a ligar al
-- hash exacto para que un cambio futuro reabra la auditoría.
WITH reviewed(function_name, identity_arguments) AS (
  VALUES
    ('create_store_order', 'p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text, p_coupon text, p_shipping_option text, p_fiscal jsonb'),
    ('get_store_catalog_products', 'p_slug text'),
    ('get_store_categories', 'p_slug text'),
    ('get_store_perfume_details', 'p_slug text'),
    ('get_store_product_recommendations', 'p_slug text, p_product_id uuid, p_limit integer'),
    ('get_store_variants', 'p_slug text'),
    ('save_store_cart_v2', 'p_slug text, p_token text, p_items jsonb, p_email text')
)
UPDATE public.security_function_contracts contract
SET definition_hash = md5(pg_get_functiondef(procedure.oid)),
    reviewed_on = DATE '2026-09-04'
FROM reviewed item
JOIN pg_proc procedure ON procedure.proname = item.function_name
  AND pg_get_function_identity_arguments(procedure.oid) = item.identity_arguments
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
WHERE contract.function_name = item.function_name
  AND contract.identity_arguments = item.identity_arguments;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.store_product_publications') IS NULL
     OR to_regprocedure(
       'public.get_store_assortment(uuid,text,text,integer,integer)'
     ) IS NULL
     OR to_regprocedure('public.get_store_assortment_summary(uuid)') IS NULL
     OR to_regprocedure(
       'public.save_store_product_publications(uuid,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Verificación falló: falta el contrato de surtido';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_funciones_expuestas;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Verificación falló: % funciones expuestas sin contrato', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.store_product_publications publication
  JOIN public.ecommerce_stores store ON store.id = publication.store_id
  JOIN public.products product ON product.id = publication.product_id
  WHERE publication.org_id <> store.org_id
     OR publication.org_id <> product.org_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Verificación falló: hay overrides fuera de tenant';
  END IF;
END;
$verify$;

COMMIT;
