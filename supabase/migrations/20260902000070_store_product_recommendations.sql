-- Recomendaciones públicas por coocurrencia (anon-safe).
-- product_cooccurrences sólo es legible por miembros; la tienda necesita
-- SECURITY DEFINER acotado al slug publicado, sin exponer costos ni PII.

CREATE OR REPLACE FUNCTION public.get_store_product_recommendations(
  p_slug text,
  p_product_id uuid,
  p_limit int DEFAULT 8
)
RETURNS TABLE(recommended_product_id uuid, score int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_slug IS NULL OR length(trim(p_slug)) = 0 OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT s.org_id INTO v_org
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(trim(p_slug))
    AND coalesce(s.is_active, true)
  LIMIT 1;

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN c.product_a_id = p_product_id THEN c.product_b_id
      ELSE c.product_a_id
    END AS recommended_product_id,
    c.cooccurrence_count::int AS score
  FROM public.product_cooccurrences c
  WHERE c.org_id = v_org
    AND (c.product_a_id = p_product_id OR c.product_b_id = p_product_id)
  ORDER BY c.cooccurrence_count DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 24));
END;
$$;

COMMENT ON FUNCTION public.get_store_product_recommendations(text, uuid, int) IS
  'Coocurrencias para la ficha pública. Sólo ids + score; no expone costos. Requiere tienda activa.';

REVOKE ALL ON FUNCTION public.get_store_product_recommendations(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_product_recommendations(text, uuid, int) TO anon, authenticated;

-- Rebuild opcional: documentado para crons / panel; no inventa filas.
COMMENT ON FUNCTION public.rebuild_cooccurrences(uuid) IS
  'Recalcula product_cooccurrences desde sale_items. Llamar tras ventas reales o desde un cron por org; vacío si no hay tickets multi-ítem.';
