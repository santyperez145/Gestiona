-- P0.1.3: productos ya cargados sin tipo, cuando la org tiene exactamente uno.
--
-- Medido 2026-09-02: Exentry tenía 1 tipo (Perfume, business_profile), 4
-- atributos, 60 productos y 0 con product_type_id. El Profiler sembraba el
-- tipo; el alta no lo asignaba. La UI nueva lo hace al crear; esto rellena
-- lo histórico sin inventar valores de atributos ni tocar fichas olfativas.
--
-- Sólo cuando hay exactamente un tipo activo: con gastronomía (plato +
-- insumo) o varios custom no se adivina.

UPDATE public.products p
SET product_type_id = t.id
FROM public.product_types t
WHERE p.org_id = t.org_id
  AND p.product_type_id IS NULL
  AND t.active IS TRUE
  AND (
    SELECT count(*)::int
    FROM public.product_types x
    WHERE x.org_id = p.org_id
      AND x.active IS TRUE
  ) = 1;

DO $$
DECLARE
  v_sin_tipo int;
BEGIN
  SELECT count(*)::int INTO v_sin_tipo
  FROM public.products p
  WHERE p.product_type_id IS NULL
    AND (
      SELECT count(*)::int
      FROM public.product_types t
      WHERE t.org_id = p.org_id
        AND t.active IS TRUE
    ) = 1;

  IF v_sin_tipo <> 0 THEN
    RAISE EXCEPTION
      'backfill product_type_id incompleto: % productos sin tipo en orgs con un solo tipo activo',
      v_sin_tipo;
  END IF;
END $$;
