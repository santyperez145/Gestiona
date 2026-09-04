-- F4 / Commerce: una organización puede operar varias vitrinas sobre el mismo
-- Business Core. Productos, categorías, stock, clientes CRM, costos y tarifas
-- siguen perteneciendo a la organización; experiencia, pedidos y analítica se
-- resuelven por store_id.

BEGIN;

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- La instalación existente tiene una tienda. Este backfill también repara un
-- estado legado con cero o varias principales de forma determinística.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY org_id
      ORDER BY is_primary DESC, created_at ASC, id ASC
    ) AS position
  FROM public.ecommerce_stores
)
UPDATE public.ecommerce_stores s
SET is_primary = ranked.position = 1
FROM ranked
WHERE ranked.id = s.id
  AND s.is_primary IS DISTINCT FROM (ranked.position = 1);

-- No se confía en el nombre histórico: se elimina cualquier UNIQUE compuesto
-- exactamente por org_id y se conserva la FK.
DO $drop_single_store$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.ecommerce_stores'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE (org_id)'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.ecommerce_stores DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$drop_single_store$;

CREATE INDEX IF NOT EXISTS ecommerce_stores_org_created_idx
  ON public.ecommerce_stores (org_id, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_stores_one_primary_per_org_idx
  ON public.ecommerce_stores (org_id)
  WHERE is_primary;

CREATE OR REPLACE FUNCTION public.assign_primary_ecommerce_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text, 0));
  IF NOT EXISTS (
    SELECT 1
    FROM public.ecommerce_stores s
    WHERE s.org_id = NEW.org_id
      AND s.is_primary
  ) THEN
    NEW.is_primary := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_primary_ecommerce_store
  ON public.ecommerce_stores;
CREATE TRIGGER trg_assign_primary_ecommerce_store
  BEFORE INSERT ON public.ecommerce_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_primary_ecommerce_store();

