-- ═══════════════════════════════════════════════════════════════════════════
-- Portada modular de la tienda
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tiendanube deja ordenar los bloques de Inicio. No es un theme engine ni un
-- editor en vivo (congelados hasta un segundo comercio): es un JSON de
-- vidriera. Vacío = la home se arma sola, igual que nav_links.
--
-- Se agrega al FINAL de get_store_by_slug. Hay que dropear: RETURNS TABLE
-- con una columna más cambia la firma.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS storefront_layout jsonb;

COMMENT ON COLUMN public.ecommerce_stores.storefront_layout IS
  'Composición de la portada (anuncio + bloques). NULL = default. Sin secretos ni precios: es vidriera.';

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
   storefront_layout jsonb
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
    s.storefront_layout
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_by_slug(text) IS
  'Vidriera pública. storefront_layout al final: NULL es portada automática.';

-- Verificación: la columna existe y el RPC la nombra. No toca filas de negocio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ecommerce_stores'
       AND column_name = 'storefront_layout'
  ) THEN
    RAISE EXCEPTION 'falta ecommerce_stores.storefront_layout';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_store_by_slug'
      AND pg_get_function_identity_arguments(p.oid) = 'p_slug text'
      AND pg_get_function_result(p.oid) ILIKE '%storefront_layout%'
  ) THEN
    RAISE EXCEPTION 'get_store_by_slug no expone storefront_layout';
  END IF;
END $$;
