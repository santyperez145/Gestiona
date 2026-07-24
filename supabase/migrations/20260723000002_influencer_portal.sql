-- ============================================================================
-- Bloque 2 — Portal público del influencer
-- El influencer accede por un token y ve SUS canjes, y sube la prueba de
-- contenido (URL de la story/reel). El acceso público NO se hace abriendo la
-- tabla a anon (eso filtraría costos/ROI internos), sino a través de dos
-- funciones SECURITY DEFINER que exponen solo lo justo.
-- ============================================================================

-- ── Columnas para la prueba de contenido y el token del portal ─────────────
ALTER TABLE public.influencer_exchanges
  ADD COLUMN IF NOT EXISTS content_url text,
  ADD COLUMN IF NOT EXISTS content_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_token text;

-- Varias filas (canjes) del mismo influencer comparten el mismo token, así el
-- portal muestra todos sus canjes. Por eso el índice NO es único.
CREATE INDEX IF NOT EXISTS idx_influencer_exchanges_portal_token
  ON public.influencer_exchanges (portal_token)
  WHERE portal_token IS NOT NULL;

-- ── Lectura pública: devuelve solo campos seguros (nada de costo/ROI) ───────
CREATE OR REPLACE FUNCTION public.get_influencer_portal(p_token text)
RETURNS TABLE (
  id uuid,
  influencer_name text,
  product_name text,
  quantity integer,
  status text,
  exchange_type text,
  expected_posts integer,
  actual_posts integer,
  content_url text,
  content_submitted_at timestamptz,
  delivery_date timestamptz,
  goal_notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.influencer_name, e.product_name, e.quantity, e.status,
    e.exchange_type, e.expected_posts, e.actual_posts, e.content_url,
    e.content_submitted_at, e.delivery_date, e.goal_notes
  FROM public.influencer_exchanges e
  WHERE p_token IS NOT NULL
    AND e.portal_token = p_token
  ORDER BY e.delivery_date DESC NULLS LAST, e.created_at DESC;
$$;

-- ── Escritura pública: el influencer sube su contenido de UN canje suyo ─────
-- Solo puede tocar una fila cuyo (id, token) coincidan. Marca 'cumplido'
-- automáticamente cuando entregó al menos los posts esperados.
CREATE OR REPLACE FUNCTION public.submit_influencer_content(
  p_token text,
  p_exchange_id uuid,
  p_content_url text,
  p_actual_posts integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_token IS NULL OR p_exchange_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.influencer_exchanges e
  SET
    content_url = COALESCE(NULLIF(p_content_url, ''), e.content_url),
    actual_posts = GREATEST(COALESCE(p_actual_posts, e.actual_posts), 0),
    content_submitted_at = now(),
    status = CASE
      WHEN GREATEST(COALESCE(p_actual_posts, e.actual_posts), 0) >= COALESCE(e.expected_posts, 1)
        THEN 'cumplido'
      ELSE e.status
    END,
    updated_at = now()
  WHERE e.id = p_exchange_id
    AND e.portal_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- El portal es público (el influencer no tiene cuenta): habilitar anon.
GRANT EXECUTE ON FUNCTION public.get_influencer_portal(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_influencer_content(text, uuid, text, integer) TO anon, authenticated;
