-- ═══════════════════════════════════════════════════════════════════════════
-- Categoría por rubro: unas 16 veces más rápida en la importación
-- ═══════════════════════════════════════════════════════════════════════════
--
-- E1/E3 de docs/TESIS.md. Medido 2026-10-10 sobre la sesión real de
-- Ferretería Famatina: cada lote de 250 filas tardaba hasta 6,5 s y el rol de
-- la app corta cada consulta a los 8 s. Casi la mitad era `categoria_sugerida`
-- (6 ms por producto, 749 llamadas = 4,5 s en tres lotes).
--
-- Causa: cada llamada evaluaba las 15 reglas «por categoría» y después las 20
-- «por nombre»: 35 expresiones regulares distintas más la de `texto_catalogo`.
-- Postgres guarda compiladas 32 por conexión; con 36 en rotación, las
-- recompila todas en cada fila. Las 20 reglas por nombre, ya compiladas,
-- suman 0,12 ms por fila.
--
-- Cambio: si la categoría que trae el producto es genérica («otro», «varios»,
-- vacía, el rubro…) se va directo a las reglas por nombre, sin evaluar las de
-- categoría. Mismo resultado: las reglas por categoría están ancladas a
-- nombres de categoría concretos y ninguna reconoce una genérica (lo comprueba
-- `scripts/categoria-rapida-matrix.sql` sobre las reglas cargadas). Así cada
-- camino usa a lo sumo 21 expresiones y quedan compiladas. Medido en una
-- conexión limpia con 1.500 filas reales: 5,9 → 0,37 ms por fila.
--
-- Idempotente (CREATE OR REPLACE). Reversible: la definición de 20261010001000.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.categoria_sugerida(p_industry text, p_categoria text, p_nombre text)
RETURNS TABLE (slug text, nombre text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cat text := public.texto_catalogo(p_categoria);
  v_nom text;
  v_generica boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rubro_reglas_categoria r WHERE r.industry_code = p_industry) THEN
    RETURN;
  END IF;

  v_generica := v_cat IN ('', 'otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria')
    OR v_cat = public.texto_catalogo(p_industry);

  -- 1. La categoría que trae, si una regla la reconoce (se unifica). Una
  --    genérica no la reconoce ninguna: no se evalúan (ver encabezado).
  IF NOT v_generica THEN
    RETURN QUERY
    SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
    WHERE r.industry_code = p_industry AND r.sobre = 'categoria' AND v_cat ~ r.patron
    ORDER BY r.prioridad, r.id LIMIT 1;
    -- 3. Categoría propia que no se reconoce: se respeta (sin filas).
    RETURN;
  END IF;

  -- 2. Sin categoría útil: la que diga su nombre, o «Varios».
  v_nom := public.texto_catalogo(p_nombre);
  RETURN QUERY
  SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
  WHERE r.industry_code = p_industry AND r.sobre = 'nombre' AND v_nom ~ r.patron
  ORDER BY r.prioridad, r.id LIMIT 1;
  IF FOUND THEN RETURN; END IF;
  slug := 'varios'; nombre := 'Varios';
  RETURN NEXT;
END;
$$;

COMMIT;
