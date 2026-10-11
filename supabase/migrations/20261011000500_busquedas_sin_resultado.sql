-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: lo que buscan y no encuentran
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 (búsqueda: «analítica y cero resultados») y el
-- escalón «primeras ventas online» de TESIS §8. Medido 2026-10-11: la tienda
-- no registraba ninguna búsqueda; un comercio no tenía forma de saber qué le
-- piden sus clientes y no tiene (o tiene con otro nombre).
--
--   · `store_busquedas_sin_resultado`: por comercio, día y término, cuántas
--     veces se buscó sin encontrar nada. Sin datos del visitante. Las filas
--     tienen un tope natural (término distinto por día).
--   · `registrar_busqueda_sin_resultado(p_slug, p_termino)` (pública, la
--     llama la tienda): normaliza el término (minúsculas, sin tildes, sólo
--     letras, números y espacios, 2 a 60 caracteres) y suma uno. Repetir la
--     búsqueda sólo infla un contador, que se corta en 1.000.000.
--   · Leer: quien tiene permiso de ver la tienda. Escribir: sólo la función.
--
-- Idempotente. Reversible: DROP FUNCTION, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_busquedas_sin_resultado (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT current_date,
  termino text NOT NULL CHECK (char_length(termino) BETWEEN 2 AND 60),
  veces integer NOT NULL DEFAULT 1 CHECK (veces BETWEEN 1 AND 1000000),
  ultima_vez timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, dia, termino)
);

ALTER TABLE public.store_busquedas_sin_resultado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_busquedas_sin_resultado_leer ON public.store_busquedas_sin_resultado;
CREATE POLICY store_busquedas_sin_resultado_leer ON public.store_busquedas_sin_resultado
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'view'));

REVOKE ALL ON public.store_busquedas_sin_resultado FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_busquedas_sin_resultado FROM authenticated;
GRANT SELECT ON public.store_busquedas_sin_resultado TO authenticated;

COMMENT ON TABLE public.store_busquedas_sin_resultado IS
  'Búsquedas de la tienda que no encontraron nada, por comercio, día y término normalizado. Sin datos del visitante. Sólo la escribe registrar_busqueda_sin_resultado.';

CREATE OR REPLACE FUNCTION public.registrar_busqueda_sin_resultado(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_termino text;
BEGIN
  v_termino := left(btrim(regexp_replace(public.texto_catalogo(p_termino), '\s+', ' ', 'g')), 60);
  IF v_termino IS NULL OR char_length(v_termino) < 2 OR v_termino !~ '^[a-z0-9 ]+$' THEN
    RETURN;
  END IF;

  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.store_busquedas_sin_resultado AS b (org_id, dia, termino)
  VALUES (v_org, current_date, v_termino)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET veces = LEAST(b.veces + 1, 1000000), ultima_vez = now();
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_busqueda_sin_resultado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_busqueda_sin_resultado(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.registrar_busqueda_sin_resultado(text, text) IS
  'La tienda registra una búsqueda sin resultados (término normalizado, sin datos del visitante). Pública.';

COMMIT;
