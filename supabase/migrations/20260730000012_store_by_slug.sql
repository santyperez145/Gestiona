-- Resolución pública de una tienda por su slug.
--
-- El panel "Tienda Online" venía configurando tema, colores, métodos de pago y
-- SEO para una vitrina que NO EXISTÍA: no había ruta `/tienda/:slug` en ningún
-- lado, y el botón "Ver tienda" apuntaba a un dominio hardcodeado
-- (gestiona.app) que no resuelve.
--
-- Ahora `/tienda/:slug` renderiza el catálogo público con la marca de la
-- tienda. Como el visitante es anónimo y la RLS de `ecommerce_stores` exige
-- membresía, hace falta este RPC security-definer.
--
-- Solo devuelve tiendas ACTIVAS y solo campos de vidriera: nada de datos
-- internos de la organización. Idempotente.

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
  meta_title       text,
  meta_description text,
  social_links     jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.org_id,
    -- El catálogo público consulta por user_id, así que se resuelve el dueño
    -- de la organización.
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    s.shipping_cost, s.free_shipping_above,
    s.meta_title, s.meta_description, s.social_links
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

-- El slug es la URL pública: no puede repetirse entre organizaciones.
CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_stores_slug_key
  ON public.ecommerce_stores (lower(slug));
