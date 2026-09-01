-- ═══════════════════════════════════════════════════════════════════════════
-- Slugs de tiendas activas, para que Google encuentre el sitemap
-- ═══════════════════════════════════════════════════════════════════════════
--
-- robots.txt decía en un comentario dónde vive el sitemap de cada tienda y
-- nunca lo declaraba. Search Console y Googlebot no adivinan
-- `/tienda/<slug>/sitemap.xml`. Esta RPC es la fuente del índice: sólo slugs
-- de tiendas activas, sin org_id ni datos de negocio.
--
-- Anónima a propósito: el slug ya es la URL pública. No mueve stock ni plata.

CREATE OR REPLACE FUNCTION public.list_published_store_slugs()
RETURNS TABLE (slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT s.slug
    FROM public.ecommerce_stores s
   WHERE s.is_active
     AND s.slug IS NOT NULL
     AND btrim(s.slug) <> ''
   ORDER BY s.slug
   LIMIT 500;
$$;

COMMENT ON FUNCTION public.list_published_store_slugs() IS
  'Slugs de tiendas activas para robots.txt y el índice de sitemaps. Sin org_id.';

REVOKE ALL ON FUNCTION public.list_published_store_slugs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_published_store_slugs() TO anon, authenticated;

DO $verif$
BEGIN
  ASSERT has_function_privilege('anon', 'public.list_published_store_slugs()', 'EXECUTE'),
    'anon tiene que poder listar slugs públicos para armar robots.txt';
  ASSERT pg_get_function_identity_arguments(
           'public.list_published_store_slugs()'::regprocedure
         ) = '',
    'list_published_store_slugs no lleva argumentos';
END
$verif$;
