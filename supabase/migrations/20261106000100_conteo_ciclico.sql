-- Conteo cíclico (2026-11-06).
--
-- Un comercio chico no puede cerrar para inventariar, y el inventario anual
-- llega tarde: para entonces el stock ya mintió meses. La práctica de los
-- depósitos grandes es contar un poco todos los días, más seguido lo que más
-- importa. Esta función propone la lista del día:
--   · clase A / B / C por valor movido en 30 días (unidades vendidas × costo):
--     el 20 % de arriba es A, el 30 % siguiente B, el resto C;
--   · cada clase vuelve a contarse cada 7 / 30 / 90 días;
--   · primero lo que nunca se contó y lo que tuvo diferencias.
-- Sólo lee; el conteo se hace con la toma física de siempre.
BEGIN;

CREATE OR REPLACE FUNCTION public.productos_para_conteo_ciclico(
  p_org_id uuid,
  p_cantidad integer DEFAULT 15
) RETURNS TABLE (
  product_id uuid,
  nombre text,
  clase text,
  motivo text,
  dias_sin_contar integer,
  prioridad numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.has_permission(p_org_id, 'inventory', 'view') THEN
    RAISE EXCEPTION 'Sin permiso para ver el inventario' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH tc AS (
    SELECT COALESCE(NULLIF(s.exchange_rate, 0), 1) AS tasa
      FROM public.settings s WHERE s.org_id = p_org_id
     LIMIT 1
  ),
  base AS (
    SELECT p.id, p.name,
           COALESCE(NULLIF(p.cost_ars, 0), p.cost_usd * COALESCE((SELECT tasa FROM tc), 1), 0) AS costo
      FROM public.products p
     WHERE p.org_id = p_org_id
       AND COALESCE(p.is_active, true)
       AND COALESCE(p.maneja_stock, true)
  ),
  ventas AS (
    SELECT m.product_id, -SUM(m.quantity) AS unidades
      FROM public.stock_movements m
     WHERE m.org_id = p_org_id AND m.movement_type = 'sale'
       AND m.created_at >= now() - interval '30 days'
     GROUP BY m.product_id
  ),
  contados AS (
    SELECT i.product_id,
           MAX(i.counted_at) AS ultimo,
           AVG(ABS(COALESCE(i.ajuste, 0)) / GREATEST(ABS(i.expected), 1)) AS desvio
      FROM public.stock_count_items i
      JOIN public.stock_counts c ON c.id = i.count_id AND c.status = 'cerrado'
     WHERE i.org_id = p_org_id AND i.counted IS NOT NULL
     GROUP BY i.product_id
  ),
  valorados AS (
    SELECT b.id, b.name,
           COALESCE(v.unidades, 0) * b.costo AS valor_movido,
           c.ultimo, COALESCE(c.desvio, 0) AS desvio
      FROM base b
      LEFT JOIN ventas v ON v.product_id = b.id
      LEFT JOIN contados c ON c.product_id = b.id
  ),
  clasificados AS (
    SELECT x.*,
           CASE
             WHEN x.valor_movido > 0 AND percent_rank() OVER (ORDER BY x.valor_movido DESC) < 0.2 THEN 'A'
             WHEN x.valor_movido > 0 AND percent_rank() OVER (ORDER BY x.valor_movido DESC) < 0.5 THEN 'B'
             ELSE 'C'
           END AS clase
      FROM valorados x
  ),
  vencidos AS (
    SELECT k.*,
           CASE k.clase WHEN 'A' THEN 7 WHEN 'B' THEN 30 ELSE 90 END AS periodo,
           CASE WHEN k.ultimo IS NULL THEN NULL
                ELSE GREATEST(0, (now()::date - (k.ultimo AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
           END AS dias
      FROM clasificados k
  )
  SELECT z.id, z.name, z.clase,
         CASE
           WHEN z.ultimo IS NULL THEN 'Nunca se contó'
           WHEN z.desvio >= 0.1 THEN 'Tuvo diferencias en conteos anteriores'
           WHEN z.clase = 'A' THEN 'Mueve mucha plata: se cuenta cada semana'
           ELSE format('Hace %s días que no se cuenta', z.dias)
         END,
         z.dias::integer,
         round(
           (CASE WHEN z.ultimo IS NULL THEN 2.0 ELSE z.dias::numeric / z.periodo END)
           * (1 + LEAST(z.desvio, 1) * 2)
           * CASE z.clase WHEN 'A' THEN 1.5 WHEN 'B' THEN 1.2 ELSE 1 END, 3)
    FROM vencidos z
   WHERE z.ultimo IS NULL OR z.dias >= z.periodo
   ORDER BY 6 DESC, z.name
   LIMIT GREATEST(1, LEAST(COALESCE(p_cantidad, 15), 100));
END;
$fn$;

COMMENT ON FUNCTION public.productos_para_conteo_ciclico(uuid, integer) IS
  'Lista del conteo cíclico del día: clase ABC por valor movido en 30 días, cada clase vuelve cada 7/30/90 días; primero lo nunca contado y lo que tuvo diferencias.';

REVOKE ALL ON FUNCTION public.productos_para_conteo_ciclico(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.productos_para_conteo_ciclico(uuid, integer) TO authenticated;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige ser miembro con permiso de ver inventario; sólo lee productos, ventas y conteos de su negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-11-06'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'productos_para_conteo_ciclico'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
