-- Tienda online: el catálogo completo dentro del tiempo del rol anónimo.
--
-- 20261014002000 armaba el JSON con jsonb_agg y ORDER BY: 1,2 s en la base y,
-- por la API, «canceling statement due to statement timeout» (el rol anon
-- tiene 3 s; medido el 2026-10-14 con Famatina, 11.518 productos). Con json y
-- sin reordenar (el agregado sigue el orden en que la función entrega las
-- filas) son ~0,4 s; ~7 MB sin comprimir, ~1 MB con gzip.
-- Idempotente.
BEGIN;

DROP FUNCTION IF EXISTS public.get_store_catalog_completo(text);
CREATE FUNCTION public.get_store_catalog_completo(p_slug text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(json_agg(t), '[]'::json)
  FROM (SELECT * FROM public.get_store_catalog_products(p_slug)) t;
$$;
REVOKE ALL ON FUNCTION public.get_store_catalog_completo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_completo(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_store_catalog_completo(text) IS
  'Catálogo público de la vitrina (get_store_catalog_products) como un único JSON ordenado: evita el tope de 1.000 filas de la API.';

COMMIT;
