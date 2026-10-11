-- ═══════════════════════════════════════════════════════════════════════════
-- Platform: los cinco experimentos de la tesis en un solo lugar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §9 tiene cinco experimentos con criterio y fecha (E1–E5) y la
-- revisión pivotar/perseverar es el 2026-12-15. Cada número vivía en una
-- pestaña distinta de Platform › Métricas (Escalera, Entrevistas,
-- Importaciones, Productos por comercio) y algunos sólo en la base. Esta
-- función devuelve las cinco mediciones crudas; los criterios viven en
-- `src/lib/experimentosTesis.ts`, copiados de TESIS.md (un test lo exige).
--
--   E1  ventas registradas en los últimos 7 días del comercio que más vendió
--   E2  entrevistas cargadas y cuántas confirman (3+ herramientas y margen)
--   E3  la importación de catálogo terminada más rápida (minutos)
--   E4  comercios dados de alta por un influencer o creador
--   E5  comercios con 4+ semanas y cuántos pagan un plan (no la prueba)
--
-- Sólo administradores de plataforma. Excluye organizaciones «ZZ» de prueba.
-- Idempotente. Reversible: DROP FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_experimentos_tesis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e1 jsonb; v_e2 jsonb; v_e3 jsonb; v_e4 jsonb; v_e5 jsonb;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo administradores de plataforma' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('ventas', coalesce(max(n), 0), 'comercio', (array_agg(nombre ORDER BY n DESC))[1])
    INTO v_e1
  FROM (
    SELECT o.name AS nombre, count(*) AS n
    FROM public.sales s JOIN public.organizations o ON o.id = s.org_id
    WHERE s.created_at >= now() - interval '7 days' AND o.name NOT ILIKE 'zz%'
    GROUP BY o.name
  ) x;

  SELECT jsonb_build_object(
    'total', count(*),
    'confirman', count(*) FILTER (WHERE margen_sin_respuesta
      AND (SELECT count(*) FROM unnest(herramientas) h WHERE btrim(h) <> '') >= 3)
  ) INTO v_e2 FROM public.entrevistas_e2;

  SELECT jsonb_build_object(
    'minutos', min(minutos) FILTER (WHERE status = 'completed'),
    'terminadas', count(*) FILTER (WHERE status = 'completed'),
    'intentos', count(*)
  ) INTO v_e3 FROM public.platform_importaciones_catalogo WHERE org_name NOT ILIKE 'zz%';

  SELECT jsonb_build_object('marcas', count(*)) INTO v_e4
  FROM public.origen_de_alta a JOIN public.organizations o ON o.id = a.org_id
  WHERE (a.referido_por_influencer IS NOT NULL OR a.referido_por_creador IS NOT NULL)
    AND o.name NOT ILIKE 'zz%';

  SELECT jsonb_build_object(
    'con_4_semanas', count(*),
    'pagan', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.subscriptions s JOIN public.plans p ON p.id = s.plan_id
      WHERE s.org_id = o.id AND s.status = 'active' AND p.code <> 'trial'))
  ) INTO v_e5
  FROM public.organizations o
  WHERE o.created_at <= now() - interval '28 days' AND o.name NOT ILIKE 'zz%';

  RETURN jsonb_build_object('e1', v_e1, 'e2', v_e2, 'e3', v_e3, 'e4', v_e4, 'e5', v_e5, 'medido', now());
END;
$$;

REVOKE ALL ON FUNCTION public.platform_experimentos_tesis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_experimentos_tesis() TO authenticated;

COMMENT ON FUNCTION public.platform_experimentos_tesis() IS
  'Mediciones crudas de los experimentos E1–E5 de TESIS §9. Sólo administradores de plataforma.';

COMMIT;
