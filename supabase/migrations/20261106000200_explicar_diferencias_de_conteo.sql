-- Por qué faltó o sobró (2026-11-06).
--
-- Cerrar una toma deja un número («faltan 6») pero no qué hacer con él. Esta
-- función cruza cada diferencia con los movimientos del producto en los 60
-- días previos a contarlo y da pistas concretas: una compra reciente que pudo
-- no llegar completa, mucha venta (posible venta sin registrar), devoluciones
-- que volvieron al estante, transferencias, o nada registrado (rotura, robo,
-- vencimiento). Es un diagnóstico por reglas, sin IA: instantáneo y gratis.
-- Sólo lee.
BEGIN;

CREATE OR REPLACE FUNCTION public.explicar_diferencias_de_conteo(p_count_id uuid)
RETURNS TABLE (
  product_id uuid,
  nombre text,
  diferencia numeric,
  valor numeric,
  pistas text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_tasa numeric;
BEGIN
  SELECT c.org_id INTO v_org FROM public.stock_counts c WHERE c.id = p_count_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_org, auth.uid())
     OR NOT public.has_permission(v_org, 'inventory', 'view') THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(NULLIF(s.exchange_rate, 0), 1) INTO v_tasa FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  RETURN QUERY
  WITH items AS (
    SELECT i.product_id AS pid, p.name AS pnombre,
           -- Cerrado: el ajuste aplicado. Abierto: contra lo esperado.
           COALESCE(i.ajuste, i.counted - i.expected) AS dif,
           COALESCE(i.counted_at, now()) AS cuando,
           COALESCE(NULLIF(p.cost_ars, 0), p.cost_usd * COALESCE(v_tasa, 1), 0) AS costo
      FROM public.stock_count_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.count_id = p_count_id AND i.counted IS NOT NULL
       AND COALESCE(i.ajuste, i.counted - i.expected) <> 0
  ),
  mov AS (
    SELECT it.pid,
           COALESCE(SUM(-m.quantity) FILTER (WHERE m.movement_type = 'sale'), 0) AS vendidas,
           COUNT(*) FILTER (WHERE m.movement_type = 'sale') AS ventas,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type IN ('purchase', 'purchase_edited')), 0) AS compradas,
           MAX(m.created_at) FILTER (WHERE m.movement_type IN ('purchase', 'purchase_edited')) AS ultima_compra,
           (ARRAY_AGG(m.quantity ORDER BY m.created_at DESC) FILTER (WHERE m.movement_type IN ('purchase', 'purchase_edited')))[1] AS ultima_compra_cant,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type = 'return_in'), 0) AS devueltas,
           COALESCE(SUM(-m.quantity) FILTER (WHERE m.movement_type = 'transfer_out'), 0) AS transferidas,
           COUNT(*) FILTER (WHERE m.movement_type IN ('adjustment', 'adjustment_in', 'adjustment_out')) AS ajustes_manuales,
           COUNT(m.id) FILTER (WHERE m.movement_type <> 'initial') AS movimientos
      FROM items it
      LEFT JOIN public.stock_movements m
        ON m.org_id = v_org AND m.product_id = it.pid
       AND m.created_at BETWEEN it.cuando - interval '60 days' AND it.cuando
       AND m.reference_type IS DISTINCT FROM 'stock_count'
     GROUP BY it.pid
  )
  SELECT it.pid, it.pnombre, it.dif, round(it.dif * it.costo, 2),
         array_remove(ARRAY[
           -- Faltantes
           CASE WHEN it.dif < 0 AND mv.ultima_compra IS NOT NULL AND mv.ultima_compra >= it.cuando - interval '15 days'
                     AND mv.ultima_compra_cant >= abs(it.dif)
                THEN format('La última compra (%s) sumó %s: revisá que haya llegado completa.',
                            to_char(mv.ultima_compra AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM'), trim_scale(mv.ultima_compra_cant)) END,
           CASE WHEN it.dif < 0 AND mv.vendidas >= GREATEST(abs(it.dif) * 3, 10)
                THEN format('Vende mucho (%s en 60 días): puede haber ventas sin registrar en la caja.', trim_scale(mv.vendidas)) END,
           CASE WHEN it.dif < 0 AND mv.transferidas > 0
                THEN format('Salieron %s por transferencia: revisá que la otra sucursal los haya recibido.', trim_scale(mv.transferidas)) END,
           CASE WHEN it.dif < 0 AND mv.movimientos = 0
                THEN 'Sin movimientos registrados en 60 días: posible rotura, vencimiento o robo.' END,
           -- Sobrantes
           CASE WHEN it.dif > 0 AND mv.devueltas > 0
                THEN format('Hubo %s devoluciones de clientes: pueden haber vuelto al estante sin cargarse.', trim_scale(mv.devueltas)) END,
           CASE WHEN it.dif > 0 AND mv.compradas = 0
                THEN 'No hay compras registradas en 60 días: puede haber mercadería que entró sin cargar la compra.' END,
           CASE WHEN it.dif > 0 AND mv.ventas > 0
                THEN 'Puede haber una venta anulada o cargada dos veces que descontó de más.' END,
           -- Los dos
           CASE WHEN mv.ajustes_manuales > 0
                THEN format('Tuvo %s ajuste(s) manual(es) en 60 días: revisá si alguno se cargó al revés.', mv.ajustes_manuales) END
         ], NULL)
    FROM items it
    JOIN mov mv ON mv.pid = it.pid
   ORDER BY abs(it.dif * it.costo) DESC, it.pnombre;
END;
$fn$;

COMMENT ON FUNCTION public.explicar_diferencias_de_conteo(uuid) IS
  'Pistas por reglas de por qué faltó o sobró cada producto de un conteo, cruzando sus movimientos de los 60 días previos.';

REVOKE ALL ON FUNCTION public.explicar_diferencias_de_conteo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explicar_diferencias_de_conteo(uuid) TO authenticated;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige ser miembro con permiso de ver inventario del negocio del conteo; sólo lee.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-11-06'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'explicar_diferencias_de_conteo'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