CREATE OR REPLACE FUNCTION public.reassign_primary_ecommerce_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_primary THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.org_id::text, 0));
    UPDATE public.ecommerce_stores
    SET is_primary = true
    WHERE id = (
      SELECT s.id
      FROM public.ecommerce_stores s
      WHERE s.org_id = OLD.org_id
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_reassign_primary_ecommerce_store
  ON public.ecommerce_stores;
CREATE TRIGGER trg_reassign_primary_ecommerce_store
  AFTER DELETE ON public.ecommerce_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.reassign_primary_ecommerce_store();

CREATE OR REPLACE FUNCTION public.protect_primary_ecommerce_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_primary
    AND NOT NEW.is_primary
    AND COALESCE(
      current_setting('nerqia.allow_primary_store_change', true),
      'false'
    ) <> 'true'
  THEN
    RAISE EXCEPTION 'Usá set_primary_ecommerce_store para cambiar la tienda principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_primary_ecommerce_store
  ON public.ecommerce_stores;
CREATE TRIGGER trg_protect_primary_ecommerce_store
  BEFORE UPDATE OF is_primary ON public.ecommerce_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_primary_ecommerce_store();

REVOKE ALL ON FUNCTION public.assign_primary_ecommerce_store()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reassign_primary_ecommerce_store()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_primary_ecommerce_store()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_primary_ecommerce_store(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_store record;
BEGIN
  IF v_actor IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.org_id, s.name, s.is_primary
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE s.id = p_store_id;

  IF v_store.id IS NULL OR NOT public.has_org_role(
    v_store.org_id,
    v_actor,
    ARRAY['owner', 'admin']
  ) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede cambiar la tienda principal'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_store.org_id::text, 0));
  SELECT s.id, s.org_id, s.name, s.is_primary
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE s.id = p_store_id
    AND s.org_id = v_store.org_id
  FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda ya no existe' USING ERRCODE = '22023';
  END IF;

  IF NOT v_store.is_primary THEN
    PERFORM set_config('nerqia.allow_primary_store_change', 'true', true);
    UPDATE public.ecommerce_stores
    SET is_primary = false
    WHERE org_id = v_store.org_id
      AND is_primary;

    UPDATE public.ecommerce_stores
    SET is_primary = true
    WHERE id = p_store_id;
    PERFORM set_config('nerqia.allow_primary_store_change', 'false', true);

    INSERT INTO public.audit_logs (
      org_id, user_id, action, entity_type, entity_id, entity_label,
      old_values, new_values, severity
    ) VALUES (
      v_store.org_id, v_actor, 'store.primary.change', 'ecommerce_store',
      v_store.id, v_store.name,
      jsonb_build_object('is_primary', false),
      jsonb_build_object('is_primary', true),
      'info'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'store_id', v_store.id,
    'changed', NOT v_store.is_primary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_ecommerce_store(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_primary_ecommerce_store(uuid)
  TO authenticated;

-- Compatibilidad para links que sólo conocen la organización. Nunca elige una
-- fila arbitraria: principal activa primero y, si no, la más antigua.
CREATE OR REPLACE FUNCTION public.get_published_store_slug(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.slug
  FROM public.ecommerce_stores s
  WHERE s.org_id = p_org_id
    AND s.is_active
  ORDER BY s.is_active DESC, s.is_primary DESC, s.created_at ASC, s.id ASC
  LIMIT 1;
$$;

-- La vista heredada queda estable y sin duplicaciones. El storefront moderno
-- usa get_store_catalog_products(slug), que además aplica la configuración de
-- descuentos de la vitrina solicitada.
CREATE OR REPLACE VIEW public.store_catalog_products AS
SELECT
  p.id,
  p.org_id,
  p.user_id,
  p.name,
  p.brand,
  p.category,
  p.gender,
  p.description,
  p.image_url,
  p.image_urls,
  p.sale_price_ars,
  p.discount_price_ars,
  p.price_2x_ars,
  p.stock,
  p.content_ml,
  p.total_sold,
  p.featured,
  p.offer_expires_at,
  p.created_at,
  CASE
    WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(
      COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 10
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
    )
  END AS decant_price_10ml,
  CASE
    WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(
      COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
    )
  END AS decant_price_5ml,
  CASE
    WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(
      COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 2.5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
    )
  END AS decant_price_2_5ml,
  CASE
    WHEN COALESCE(p.offer_stacks_payment, store.payment_discount_stacks, false)
      THEN COALESCE(NULLIF(p.discount_price_ars, 0), p.sale_price_ars)
    ELSE p.sale_price_ars
  END AS payment_base_price,
  public.store_promo_price(
    p.org_id, p.id, p.category, p.sale_price_ars, NULL::numeric
  ) AS promo_price
FROM public.products p
LEFT JOIN public.settings settings ON settings.org_id = p.org_id
LEFT JOIN LATERAL (
  SELECT s.payment_discount_stacks
  FROM public.ecommerce_stores s
  WHERE s.org_id = p.org_id
  ORDER BY s.is_active DESC, s.is_primary DESC, s.created_at ASC, s.id ASC
  LIMIT 1
) store ON true
WHERE COALESCE(p.sale_price_ars, 0) > 0
  AND COALESCE(p.is_active, true);

CREATE OR REPLACE FUNCTION public.get_store_catalog_products(p_slug text)
RETURNS SETOF public.store_catalog_products
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.org_id,
    p.user_id,
    p.name,
    p.brand,
    p.category,
    p.gender,
    p.description,
    p.image_url,
    p.image_urls,
    p.sale_price_ars,
    p.discount_price_ars,
    p.price_2x_ars,
    p.stock,
    p.content_ml,
    p.total_sold,
    p.featured,
    p.offer_expires_at,
    p.created_at,
    CASE
      WHEN COALESCE(p.content_ml, 0) > 0
      THEN round(
        COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 10
        * COALESCE(settings.exchange_rate, 0)
        * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
      )
    END,
    CASE
      WHEN COALESCE(p.content_ml, 0) > 0
      THEN round(
        COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 5
        * COALESCE(settings.exchange_rate, 0)
        * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
      )
    END,
    CASE
      WHEN COALESCE(p.content_ml, 0) > 0
      THEN round(
        COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml * 2.5
        * COALESCE(settings.exchange_rate, 0)
        * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
      )
    END,
    CASE
      WHEN COALESCE(p.offer_stacks_payment, store.payment_discount_stacks, false)
        THEN COALESCE(NULLIF(p.discount_price_ars, 0), p.sale_price_ars)
      ELSE p.sale_price_ars
    END,
    public.store_promo_price(
      p.org_id, p.id, p.category, p.sale_price_ars, NULL::numeric
    )
  FROM public.ecommerce_stores store
  JOIN public.products p ON p.org_id = store.org_id
  LEFT JOIN public.settings settings ON settings.org_id = p.org_id
  WHERE lower(store.slug) = lower(p_slug)
    AND store.is_active
    AND COALESCE(p.sale_price_ars, 0) > 0
    AND COALESCE(p.is_active, true)
  ORDER BY p.featured DESC, p.name ASC;
$$;

REVOKE ALL ON public.store_catalog_products FROM PUBLIC;
GRANT SELECT ON public.store_catalog_products TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_store_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_products(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_store_categories(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created integer := 0;
  v_row record;
  v_name text;
  v_known jsonb := jsonb_build_object(
    'perfume_arabe', 'Perfume Árabe',
    'perfume_diseñador', 'Perfume Diseñador',
    'vaper', 'Vaper',
    'electronico', 'Electrónico'
  );
BEGIN
  IF NOT public.has_org_role(
    p_org_id,
    auth.uid(),
    ARRAY['owner', 'admin', 'manager']
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para editar el catálogo'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT p.category AS slug, count(*) AS total
    FROM public.products p
    WHERE p.org_id = p_org_id
      AND p.category IS NOT NULL
      AND btrim(p.category) <> ''
    GROUP BY p.category
    ORDER BY count(*) DESC
  LOOP
    v_name := COALESCE(
      v_known ->> v_row.slug,
      initcap(replace(v_row.slug, '_', ' '))
    );

    INSERT INTO public.ecommerce_categories (
      org_id, store_id, name, slug, sort_order, is_active
    ) VALUES (
      p_org_id, NULL, v_name, v_row.slug, v_created, true
    )
    ON CONFLICT (org_id, slug) DO NOTHING;

    IF FOUND THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creadas', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_store_categories(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_store_categories(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.set_store_first_party_analytics(
  uuid, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.set_store_first_party_analytics(
  p_org_id uuid,
  p_store_id uuid,
  p_enabled boolean,
  p_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_store record;
  v_previous boolean;
BEGIN
  IF v_actor IS NULL OR p_org_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT m.role INTO v_role
  FROM public.memberships m
  WHERE m.org_id = p_org_id
    AND m.user_id = v_actor
  LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Sólo owner o admin puede decidir esta medición'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.name, s.first_party_analytics_enabled
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE s.id = p_store_id
    AND s.org_id = p_org_id
  FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no pertenece a esta organización'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled AND NOT p_acknowledged THEN
    RAISE EXCEPTION 'Debés confirmar la información publicada antes de activar'
      USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND NOT public.store_analytics_disclosure_ready(v_store.id) THEN
    RAISE EXCEPTION 'La política publicada todavía no informa visita, UTM, minimización y retención'
      USING ERRCODE = '22023';
  END IF;

  v_previous := v_store.first_party_analytics_enabled;
  UPDATE public.ecommerce_stores
  SET first_party_analytics_enabled = p_enabled,
      analytics_disclosure_accepted_at = CASE
        WHEN p_enabled THEN COALESCE(analytics_disclosure_accepted_at, now())
        ELSE analytics_disclosure_accepted_at
      END,
      analytics_disclosure_accepted_by = CASE
        WHEN p_enabled THEN COALESCE(analytics_disclosure_accepted_by, v_actor)
        ELSE analytics_disclosure_accepted_by
      END
  WHERE id = v_store.id;

  IF v_previous IS DISTINCT FROM p_enabled THEN
    INSERT INTO public.audit_logs (
      org_id, user_id, action, entity_type, entity_id, entity_label,
      old_values, new_values, severity, metadata
    ) VALUES (
      p_org_id, v_actor,
      CASE WHEN p_enabled
        THEN 'store.analytics.enable'
        ELSE 'store.analytics.disable'
      END,
      'ecommerce_store', v_store.id, v_store.name,
      jsonb_build_object('first_party_analytics_enabled', v_previous),
      jsonb_build_object('first_party_analytics_enabled', p_enabled),
      'info',
      jsonb_build_object(
        'disclosure_acknowledged', p_acknowledged,
        'retention_months', 13,
        'attribution_model', 'first_observed'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'store_id', v_store.id,
    'enabled', p_enabled,
    'changed', v_previous IS DISTINCT FROM p_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_store_first_party_analytics(
  uuid, uuid, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_first_party_analytics(
  uuid, uuid, boolean, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_order_shipment(
  p_order_id uuid,
  p_carrier text DEFAULT 'propio',
  p_weight_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
  v_address jsonb;
  v_id uuid;
  v_code text;
  v_weight numeric;
  v_carrier text := COALESCE(NULLIF(btrim(p_carrier), ''), 'propio');
BEGIN
  SELECT * INTO v_order
  FROM public.ecommerce_orders
  WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para preparar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;
  IF v_carrier NOT IN (
    'propio', 'oca', 'andreani', 'correo_arg', 'mercado_envios', 'otro'
  ) THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  SELECT id, tracking_code INTO v_id, v_code
  FROM public.deliveries
  WHERE ecommerce_order_id = p_order_id
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'id', v_id,
      'tracking_code', v_code,
      'existing', true
    );
  END IF;

  v_address := COALESCE(v_order.shipping_address, '{}'::jsonb);
  IF p_weight_kg IS NOT NULL AND p_weight_kg > 0 THEN
    v_weight := p_weight_kg;
  ELSE
    SELECT COALESCE(s.default_item_weight_kg, 0.5)
      * GREATEST(
        1,
        (
          SELECT COALESCE(sum((item ->> 'quantity')::integer), 1)
          FROM jsonb_array_elements(v_order.items) item
        )
      )
    INTO v_weight
    FROM public.ecommerce_stores s
    WHERE s.id = v_order.store_id;
    v_weight := COALESCE(v_weight, 0.5);
  END IF;

  v_code := 'ENV-' || v_order.order_number;
  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code,
    customer_name, customer_phone, customer_email,
    address_street, address_city, address_province, address_zip, address_notes,
    carrier, status, weight_kg, cod_amount, cod_collected
  ) VALUES (
    v_order.org_id, p_order_id, v_code,
    v_order.customer_name, v_order.customer_phone, v_order.customer_email,
    COALESCE(
      NULLIF(v_address ->> 'calle', ''),
      NULLIF(v_address ->> 'street', ''),
      v_address ->> 'address',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'ciudad', ''),
      v_address ->> 'city',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'provincia', ''),
      NULLIF(v_address ->> 'province', ''),
      v_address ->> 'state',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'cp', ''),
      NULLIF(v_address ->> 'zip', ''),
      v_address ->> 'postal_code',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'notas', ''),
      NULLIF(v_address ->> 'notes', '')
    ),
    v_carrier, 'pending', v_weight, 0, true
  )
  RETURNING id INTO v_id;

  UPDATE public.ecommerce_orders
  SET fulfillment_status = 'processing',
      updated_at = now()
  WHERE id = p_order_id
    AND fulfillment_status IN ('pending', 'unfulfilled');

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'tracking_code', v_code,
    'existing', false
  );
END;
$$;

-- El formulario público debe resolver la orden dentro de la vitrina del slug;
-- dos tiendas del mismo negocio no pueden consultar ni abrir el mismo RMA.
CREATE OR REPLACE FUNCTION public.request_store_return(
  p_slug text,
  p_order_number text,
  p_email text,
  p_tipo text,
  p_product_id uuid DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL,
  p_qty integer DEFAULT 1,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_order record;
  v_days integer;
  v_rma text;
  v_id uuid;
  v_item jsonb;
  v_name text;
  v_amount numeric := 0;
  v_existing integer;
  v_crm uuid;
BEGIN
  IF p_tipo NOT IN ('arrepentimiento', 'falla') THEN
    RAISE EXCEPTION 'Tipo de pedido inválido';
  END IF;

  SELECT s.id, s.org_id INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada';
  END IF;

  SELECT
    o.id,
    o.org_id,
    o.items,
    o.payment_status,
    o.order_number,
    o.customer_name,
    o.customer_email,
    o.store_customer_id
  INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.org_id = v_store.org_id
    AND o.store_id = v_store.id
    AND upper(btrim(o.order_number)) = upper(btrim(p_order_number))
    AND lower(btrim(o.customer_email)) = lower(btrim(COALESCE(p_email, '')))
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos esa orden con ese email';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Esa orden todavía no figura como pagada';
  END IF;

  IF p_tipo = 'arrepentimiento' THEN
    v_days := public.dias_para_arrepentirse(v_order.id);
    IF v_days <= 0 THEN
      RAISE EXCEPTION 'Pasaron los 10 días corridos para arrepentirte. Si el producto tiene una falla, elegí esa opción: la garantía legal es de 6 meses.';
    END IF;
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.return_requests r
  WHERE r.ecommerce_order_id = v_order.id
    AND COALESCE(
      r.product_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ) = COALESCE(
      p_product_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    AND r.status IN ('pending', 'approved');
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Ya hay un pedido en curso para ese producto de esta orden';
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb))
  LOOP
    IF p_product_id IS NULL
      OR (v_item ->> 'product_id')::uuid = p_product_id
    THEN
      v_name := COALESCE(v_name, v_item ->> 'name');
      v_amount := v_amount
        + COALESCE((v_item ->> 'unit_price')::numeric, 0)
        * LEAST(
          GREATEST(COALESCE(p_qty, 1), 1),
          GREATEST(COALESCE((v_item ->> 'quantity')::integer, 1), 1)
        );
      EXIT WHEN p_product_id IS NOT NULL;
    END IF;
  END LOOP;

  IF p_product_id IS NOT NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number;
  END IF;

  SELECT c.id INTO v_crm
  FROM public.customers c
  WHERE c.org_id = v_order.org_id
    AND lower(btrim(c.email)) = lower(btrim(v_order.customer_email))
  LIMIT 1;

  v_rma := 'RMA-' || to_char(now(), 'YYYYMMDD') || '-'
    || lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo,
    customer_id, customer_name, customer_email,
    product_id, variant_id, product_name, quantity,
    refund_amount, status, reason_text
  ) VALUES (
    v_order.org_id, v_rma, v_order.id, p_tipo,
    v_crm, v_order.customer_name, v_order.customer_email,
    p_product_id, p_variant_id, COALESCE(v_name, 'Toda la orden'),
    GREATEST(COALESCE(p_qty, 1), 1),
    round(v_amount), 'pending', p_motivo
  )
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.notifications (
      user_id, org_id, title, message, type, entity_type, entity_id
    )
    SELECT
      m.user_id,
      v_order.org_id,
      CASE WHEN p_tipo = 'arrepentimiento'
        THEN 'Arrepentimiento de compra'
        ELSE 'Reclamo por falla'
      END,
      format(
        '%s — orden %s',
        COALESCE(v_name, 'Toda la orden'),
        v_order.order_number
      ),
      'ecommerce',
      'return_request',
      v_id::text
    FROM public.memberships m
    WHERE m.org_id = v_order.org_id
      AND m.role = 'owner'
    ORDER BY m.joined_at
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'rma', v_rma,
    'tipo', p_tipo,
    'monto', round(v_amount),
    'order_number', v_order.order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_store_return(
  text, text, text, text, uuid, uuid, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_store_return(
  text, text, text, text, uuid, uuid, integer, text
) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_store_performance_snapshot(
  uuid, date, date
);

CREATE OR REPLACE FUNCTION public.get_store_performance_snapshot(
  p_org_id uuid,
  p_store_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_visit_tracking_start constant timestamptz := '2026-09-04 00:00:00+00';
  v_checkout_tracking_start constant timestamptz := '2026-09-04 03:41:11+00';
  v_timezone constant text := 'America/Argentina/Buenos_Aires';
  v_filtered boolean := p_from IS NOT NULL OR p_to IS NOT NULL;
  v_from_date date := COALESCE(p_from, p_to);
  v_to_date date := COALESCE(p_to, p_from);
  v_days integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_previous_from_date date;
  v_previous_to_date date;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_result jsonb;
BEGIN
  IF p_org_id IS NULL OR p_store_id IS NULL OR v_actor IS NULL
    OR NOT public.is_org_member(p_org_id, v_actor)
  THEN
    RAISE EXCEPTION 'No autorizado para consultar esta organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ecommerce_stores s
    WHERE s.id = p_store_id
      AND s.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La tienda no pertenece a esta organización'
      USING ERRCODE = '22023';
  END IF;

  IF v_filtered THEN
    IF v_from_date IS NULL OR v_to_date IS NULL OR v_to_date < v_from_date THEN
      RAISE EXCEPTION 'El período de Commerce no es válido'
        USING ERRCODE = '22023';
    END IF;
    v_days := (v_to_date - v_from_date) + 1;
    v_period_start := v_from_date::timestamp AT TIME ZONE v_timezone;
    v_period_end := (v_to_date + 1)::timestamp AT TIME ZONE v_timezone;
    v_previous_from_date := v_from_date - v_days;
    v_previous_to_date := v_from_date - 1;
    v_previous_start := v_previous_from_date::timestamp AT TIME ZONE v_timezone;
    v_previous_end := v_period_start;
  END IF;

  WITH visit_scope AS (
    SELECT
      visit.id,
      public.store_traffic_channel(
        visit.utm_source,
        visit.utm_medium,
        visit.referrer_host
      ) AS channel
    FROM public.ecommerce_store_visits visit
    WHERE visit.org_id = p_org_id
      AND visit.store_id = p_store_id
      AND visit.started_at >= v_visit_tracking_start
      AND (
        NOT v_filtered
        OR (
          visit.started_at >= v_period_start
          AND visit.started_at < v_period_end
        )
      )
  ),
  visit_facts AS (
    SELECT
      scope.id,
      scope.channel,
      EXISTS (
        SELECT 1
        FROM public.ecommerce_cart_sessions cart
        WHERE cart.visit_session_id = scope.id
          AND cart.store_id = p_store_id
          AND jsonb_typeof(cart.items) = 'array'
          AND jsonb_array_length(cart.items) > 0
      ) OR EXISTS (
        SELECT 1
        FROM public.ecommerce_orders orders
        WHERE orders.visit_session_id = scope.id
          AND orders.store_id = p_store_id
      ) AS with_items,
      EXISTS (
        SELECT 1
        FROM public.ecommerce_cart_sessions cart
        WHERE cart.visit_session_id = scope.id
          AND cart.store_id = p_store_id
          AND cart.checkout_started_at IS NOT NULL
      ) OR EXISTS (
        SELECT 1
        FROM public.ecommerce_orders orders
        WHERE orders.visit_session_id = scope.id
          AND orders.store_id = p_store_id
      ) AS checkout_started,
      EXISTS (
        SELECT 1
        FROM public.ecommerce_orders orders
        WHERE orders.visit_session_id = scope.id
          AND orders.store_id = p_store_id
      ) AS converted
    FROM visit_scope scope
  ),
  order_metrics AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(
        sum(total) FILTER (WHERE payment_status = 'paid'),
        0
      )::numeric AS paid_revenue_ars,
      count(*) FILTER (WHERE visit_session_id IS NOT NULL)::bigint
        AS attributed_orders
    FROM public.ecommerce_orders
    WHERE org_id = p_org_id
      AND store_id = p_store_id
      AND (
        NOT v_filtered
        OR (created_at >= v_period_start AND created_at < v_period_end)
      )
  ),
  previous_order_metrics AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(
        sum(total) FILTER (WHERE payment_status = 'paid'),
        0
      )::numeric AS paid_revenue_ars
    FROM public.ecommerce_orders
    WHERE org_id = p_org_id
      AND store_id = p_store_id
      AND v_filtered
      AND created_at >= v_previous_start
      AND created_at < v_previous_end
  ),
  visit_metrics AS (
    SELECT
      count(*)::bigint AS sessions_total,
      count(*) FILTER (WHERE with_items)::bigint AS sessions_with_items,
      count(*) FILTER (WHERE checkout_started)::bigint
        AS checkout_started_sessions,
      count(*) FILTER (WHERE converted)::bigint AS converted_sessions
    FROM visit_facts
  ),
  recovery_metrics AS (
    SELECT count(*)::bigint AS recoverable_carts
    FROM public.ecommerce_cart_sessions cart
    WHERE cart.org_id = p_org_id
      AND cart.store_id = p_store_id
      AND jsonb_typeof(cart.items) = 'array'
      AND jsonb_array_length(cart.items) > 0
      AND cart.expires_at > now()
      AND (
        cart.status = 'abandoned'
        OR (
          cart.status = 'active'
          AND NULLIF(btrim(cart.customer_email), '') IS NOT NULL
          AND cart.updated_at < now() - interval '1 hour'
        )
      )
  ),
  channel_metrics AS (
    SELECT
      fact.channel,
      count(DISTINCT fact.id)::bigint AS sessions,
      count(DISTINCT fact.id) FILTER (WHERE fact.with_items)::bigint
        AS sessions_with_items,
      count(DISTINCT fact.id) FILTER (WHERE fact.checkout_started)::bigint
        AS checkout_started_sessions,
      count(DISTINCT fact.id) FILTER (WHERE fact.converted)::bigint
        AS converted_sessions,
      count(orders.id)::bigint AS orders,
      count(orders.id) FILTER (WHERE orders.payment_status = 'paid')::bigint
        AS orders_paid,
      COALESCE(
        sum(orders.total) FILTER (WHERE orders.payment_status = 'paid'),
        0
      )::numeric AS paid_revenue_ars
    FROM visit_facts fact
    LEFT JOIN public.ecommerce_orders orders
      ON orders.visit_session_id = fact.id
     AND orders.store_id = p_store_id
    GROUP BY fact.channel
  ),
  channels AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'channel', channel,
          'sessions', sessions,
          'sessions_with_items', sessions_with_items,
          'checkout_started_sessions', checkout_started_sessions,
          'converted_sessions', converted_sessions,
          'orders', orders,
          'orders_paid', orders_paid,
          'paid_revenue_ars', paid_revenue_ars
        )
        ORDER BY paid_revenue_ars DESC, sessions DESC, channel
      ),
      '[]'::jsonb
    ) AS rows
    FROM channel_metrics
  )
  SELECT jsonb_build_object(
    'store_id', p_store_id,
    'orders_total', current_orders.orders_total,
    'orders_paid', current_orders.orders_paid,
    'paid_revenue_ars', current_orders.paid_revenue_ars,
    'attributed_orders', current_orders.attributed_orders,
    'sessions_total', visits.sessions_total,
    'sessions_with_items', visits.sessions_with_items,
    'checkout_started_sessions', visits.checkout_started_sessions,
    'converted_sessions', visits.converted_sessions,
    'recoverable_carts', recovery.recoverable_carts,
    'channels', channels.rows,
    'period_from', CASE WHEN v_filtered THEN v_from_date END,
    'period_to', CASE WHEN v_filtered THEN v_to_date END,
    'comparison', CASE WHEN v_filtered THEN jsonb_build_object(
      'period_from', v_previous_from_date,
      'period_to', v_previous_to_date,
      'orders_total', previous_orders.orders_total,
      'orders_paid', previous_orders.orders_paid,
      'paid_revenue_ars', previous_orders.paid_revenue_ars
    ) END,
    'attribution_started_at', v_visit_tracking_start,
    'checkout_tracking_started_at', v_checkout_tracking_start,
    'visit_retention_months', 13,
    'snapshot_at', now()
  )
  INTO v_result
  FROM order_metrics current_orders
  CROSS JOIN previous_order_metrics previous_orders
  CROSS JOIN visit_metrics visits
  CROSS JOIN recovery_metrics recovery
  CROSS JOIN channels;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(
  uuid, uuid, date, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_performance_snapshot(
  uuid, uuid, date, date
) TO authenticated;

COMMENT ON FUNCTION public.get_store_performance_snapshot(
  uuid, uuid, date, date
) IS
  'KPI Commerce por tienda: órdenes por fecha y embudo/canales por cohorte de visita, tenant-safe.';

CREATE OR REPLACE VIEW public.organization_activation_readiness AS
WITH product_signals AS (
  SELECT
    product.org_id,
    count(*) FILTER (
      WHERE product.is_active IS DISTINCT FROM false
        AND COALESCE(product.sale_price_ars, 0) > 0
    ) AS catalog_products_count,
    count(*) FILTER (
      WHERE product.is_active IS DISTINCT FROM false
        AND COALESCE(product.sale_price_ars, 0) > 0
        AND COALESCE(product.stock, 0) > 0
    ) AS sellable_stock_products_count
  FROM public.products product
  GROUP BY product.org_id
), chosen_store AS (
  SELECT DISTINCT ON (store.org_id)
    store.org_id,
    store.id AS store_id,
    store.slug,
    store.is_active,
    store.published_at,
    store.payment_methods,
    store.shipping_mode,
    store.pickup_enabled,
    store.pickup_address
  FROM public.ecommerce_stores store
  ORDER BY
    store.org_id,
    store.is_active DESC,
    store.is_primary DESC,
    store.created_at ASC,
    store.id ASC
), legal_signals AS (
  SELECT
    page.store_id,
    count(DISTINCT page.slug) FILTER (
      WHERE page.slug IN ('politica-de-privacidad', 'terminos-y-condiciones')
        AND page.status = 'published'
        AND btrim(COALESCE(page.content, '')) <> ''
        AND lower(page.content) NOT LIKE '%completá acá%'
        AND lower(page.content) NOT LIKE '%completa aca%'
        AND lower(page.content) NOT LIKE '%mi tienda online%'
        AND lower(page.content) NOT LIKE '%[completar]%'
        AND lower(page.content) NOT LIKE '%lorem ipsum%'
    ) = 2 AS legal_ready
  FROM public.store_pages page
  GROUP BY page.store_id
), payment_signals AS (
  SELECT
    connection.org_id,
    bool_or(
      connection.provider = 'mercadopago'
      AND connection.access_token IS NOT NULL
      AND (
        connection.expires_at IS NULL
        OR connection.expires_at > now()
      )
    ) AS mercadopago_ready
  FROM public.payment_connections connection
  GROUP BY connection.org_id
), bank_signals AS (
  SELECT
    settings.org_id,
    NULLIF(btrim(COALESCE(settings.bank_cbu, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(settings.bank_alias, '')), '') IS NOT NULL
      AS bank_transfer_ready
  FROM public.settings settings
), shipping_signals AS (
  SELECT
    zone.org_id,
    bool_or(zone.is_active AND rate.id IS NOT NULL) AS has_active_rate
  FROM public.shipping_zones zone
  LEFT JOIN public.shipping_rates rate
    ON rate.zone_id = zone.id
   AND rate.org_id = zone.org_id
   AND rate.is_active
  GROUP BY zone.org_id
), fiscal_signals AS (
  SELECT
    credentials.org_id,
    CASE
      WHEN credentials.cuit IS NULL
        OR btrim(credentials.cuit) = ''
        OR COALESCE(credentials.punto_venta, 0) <= 0
        THEN 'falta_datos_fiscales'
      WHEN credentials.modo = 'propio'
        AND (
          credentials.certificate IS NULL
          OR credentials.private_key IS NULL
        )
        THEN 'falta_certificado_propio'
      WHEN credentials.modo <> 'propio'
        AND NOT EXISTS (
          SELECT 1
          FROM public.afip_platform_credentials platform
          WHERE platform.certificate IS NOT NULL
            AND platform.private_key IS NOT NULL
        )
        THEN 'falta_plataforma'
      WHEN credentials.modo <> 'propio'
        AND NOT COALESCE(credentials.delegacion_verificada, false)
        THEN 'falta_delegar'
      WHEN credentials.modo = 'propio'
        AND NOT EXISTS (
          SELECT 1
          FROM public.invoices invoice
          WHERE invoice.org_id = credentials.org_id
            AND NULLIF(btrim(COALESCE(invoice.cae, '')), '') IS NOT NULL
        )
        THEN 'falta_verificar_ciclo'
      ELSE 'listo'
    END AS fiscal_status
  FROM public.afip_credentials credentials
), pos_sales AS (
  SELECT
    sale.org_id,
    count(*) AS pos_sales_total,
    min(sale.date) AS first_pos_sale_at
  FROM public.sales sale
  WHERE sale.source = 'pos'
  GROUP BY sale.org_id
), online_sales AS (
  SELECT
    orders.org_id,
    count(*) FILTER (
      WHERE orders.payment_status IN ('paid', 'partial', 'refunded')
    ) AS online_orders_total,
    min(orders.created_at) FILTER (
      WHERE orders.payment_status IN ('paid', 'partial', 'refunded')
    ) AS first_online_sale_at
  FROM public.ecommerce_orders orders
  GROUP BY orders.org_id
)
SELECT
  organization.id AS org_id,
  organization.onboarding_goal,
  btrim(COALESCE(organization.name, '')) <> ''
    AND lower(btrim(organization.name)) NOT IN (
      'mi negocio', 'mi negocio workspace'
    ) AS identity_ready,
  COALESCE(products.catalog_products_count, 0) AS catalog_products_count,
  COALESCE(products.sellable_stock_products_count, 0)
    AS sellable_stock_products_count,
  COALESCE(products.catalog_products_count, 0) > 0 AS catalog_ready,
  COALESCE(products.sellable_stock_products_count, 0) > 0 AS stock_ready,
  store.store_id IS NOT NULL AS store_exists,
  COALESCE(store.is_active, false)
    AND NULLIF(btrim(COALESCE(store.slug, '')), '') IS NOT NULL
    AS online_channel_ready,
  COALESCE(legal.legal_ready, false) AS legal_ready,
  COALESCE(payment.mercadopago_ready, false) AS mercadopago_ready,
  'efectivo' = ANY(COALESCE(store.payment_methods, ARRAY[]::text[]))
    OR (
      'transferencia' = ANY(COALESCE(store.payment_methods, ARRAY[]::text[]))
      AND COALESCE(bank.bank_transfer_ready, false)
    )
    OR (
      'mercadopago' = ANY(COALESCE(store.payment_methods, ARRAY[]::text[]))
      AND COALESCE(payment.mercadopago_ready, false)
    ) AS online_payment_ready,
  (
    COALESCE(store.pickup_enabled, false)
    AND NULLIF(btrim(COALESCE(store.pickup_address, '')), '') IS NOT NULL
  )
    OR COALESCE(store.shipping_mode, 'flat') <> 'zones'
    OR COALESCE(shipping.has_active_rate, false)
    AS online_shipping_ready,
  COALESCE(fiscal.fiscal_status, 'falta_datos_fiscales') AS fiscal_status,
  COALESCE(fiscal.fiscal_status, 'falta_datos_fiscales') = 'listo'
    AS fiscal_ready,
  COALESCE(pos.pos_sales_total, 0) AS pos_sales_total,
  pos.first_pos_sale_at,
  COALESCE(online.online_orders_total, 0) AS online_orders_total,
  online.first_online_sale_at,
  store.published_at AS store_published_at
FROM public.organizations organization
LEFT JOIN product_signals products ON products.org_id = organization.id
LEFT JOIN chosen_store store ON store.org_id = organization.id
LEFT JOIN legal_signals legal ON legal.store_id = store.store_id
LEFT JOIN payment_signals payment ON payment.org_id = organization.id
LEFT JOIN bank_signals bank ON bank.org_id = organization.id
LEFT JOIN shipping_signals shipping ON shipping.org_id = organization.id
LEFT JOIN fiscal_signals fiscal ON fiscal.org_id = organization.id
LEFT JOIN pos_sales pos ON pos.org_id = organization.id
LEFT JOIN online_sales online ON online.org_id = organization.id
WHERE public.is_org_member(organization.id, auth.uid())
   OR public.is_platform_admin(auth.uid());

ALTER VIEW public.organization_activation_readiness
  SET (security_invoker = false);
REVOKE ALL ON public.organization_activation_readiness FROM PUBLIC, anon;
GRANT SELECT ON public.organization_activation_readiness TO authenticated;

CREATE OR REPLACE VIEW public.platform_org_activation AS
WITH online AS (
  SELECT
    orders.org_id,
    min(orders.created_at) FILTER (
      WHERE orders.payment_status IN ('paid', 'partial', 'refunded')
    ) AS first_online_order_at,
    count(*) FILTER (
      WHERE orders.payment_status IN ('paid', 'partial', 'refunded')
    ) AS online_orders_total,
    count(*) FILTER (
      WHERE orders.payment_status IN ('paid', 'partial', 'refunded')
        AND orders.created_at >= now() - interval '30 days'
    ) AS online_orders_30d
  FROM public.ecommerce_orders orders
  GROUP BY orders.org_id
), pos AS (
  SELECT
    sales.org_id,
    min(sales.date) AS first_pos_sale_at,
    count(*) AS pos_sales_total,
    count(*) FILTER (
      WHERE sales.date >= now() - interval '30 days'
    ) AS pos_sales_30d
  FROM public.sales sales
  WHERE sales.source = 'pos'
  GROUP BY sales.org_id
)
SELECT
  organization.id AS org_id,
  organization.name AS org_name,
  organization.slug,
  organization.created_at AS org_creada,
  store.id AS store_id,
  store.slug AS store_slug,
  store.is_active AS store_is_active,
  store.published_at AS store_published_at,
  store.published_at IS NOT NULL AS store_publication_known,
  online.first_online_order_at,
  COALESCE(online.online_orders_total, 0) AS online_orders_total,
  COALESCE(online.online_orders_30d, 0) AS online_orders_30d,
  pos.first_pos_sale_at,
  COALESCE(pos.pos_sales_total, 0) AS pos_sales_total,
  COALESCE(pos.pos_sales_30d, 0) AS pos_sales_30d,
  online.first_online_order_at IS NOT NULL AS uses_online,
  pos.first_pos_sale_at IS NOT NULL AS uses_pos,
  online.first_online_order_at IS NOT NULL
    AND pos.first_pos_sale_at IS NOT NULL AS is_omnichannel,
  CASE
    WHEN store.published_at IS NOT NULL
    THEN round(
      extract(epoch FROM store.published_at - organization.created_at)
      / 86400.0,
      1
    )
  END AS days_to_store_publish,
  CASE
    WHEN online.first_online_order_at IS NOT NULL
    THEN round(
      extract(epoch FROM online.first_online_order_at - organization.created_at)
      / 86400.0,
      1
    )
  END AS days_to_first_online_order
FROM public.organizations organization
LEFT JOIN LATERAL (
  SELECT candidate.*
  FROM public.ecommerce_stores candidate
  WHERE candidate.org_id = organization.id
  ORDER BY
    candidate.is_primary DESC,
    candidate.created_at ASC,
    candidate.id ASC
  LIMIT 1
) store ON true
LEFT JOIN online ON online.org_id = organization.id
LEFT JOIN pos ON pos.org_id = organization.id
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_org_activation SET (security_invoker = false);
REVOKE ALL ON public.platform_org_activation FROM PUBLIC, anon;
GRANT SELECT ON public.platform_org_activation TO authenticated;

COMMENT ON COLUMN public.ecommerce_stores.is_primary IS
  'Vitrina predeterminada para enlaces y superficies heredadas que sólo conocen la organización.';
COMMENT ON FUNCTION public.set_primary_ecommerce_store(uuid) IS
  'Cambia de forma atómica y auditada la vitrina principal de una organización; sólo owner/admin.';
COMMENT ON FUNCTION public.get_store_catalog_products(text) IS
  'Catálogo público seguro resuelto por slug; comparte productos del Core y aplica configuración comercial de la vitrina.';
COMMENT ON VIEW public.store_catalog_products IS
  'Compatibilidad pública por organización: una fila por producto y configuración de la vitrina activa/principal.';
COMMENT ON VIEW public.organization_activation_readiness IS
  'Hitos hacia la primera venta sobre una vitrina activa determinística; legales evaluados en esa misma tienda.';
COMMENT ON VIEW public.platform_org_activation IS
  'Adopción organizacional por canal con una vitrina principal determinística, sin duplicar organizaciones.';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ecommerce_stores'
      AND column_name = 'is_primary'
  ) THEN
    RAISE EXCEPTION 'Falta ecommerce_stores.is_primary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.ecommerce_stores'::regclass
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (org_id)'
  ) THEN
    RAISE EXCEPTION 'ecommerce_stores todavía limita una tienda por organización';
  END IF;

  IF EXISTS (
    SELECT org_id
    FROM public.ecommerce_stores
    GROUP BY org_id
    HAVING count(*) FILTER (WHERE is_primary) <> 1
  ) THEN
    RAISE EXCEPTION 'Cada organización con tiendas debe tener exactamente una principal';
  END IF;

  IF to_regprocedure('public.get_store_catalog_products(text)') IS NULL
    OR to_regprocedure(
      'public.get_store_performance_snapshot(uuid,uuid,date,date)'
    ) IS NULL
    OR to_regprocedure(
      'public.set_store_first_party_analytics(uuid,uuid,boolean,boolean)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'Faltan contratos explícitos por tienda';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.set_primary_ecommerce_store(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon puede cambiar la tienda principal';
  END IF;
  IF NOT has_function_privilege(
    'anon',
    'public.get_store_catalog_products(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon no puede leer el catálogo por slug';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_store_performance_snapshot(uuid,uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated no puede leer métricas por tienda';
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000110', 'store_first_class')
ON CONFLICT DO NOTHING;

COMMIT;
