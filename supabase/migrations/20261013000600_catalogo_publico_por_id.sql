-- El catálogo por WhatsApp (`/catalogo/:id`) sigue siendo público a propósito,
-- pero de a un negocio por vez. Medido 2026-10-13: las vistas
-- `catalog_products`, `products_public`, `catalog_settings`, `settings_public`
-- y `catalog_product_variants` se podían leer sin login y sin filtro. Con una
-- sola consulta se bajaban precio y stock de todos los productos activos de
-- TODOS los negocios (777 de Famatina, que nunca publicó tienda) y el
-- WhatsApp de cada uno.
--
-- Ahora la página llama a `catalogo_publico(id)`, que devuelve el catálogo
-- del negocio pedido (por usuario, como los links viejos, o por
-- organización), con tope por IP. Las vistas quedan sólo para service_role y
-- las funciones de servidor. `store_catalog_products` no se toca: sólo
-- incluye negocios con tienda activa y la tienda la lee por
-- `get_store_catalog_products(slug)`.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_publico(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE  -- el tope por IP escribe
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_productos jsonb;
  v_ajustes jsonb;
  v_marca jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  IF NOT public.rate_limit_publico('catalogo_publico', p_id::text, 120, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiadas consultas. Esperá un momento.' USING ERRCODE = '53400';
  END IF;

  -- Mismo orden que tenía la página: primero el link por usuario, después por
  -- organización. Cada parte decide por su cuenta, como antes.
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.category, p.name) INTO v_productos
    FROM (SELECT id, org_id, user_id, name, brand, category, gender, description, image_url, image_urls,
                 sale_price_ars, discount_price_ars, price_2x_ars, stock, content_ml, total_sold,
                 featured, offer_expires_at, created_at
            FROM public.catalog_products WHERE user_id = p_id AND stock > 0) p;
  IF v_productos IS NULL THEN
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.category, p.name) INTO v_productos
      FROM (SELECT id, org_id, user_id, name, brand, category, gender, description, image_url, image_urls,
                   sale_price_ars, discount_price_ars, price_2x_ars, stock, content_ml, total_sold,
                   featured, offer_expires_at, created_at
              FROM public.catalog_products WHERE org_id = p_id AND stock > 0) p;
  END IF;

  SELECT to_jsonb(s) INTO v_ajustes FROM (
    SELECT exchange_rate, volume_discount_threshold, volume_discount_percent
      FROM public.catalog_settings WHERE user_id = p_id ORDER BY org_id LIMIT 1) s;
  IF v_ajustes IS NULL THEN
    SELECT to_jsonb(s) INTO v_ajustes FROM (
      SELECT exchange_rate, volume_discount_threshold, volume_discount_percent
        FROM public.catalog_settings WHERE org_id = p_id ORDER BY org_id LIMIT 1) s;
  END IF;

  SELECT to_jsonb(m) INTO v_marca FROM (
    SELECT id, user_id, org_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
      FROM public.settings_public WHERE user_id = p_id ORDER BY org_id LIMIT 1) m;
  IF v_marca IS NULL THEN
    SELECT to_jsonb(m) INTO v_marca FROM (
      SELECT id, user_id, org_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
        FROM public.settings_public WHERE org_id = p_id ORDER BY org_id LIMIT 1) m;
  END IF;

  RETURN jsonb_build_object(
    'productos', COALESCE(v_productos, '[]'::jsonb),
    'ajustes', v_ajustes,
    'marca', v_marca);
END;
$$;

-- Variantes de un producto que está en el catálogo público (no de cualquiera).
CREATE OR REPLACE FUNCTION public.catalogo_publico_variantes(p_product_id uuid)
RETURNS TABLE (id uuid, variant_name text, stock numeric, image_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.variant_name::text, v.stock::numeric, v.image_url::text
    FROM public.catalog_product_variants v
   WHERE v.product_id = p_product_id
     AND EXISTS (SELECT 1 FROM public.catalog_products cp WHERE cp.id = p_product_id)
   ORDER BY v.variant_name;
$$;

REVOKE ALL ON FUNCTION public.catalogo_publico(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalogo_publico_variantes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_publico(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_publico_variantes(uuid) TO anon, authenticated, service_role;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['catalog_products', 'products_public', 'catalog_settings',
                           'settings_public', 'catalog_product_variants']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', v);
  END LOOP;
END $$;

COMMIT;
