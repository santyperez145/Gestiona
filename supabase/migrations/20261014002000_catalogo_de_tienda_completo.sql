-- Tienda online: el catálogo entero, sin el corte de 1.000 filas.
--
-- Medido el 2026-10-14: `get_store_catalog_products('ferreteriafamatina')`
-- devuelve 11.518 productos, pero la API corta toda lista en 1.000 filas sin
-- avisar. La tienda, el feed de productos (Google/Meta) y el sitemap de
-- Famatina mostraban menos de la décima parte del catálogo.
--
-- `get_store_catalog_completo(slug)` devuelve el mismo catálogo, en el mismo
-- orden, como un único JSON: un solo valor no tiene ese tope. Es SECURITY
-- INVOKER sobre la función pública existente (mismos filtros de vitrina:
-- publicados, con precio, de esa tienda). Una llamada: ~0,4 s y ~2 MB sin
-- comprimir para 11.518 productos.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_store_catalog_completo(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ordinality' ORDER BY t.ordinality), '[]'::jsonb)
  FROM public.get_store_catalog_products(p_slug) WITH ORDINALITY AS t;
$$;
REVOKE ALL ON FUNCTION public.get_store_catalog_completo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_completo(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_store_catalog_completo(text) IS
  'Catálogo público de la vitrina (get_store_catalog_products) como un único JSON ordenado: evita el tope de 1.000 filas de la API.';

COMMIT;
