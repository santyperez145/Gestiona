-- Menú de la tienda, armado por el comercio.
--
-- Hasta acá el menú se armaba solo: Inicio, Productos, las dos primeras
-- categorías y Ofertas. Servía para arrancar, pero no se puede sacar un link,
-- ni cambiarle el nombre, ni poner una página de contenido —"Cómo comprar",
-- "Envíos"— arriba en vez de escondida en el pie. Tiendanube deja armarlo desde
-- el primer día, y es de las primeras cosas que un comercio quiere tocar.
--
-- Se guarda como jsonb en la tienda y no en una tabla aparte: es una lista
-- corta y ordenada que siempre se lee entera y junto con el resto de la tienda.
-- Una tabla habría sumado una consulta más al arranque de cada visita para
-- devolver cinco filas.
--
-- Forma de cada ítem:
--
--   { "label": "Cómo comprar", "tipo": "pagina",    "valor": "como-comprar" }
--   { "label": "Perfumes",     "tipo": "categoria", "valor": "perfume_arabe" }
--   { "label": "Ofertas",      "tipo": "ofertas" }
--   { "label": "Instagram",    "tipo": "url",       "valor": "https://..." }
--
-- **Vacío significa "armalo solo"**, no "menú vacío". Es lo que hace que
-- aplicar esto no cambie ninguna tienda el día que se aplica, y que una tienda
-- nueva siga teniendo menú sin configurar nada.
--
-- Idempotente.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS nav_links jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.ecommerce_stores.nav_links IS
  'Menú del header, armado por el comercio. Array de {label, tipo, valor}. '
  'Vacío = se arma automaticamente con Inicio/Productos/categorias/Ofertas.';

-- ── get_store_by_slug, con la columna nueva ───────────────────────────────
--
-- Hace falta DROP porque cambia el tipo de retorno. Es un RPC público que SÍ
-- tiene llamadores —el storefront, api/og.ts, api/feed.ts y api/sitemap.ts—,
-- así que la columna se agrega **al final** de la firma: los cuatro leen por
-- nombre de campo y ninguno se entera. El DROP y el CREATE van en el mismo
-- archivo, que se aplica en una sola transacción.
--
-- El cuerpo es el que está en producción con la columna insertada; no se
-- reescribió de memoria.
DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
 RETURNS TABLE(org_id uuid, owner_user_id uuid, name text, description text, slug text, theme text, font text, primary_color text, logo_url text, banner_url text, currency text, payment_methods text[], payment_discounts jsonb, shipping_cost numeric, free_shipping_above numeric, shipping_mode text, pickup_enabled boolean, pickup_address text, meta_title text, meta_description text, social_links jsonb, meta_pixel_id text, ga_measurement_id text, tiktok_pixel_id text, nav_links jsonb)
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
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb)
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$function$
;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;
