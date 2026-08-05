-- ═══════════════════════════════════════════════════════════════════════════
-- Tipografía elegible para la tienda
--
-- Los 5 temas traen la tipografía clavada en el código (`font-sans` en cuatro,
-- `font-serif` en Luxury). Es lo que más cambia la cara de una tienda y era lo
-- único del diseño que el comercio no podía tocar: podía elegir tema y color de
-- marca, pero dos tiendas con el mismo tema se veían iguales.
--
-- Tiendanube y Empretienda dejan elegir tipografía dentro de cada tema. Acá va
-- lo mismo, con un catálogo curado en `src/storefront/theme.ts`.
--
-- ── Por qué una columna y no un tema nuevo por cada combinación ───────────
--
-- Tema y tipografía son cosas distintas: el tema define colores, redondeo y
-- densidad; la tipografía, la voz. Cruzarlos daría 5 × 6 = 30 temas para
-- mantener. Con la columna, agregar una fuente es una línea.
--
-- `null` = la del tema, que es lo que ya tenían todas. Nadie cambia de aspecto
-- por esta migración.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS font text;

COMMENT ON COLUMN public.ecommerce_stores.font IS
  'Id de la tipografía del catálogo de src/storefront/theme.ts. null = la que trae el tema. El valor se valida contra el catálogo al renderizar: uno desconocido cae en la del tema en vez de romper la vitrina.';

-- ── La vitrina necesita saber cuál usar ───────────────────────────────────
DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
RETURNS TABLE (
  org_id           uuid,
  owner_user_id    uuid,
  name             text,
  description      text,
  slug             text,
  theme            text,
  font             text,
  primary_color    text,
  logo_url         text,
  banner_url       text,
  currency         text,
  payment_methods  text[],
  payment_discounts jsonb,
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
    s.name, s.description, s.slug, s.theme, s.font, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    COALESCE(s.payment_discounts, '{}'::jsonb),
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
