-- ═══════════════════════════════════════════════════════════════════════════
-- Escalera de la tesis en vivo: los gates de §8 y E1, medidos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/TESIS.md §8: «10 comercios → 8 tiendas → 5 primeras ventas online →
-- 3 comercios vendiendo todas las semanas», con revisión pivotar/perseverar
-- el 2026-12-15. E1: «≥ 20 ventas/semana registradas» en el comercio de
-- catálogo grande. Medido 2026-10-10: ninguno de esos números se veía en la
-- app; la línea de base de §2 se sacó con consultas a mano.
--
-- `platform_escalera_tesis()` (sólo administradores de plataforma) devuelve:
--   · comercios_activos: con al menos una venta (caja o pedido online pagado)
--     en 30 días.
--   · tiendas: comercios con tienda activa y publicada.
--   · con_venta_online: comercios con al menos un pedido online pagado.
--   · vendiendo_todas_las_semanas: comercios con ventas en cada una de las
--     últimas 4 semanas (ventanas de 7 días hacia atrás desde hoy).
--   · semanas: ventas por comercio en cada una de las últimas 8 semanas.
-- Una venta de caja es una `sale_transactions` (un ticket, no un renglón).
--
-- Idempotente. Reversible: DROP FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_escalera_tesis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoy timestamptz := now();
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo administradores de plataforma' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH ventas AS (
    SELECT t.org_id, t.occurred_at AS fecha FROM public.sale_transactions t
    WHERE t.occurred_at >= v_hoy - interval '56 days'
    UNION ALL
    SELECT e.org_id, e.created_at FROM public.ecommerce_orders e
    WHERE e.payment_status IN ('paid', 'partial', 'refunded') AND e.created_at >= v_hoy - interval '56 days'
  ),
  por_semana AS (
    -- Semana 0 = los últimos 7 días; 7 = hace 7–8 semanas.
    SELECT org_id, floor(extract(epoch FROM v_hoy - fecha) / (7 * 86400))::int AS semana, count(*) AS n
    FROM ventas WHERE fecha <= v_hoy GROUP BY 1, 2
  ),
  orgs AS (
    SELECT o.id, o.name,
      EXISTS (SELECT 1 FROM ventas v WHERE v.org_id = o.id AND v.fecha >= v_hoy - interval '30 days') AS activo,
      EXISTS (SELECT 1 FROM public.ecommerce_stores s WHERE s.org_id = o.id AND s.is_active AND s.published_at IS NOT NULL) AS tienda,
      EXISTS (SELECT 1 FROM public.ecommerce_orders e WHERE e.org_id = o.id AND e.payment_status IN ('paid', 'partial', 'refunded')) AS online,
      (SELECT count(DISTINCT p.semana) FROM por_semana p WHERE p.org_id = o.id AND p.semana BETWEEN 0 AND 3) = 4 AS semanal,
      (SELECT COALESCE(jsonb_agg(COALESCE(p.n, 0) ORDER BY g.s), '[]'::jsonb)
         FROM generate_series(0, 7) g(s)
         LEFT JOIN por_semana p ON p.org_id = o.id AND p.semana = g.s) AS semanas
    FROM public.organizations o
  )
  SELECT jsonb_build_object(
    'medido_at', v_hoy,
    'comercios_activos', count(*) FILTER (WHERE activo),
    'tiendas', count(*) FILTER (WHERE tienda),
    'con_venta_online', count(*) FILTER (WHERE online),
    'vendiendo_todas_las_semanas', count(*) FILTER (WHERE semanal),
    'comercios', COALESCE(jsonb_agg(jsonb_build_object(
      'org_id', id, 'nombre', name, 'activo', activo, 'tienda', tienda, 'online', online,
      'semanal', semanal, 'semanas', semanas) ORDER BY name)
      FILTER (WHERE activo OR tienda OR online), '[]'::jsonb))
  INTO v_resultado
  FROM orgs;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_escalera_tesis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_escalera_tesis() TO authenticated;

COMMENT ON FUNCTION public.platform_escalera_tesis() IS
  'Gates de docs/TESIS.md §8 y ventas por semana por comercio (E1), medidos en vivo. Sólo administradores de plataforma.';

COMMIT;
