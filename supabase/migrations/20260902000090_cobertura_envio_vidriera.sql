-- ═══════════════════════════════════════════════════════════════════════════
-- Cobertura de envío en la vidriera
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-09-02: 6 zonas, tarifa en 1 (CABA). El anuncio "Envío gratis
-- desde $X" y el selector de 24 provincias fingían cobertura nacional.
-- shipping_provinces sale de zonas+tarifas activas; no expone precios.
-- Al FINAL de get_store_by_slug. DROP: RETURNS TABLE cambia la firma.
-- ═══════════════════════════════════════════════════════════════════════════

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
   shipping_provinces text[]
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
    ), ARRAY[]::text[])
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_by_slug(text) IS
  'Vidriera pública. shipping_provinces: provincias con tarifa activa. Vacío = no hay domicilio.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_store_by_slug'
      AND pg_get_function_result(p.oid) ILIKE '%shipping_provinces%'
  ) THEN
    RAISE EXCEPTION 'get_store_by_slug no expone shipping_provinces';
  END IF;
END $$;
