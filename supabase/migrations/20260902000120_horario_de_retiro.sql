-- El retiro no es un envío — también del lado del comprador.
--
-- Medido 2026-09-02: las 2 órdenes pagas de Exentry son carrier=retiro.
-- El Foco y la cola ya no dicen «despachar». La página de gracias y el
-- mail seguían: «Ya estamos preparando tu envío». Square/Shopify confirman
-- pickup con dirección y horario, no con etiqueta.
--
-- pickup_instructions ya existe en ecommerce_stores; get_store_by_slug no
-- lo devolvía. Al FINAL de RETURNS TABLE: DROP porque cambia la firma.
-- No se inventa horario: si está vacío, no se muestra.

DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
 RETURNS TABLE(
   org_id uuid,
   owner_user_id uuid,
   name text,
   description text,
   slug text,
   theme text,
   font text,
   primary_color text,
   logo_url text,
   banner_url text,
   currency text,
   payment_methods text[],
   payment_discounts jsonb,
   shipping_cost numeric,
   free_shipping_above numeric,
   shipping_mode text,
   pickup_enabled boolean,
   pickup_address text,
   meta_title text,
   meta_description text,
   social_links jsonb,
   meta_pixel_id text,
   ga_measurement_id text,
   tiktok_pixel_id text,
   nav_links jsonb,
   storefront_layout jsonb,
   shipping_provinces text[],
   pickup_instructions text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.font, s.primary_color,
    s.logo_url, s.banner_url, s.currency,
    public.medios_de_pago_vivos(s.org_id, s.payment_methods),
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb),
    s.storefront_layout,
    COALESCE((
      SELECT array_agg(DISTINCT p ORDER BY p)
        FROM public.shipping_zones z
        JOIN public.shipping_rates r
          ON r.zone_id = z.id AND r.is_active
        CROSS JOIN LATERAL unnest(z.provinces) AS p
       WHERE z.org_id = s.org_id
         AND z.is_active
    ), ARRAY[]::text[]),
    NULLIF(btrim(COALESCE(s.pickup_instructions, '')), '')
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_by_slug(text) IS
  'Vidriera pública. pickup_instructions al final: horario de retiro, o NULL si el comercio no cargó.';

DROP FUNCTION IF EXISTS public.get_store_order_secure(text, text, text, text);

CREATE FUNCTION public.get_store_order_secure(
  p_slug text,
  p_order_number text,
  p_access_token text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  order_number text,
  customer_name text,
  customer_email text,
  items jsonb,
  subtotal numeric,
  shipping_cost numeric,
  total numeric,
  payment_method text,
  payment_status text,
  fulfillment_status text,
  shipping_address jsonb,
  created_at timestamptz,
  access_token text,
  bank_holder text,
  bank_name text,
  bank_cbu text,
  bank_alias text,
  carrier text,
  shipping_service text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF v_email <> '' AND NOT public.rate_limit_publico(
    'store_order_access',
    lower(COALESCE(p_slug, '?')) || ':' || COALESCE(p_order_number, '?'),
    8,
    interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.order_number,
    o.customer_name,
    o.customer_email,
    o.items,
    o.subtotal,
    o.shipping_cost,
    o.total,
    o.payment_method,
    o.payment_status,
    o.fulfillment_status,
    o.shipping_address,
    o.created_at,
    o.public_access_token::text,
    NULLIF(btrim(COALESCE(st.bank_holder, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_name, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_cbu, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_alias, '')), ''),
    o.carrier,
    o.shipping_service
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  LEFT JOIN public.settings st ON st.org_id = s.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND (
      (
        btrim(COALESCE(p_access_token, '')) <> ''
        AND o.public_access_token::text = btrim(p_access_token)
      )
      OR EXISTS (
        SELECT 1
          FROM public.store_customers sc
         WHERE sc.id = o.store_customer_id
           AND sc.user_id = auth.uid()
      )
      OR (
        v_email <> ''
        AND lower(btrim(o.customer_email)) = v_email
      )
    )
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.get_store_order_secure(text, text, text, text) IS
  'Detalle de un pedido. carrier/shipping_service al final: el gracias no puede decir envío en un retiro.';

REVOKE ALL ON FUNCTION public.get_store_order_secure(text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_order_secure(text, text, text, text)
  TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_store_by_slug'
      AND pg_get_function_result(p.oid) ILIKE '%pickup_instructions%'
  ) THEN
    RAISE EXCEPTION 'get_store_by_slug no expone pickup_instructions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_store_order_secure'
      AND pg_get_function_result(p.oid) ILIKE '%carrier%'
      AND pg_get_function_result(p.oid) ILIKE '%shipping_service%'
  ) THEN
    RAISE EXCEPTION 'get_store_order_secure no expone carrier/shipping_service';
  END IF;
END $$;
