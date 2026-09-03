-- El catálogo público (/catalogo/:userId) no puede leer ecommerce_stores
-- cruda: RLS de tenant. Sin slug, el cierre queda en WhatsApp aunque la
-- tienda cobre. Anon sólo recibe slug de una tienda activa de esa org.

CREATE OR REPLACE FUNCTION public.get_published_store_slug(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.slug
  FROM public.ecommerce_stores s
  WHERE s.org_id = p_org_id
    AND s.is_active
  ORDER BY s.created_at ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_published_store_slug(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_store_slug(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_published_store_slug(uuid) IS
  'Slug de la tienda activa de una org. Sin costo, tokens ni datos de comprador.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_published_store_slug'
      AND pg_get_function_identity_arguments(p.oid) = 'p_org_id uuid'
  ) THEN
    RAISE EXCEPTION 'get_published_store_slug no quedó creada';
  END IF;
END $$;
