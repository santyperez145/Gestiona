-- Matriz reversible de 20261010002100 (categoría por rubro rápida).
--   node scripts/db.mjs --file scripts/categoria-rapida-matrix.sql
-- Compara la función vigente contra la definición anterior (20261010001000,
-- recreada en pg_temp) sobre todas las filas importadas y todos los productos:
-- mismo resultado en cada una. Comprueba que ninguna regla «por categoría»
-- reconoce una categoría genérica y mide el costo por fila. Sólo lectura.
BEGIN;
SET LOCAL statement_timeout = '600s';

CREATE FUNCTION pg_temp.categoria_anterior(p_industry text, p_categoria text, p_nombre text)
RETURNS TABLE (slug text, nombre text) LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_cat text := public.texto_catalogo(p_categoria);
  v_nom text := public.texto_catalogo(p_nombre);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rubro_reglas_categoria r WHERE r.industry_code = p_industry) THEN RETURN; END IF;
  RETURN QUERY SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
  WHERE r.industry_code = p_industry AND r.sobre = 'categoria' AND v_cat <> '' AND v_cat ~ r.patron
  ORDER BY r.prioridad, r.id LIMIT 1;
  IF FOUND THEN RETURN; END IF;
  IF v_cat IN ('', 'otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria', public.texto_catalogo(p_industry))
     OR v_cat = 'varios' THEN
    RETURN QUERY SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
    WHERE r.industry_code = p_industry AND r.sobre = 'nombre' AND v_nom ~ r.patron
    ORDER BY r.prioridad, r.id LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    slug := 'varios'; nombre := 'Varios'; RETURN NEXT;
  END IF;
END; $$;

CREATE TEMP TABLE zz_casos ON COMMIT DROP AS
  SELECT DISTINCT i.industry_code, x.cat, x.nom FROM (
    SELECT r.org_id, r.normalized->>'category' cat, r.normalized->>'name' nom FROM public.product_import_rows r
    UNION ALL SELECT p.org_id, p.category, p.name FROM public.products p
    UNION ALL SELECT NULL, g, 'TORNILLO AUTOPERFORANTE' FROM unnest(ARRAY['', 'Otro', 'OTROS', 'Varios', 'general', 'Multirubro', 'sin categoría', 'Ferretería', 'Herramientas', 'Mi categoría']) g
  ) x CROSS JOIN (SELECT DISTINCT industry_code FROM public.rubro_reglas_categoria) i;

CREATE TEMP TABLE zz_t (caso text, valor text) ON COMMIT DROP;
DO $d$
DECLARE v_t0 timestamptz; v_n int; v_dif int; v_old numeric; v_new numeric; v_gen int;
BEGIN
  SELECT count(*) INTO v_n FROM zz_casos;
  SELECT count(*) INTO v_dif FROM zz_casos c
  WHERE (SELECT row(a.slug, a.nombre) FROM pg_temp.categoria_anterior(c.industry_code, c.cat, c.nom) a)
        IS DISTINCT FROM (SELECT row(b.slug, b.nombre) FROM public.categoria_sugerida(c.industry_code, c.cat, c.nom) b);
  INSERT INTO zz_t VALUES ('casos comparados (>11000)', v_n::text);
  INSERT INTO zz_t VALUES ('resultados distintos (0)', v_dif::text);

  SELECT count(*) INTO v_gen FROM public.rubro_reglas_categoria r
  CROSS JOIN unnest(ARRAY['otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria']) g
  WHERE r.sobre = 'categoria' AND (g ~ r.patron OR public.texto_catalogo(r.industry_code) ~ r.patron);
  INSERT INTO zz_t VALUES ('reglas por categoría que reconocen una genérica (0)', v_gen::text);

  v_t0 := clock_timestamp();
  PERFORM pg_temp.categoria_anterior(industry_code, cat, nom) FROM zz_casos;
  v_old := extract(epoch FROM clock_timestamp() - v_t0) * 1000 / v_n;
  v_t0 := clock_timestamp();
  PERFORM public.categoria_sugerida(industry_code, cat, nom) FROM zz_casos;
  v_new := extract(epoch FROM clock_timestamp() - v_t0) * 1000 / v_n;
  INSERT INTO zz_t VALUES ('ms por fila: antes → ahora', round(v_old, 3) || ' → ' || round(v_new, 3));
END $d$;
SELECT * FROM zz_t;
ROLLBACK;
