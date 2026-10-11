-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: analítica de búsqueda (lo que más buscan y si abren un producto)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 (búsqueda: «falta analítica completa: búsquedas con
-- resultado, conversión»). 20261011000500 registra sólo las búsquedas sin
-- resultados; sin las que sí encuentran algo, el comercio no sabe qué le
-- piden más ni si la búsqueda le sirve al cliente (si después abre un
-- producto). Medido 2026-10-11: 1.578 visitas a tiendas y ninguna búsqueda
-- con resultado registrada.
--
--   · `store_busquedas`: por comercio, día y término normalizado, cuántas
--     veces se buscó con resultados (`veces`) y cuántas de esas búsquedas
--     terminaron en abrir un producto de la lista (`con_clic`). Sin datos del
--     visitante. Las sin resultado siguen en `store_busquedas_sin_resultado`.
--   · `registrar_busqueda(p_slug, p_termino)` y
--     `registrar_clic_de_busqueda(p_slug, p_termino)` (públicas, las llama la
--     tienda una vez por término y visita): misma normalización y misma
--     resolución de tienda que `registrar_busqueda_sin_resultado`; contadores
--     cortados en 1.000.000.
--   · Leer: quien tiene permiso de ver la tienda. Escribir: sólo las funciones.
--
-- Idempotente. Reversible: DROP FUNCTION x2, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_busquedas (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT current_date,
  termino text NOT NULL CHECK (char_length(termino) BETWEEN 2 AND 60),
  veces integer NOT NULL DEFAULT 0 CHECK (veces BETWEEN 0 AND 1000000),
  con_clic integer NOT NULL DEFAULT 0 CHECK (con_clic BETWEEN 0 AND 1000000),
  ultima_vez timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, dia, termino)
);

ALTER TABLE public.store_busquedas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_busquedas_leer ON public.store_busquedas;
CREATE POLICY store_busquedas_leer ON public.store_busquedas
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'view'));

REVOKE ALL ON public.store_busquedas FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_busquedas FROM authenticated;
GRANT SELECT ON public.store_busquedas TO authenticated;

COMMENT ON TABLE public.store_busquedas IS
  'Búsquedas de la tienda con resultados y cuántas terminaron en abrir un producto, por comercio, día y término normalizado. Sin datos del visitante. Sólo la escriben registrar_busqueda y registrar_clic_de_busqueda.';

-- Normaliza el término y resuelve la tienda activa; NULL si no corresponde.
CREATE OR REPLACE FUNCTION public._busqueda_de_tienda(p_slug text, p_termino text, OUT org_id uuid, OUT termino text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  termino := left(btrim(regexp_replace(public.texto_catalogo(p_termino), '\s+', ' ', 'g')), 60);
  IF termino IS NULL OR char_length(termino) < 2 OR termino !~ '^[a-z0-9 ]+$' THEN
    termino := NULL;
    RETURN;
  END IF;
  SELECT s.org_id INTO org_id FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public._busqueda_de_tienda(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.registrar_busqueda(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  v := public._busqueda_de_tienda(p_slug, p_termino);
  IF v.org_id IS NULL OR v.termino IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces)
  VALUES (v.org_id, current_date, v.termino, 1)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET veces = LEAST(b.veces + 1, 1000000), ultima_vez = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_clic_de_busqueda(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  v := public._busqueda_de_tienda(p_slug, p_termino);
  IF v.org_id IS NULL OR v.termino IS NULL THEN
    RETURN;
  END IF;
  -- Un clic sin búsqueda registrada (p. ej. la llamada anterior se cortó)
  -- cuenta también la búsqueda: nunca más clics que búsquedas.
  INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces, con_clic)
  VALUES (v.org_id, current_date, v.termino, 1, 1)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET con_clic = LEAST(b.con_clic + 1, 1000000),
        veces = GREATEST(b.veces, LEAST(b.con_clic + 1, 1000000)),
        ultima_vez = now();
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_busqueda(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_clic_de_busqueda(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_busqueda(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_clic_de_busqueda(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.registrar_busqueda(text, text) IS
  'La tienda registra una búsqueda con resultados (término normalizado, sin datos del visitante). Pública.';
COMMENT ON FUNCTION public.registrar_clic_de_busqueda(text, text) IS
  'La tienda registra que una búsqueda terminó en abrir un producto de la lista. Pública.';

COMMIT;
