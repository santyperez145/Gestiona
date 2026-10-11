-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: sinónimos de búsqueda («lo buscan como X, lo tengo como Y»)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 (búsqueda: sinónimos). Desde 20261011000500 el
-- comercio ve «lo que buscan y no encuentran»; muchas veces sí lo tiene, con
-- otro nombre («amoladora» / «esmeriladora»). La búsqueda de la tienda mira
-- nombre, marca, descripción y categoría, y el catálogo público no expone
-- etiquetas, así que no había cómo unir las dos palabras.
--
--   · `store_search_synonyms`: término normalizado → producto, por comercio.
--     El producto tiene que ser del mismo comercio. Leer: permiso de ver la
--     tienda; vincular y desvincular: permiso de editarla.
--   · `get_store_search_synonyms(p_slug)` (pública): los sinónimos de la
--     tienda activa, para que su buscador sume esos productos.
--
-- Idempotente. Reversible: DROP FUNCTION, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_search_synonyms (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  termino text NOT NULL CHECK (char_length(termino) BETWEEN 2 AND 60 AND termino ~ '^[a-z0-9 ]+$'),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, termino, product_id)
);

CREATE INDEX IF NOT EXISTS store_search_synonyms_product_idx ON public.store_search_synonyms (product_id);

ALTER TABLE public.store_search_synonyms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_search_synonyms_leer ON public.store_search_synonyms;
DROP POLICY IF EXISTS store_search_synonyms_crear ON public.store_search_synonyms;
DROP POLICY IF EXISTS store_search_synonyms_borrar ON public.store_search_synonyms;
CREATE POLICY store_search_synonyms_leer ON public.store_search_synonyms FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'view'));
CREATE POLICY store_search_synonyms_crear ON public.store_search_synonyms FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'ecommerce', 'edit')
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.org_id = store_search_synonyms.org_id));
CREATE POLICY store_search_synonyms_borrar ON public.store_search_synonyms FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'edit'));

REVOKE ALL ON public.store_search_synonyms FROM PUBLIC, anon;
REVOKE UPDATE ON public.store_search_synonyms FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.store_search_synonyms TO authenticated;

COMMENT ON TABLE public.store_search_synonyms IS
  'Sinónimos de búsqueda de la tienda: término normalizado que lleva a un producto del mismo comercio.';

CREATE OR REPLACE FUNCTION public.get_store_search_synonyms(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('termino', x.termino, 'product_id', x.product_id)), '[]'::jsonb)
  FROM (
    SELECT s.termino, s.product_id
    FROM public.store_search_synonyms s
    JOIN public.products p ON p.id = s.product_id AND p.is_active
    WHERE s.org_id = (
      SELECT st.org_id FROM public.ecommerce_stores st
      WHERE lower(st.slug) = lower(btrim(p_slug)) AND st.is_active
      ORDER BY st.is_primary DESC, st.created_at
      LIMIT 1)
    ORDER BY s.termino
    LIMIT 2000
  ) x;
$$;

REVOKE ALL ON FUNCTION public.get_store_search_synonyms(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_search_synonyms(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_search_synonyms(text) IS
  'Sinónimos de búsqueda de una tienda activa (término y producto activo). Pública.';

COMMIT;
