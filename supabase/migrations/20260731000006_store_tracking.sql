-- Píxeles de seguimiento por tienda.
--
-- Sin esto no se puede publicitar: Meta Ads necesita el píxel para saber qué
-- anuncio generó una venta y para armar públicos similares, y Google Analytics
-- para entender de dónde viene el tráfico. Tiendanube y Empretienda lo traen
-- de fábrica porque es lo primero que pide cualquiera que invierte en ads.
--
-- Son identificadores públicos —viajan en el HTML de cualquier tienda— así que
-- van en la vista pública sin problema. Idempotente.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS meta_pixel_id   text,
  ADD COLUMN IF NOT EXISTS ga_measurement_id text,
  ADD COLUMN IF NOT EXISTS google_ads_id   text,
  ADD COLUMN IF NOT EXISTS tiktok_pixel_id text;

COMMENT ON COLUMN public.ecommerce_stores.meta_pixel_id IS
  'ID del píxel de Meta (Facebook/Instagram). Público: se inyecta en la vitrina.';
COMMENT ON COLUMN public.ecommerce_stores.ga_measurement_id IS
  'ID de medición de Google Analytics 4 (G-XXXXXXX).';

-- La vitrina los necesita, así que se suman a la resolución por slug.
-- Hay que recrearla, no reemplazarla: Postgres no deja cambiar las columnas
-- que devuelve un RETURNS TABLE con CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
RETURNS TABLE (
  org_id           uuid,
  owner_user_id    uuid,
  name             text,
  description      text,
  slug             text,
  theme            text,
  primary_color    text,
  logo_url         text,
  banner_url       text,
  currency         text,
  payment_methods  text[],
  shipping_cost    numeric,
  free_shipping_above numeric,
  shipping_mode    text,
  pickup_enabled   boolean,
  pickup_address   text,
  meta_title       text,
  meta_description text,
  social_links     jsonb,
  meta_pixel_id    text,
  ga_measurement_id text,
  tiktok_pixel_id  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;
