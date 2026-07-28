-- Lectura pública de promociones auto-aplicables para el catálogo anónimo.
--
-- La RLS de `promotions` exige auth, así que el catálogo público
-- (`/catalogo/:userId`) mostraba precios sin la promo vigente: el cliente veía
-- un precio y en el POS se le cobraba otro.
--
-- En vez de abrir la tabla, se expone un RPC security-definer que devuelve
-- SOLO lo necesario para mostrar precios y SOLO promos que ya son públicas por
-- definición: activas, dentro de la ventana de fechas y sin coupon_code
-- (las de cupón siguen siendo privadas). No expone uses_count, límites,
-- ni promos de tipo cliente.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.get_public_promotions(p_org_id uuid)
RETURNS TABLE (
  id             uuid,
  name           text,
  type           text,
  status         text,
  discount_value numeric,
  applies_to     text,
  product_ids    uuid[],
  category_names text[],
  coupon_code    text,
  min_order_value numeric,
  starts_at      timestamptz,
  ends_at        timestamptz,
  banner_text    text,
  banner_color   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.type, p.status, p.discount_value, p.applies_to,
         p.product_ids, p.category_names,
         NULL::text AS coupon_code,   -- nunca se filtra un código de cupón
         p.min_order_value, p.starts_at, p.ends_at, p.banner_text, p.banner_color
  FROM public.promotions p
  WHERE p.org_id = p_org_id
    AND p.status = 'active'
    AND p.coupon_code IS NULL
    AND p.type IN ('percentage', 'fixed')
    AND p.applies_to IN ('all', 'products', 'categories')
    AND p.starts_at <= now()
    AND (p.ends_at IS NULL OR p.ends_at > now());
$$;

REVOKE ALL ON FUNCTION public.get_public_promotions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_promotions(uuid) TO anon, authenticated;
