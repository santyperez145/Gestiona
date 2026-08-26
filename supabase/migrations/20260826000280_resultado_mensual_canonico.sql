-- ═══════════════════════════════════════════════════════════════════════════
-- Un solo lugar donde se calcula el resultado por mes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `FIN-001` pide "un RPC canónico para resultado". Los que había no alcanzaban
-- para la pantalla que más se mira:
--
--   · `ledger_resultado(org, desde, hasta)` devuelve **un** período, no una
--     serie. El P&L muestra doce meses.
--   · `ledger_resultado_diario` devuelve una serie, pero sólo `ventas`, `costo`
--     y `margen`: **no trae gastos**, así que no puede dar resultado neto.
--
-- Llamar doce veces a `ledger_resultado` desde el navegador funcionaría y sería
-- exactamente lo que hay que evitar: doce viajes para armar un número que la
-- base puede dar en uno.
--
-- ── Por qué esto y no seguir calculando en el cliente ─────────────────────
--
-- Hasta hoy `PLDashboardPage` cargaba ventas, gastos y compras y armaba el P&L
-- en el navegador. `ReportsPage` y `AnalyticsPage` hacen lo suyo por separado.
-- Con tres cálculos distintos, el mismo mes puede dar tres números según qué
-- pantalla se abra — y uno de ellos ya estaba mal: el P&L informaba margen bruto
-- 100% porque el costo le daba cero (ver 20260826000250).
--
-- Este RPC es la fuente. Suma **cuentas**, no filas de `sales`: si mañana entra
-- un ingreso que no es una venta, aparece acá sin tocar la pantalla.
--
-- 📌 Devuelve también `ventas_sin_costo` por mes. Un mes con ventas sin costo
-- tiene el margen mejor de lo que es, y la pantalla tiene que poder decirlo en
-- lugar de mostrar un número lindo.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ledger_resultado_mensual(
  p_org uuid,
  p_meses int DEFAULT 12)
RETURNS TABLE(
  mes                  date,
  ventas               numeric,
  fletes_cobrados      numeric,
  ingresos             numeric,
  costo_mercaderia     numeric,
  margen_bruto         numeric,
  comision_medios_pago numeric,
  comision_plataforma  numeric,
  fletes_pagados       numeric,
  otros_gastos         numeric,
  gastos_operativos    numeric,
  resultado            numeric,
  asientos             int,
  ventas_sin_costo     int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_desde date := (date_trunc('month', CURRENT_DATE)
                   - make_interval(months => GREATEST(COALESCE(p_meses, 12), 1) - 1))::date;
BEGIN
  -- El resultado economico de un comercio es de lo mas sensible que hay.
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para ver el resultado de esta organización';
  END IF;

  RETURN QUERY
  WITH movimiento AS (
    SELECT date_trunc('month', e.fecha)::date AS mes,
           e.id AS entry_id,
           a.codigo,
           l.debe,
           l.haber
      FROM public.ledger_lines l
      JOIN public.ledger_entries e ON e.id = l.entry_id
      JOIN public.ledger_accounts a ON a.id = l.account_id
     WHERE l.org_id = p_org
       AND e.fecha >= v_desde
       -- Un asiento anulado y su anulación se cancelan en los importes, pero
       -- contarlos inflaría `asientos`. Mismo criterio que `ledger_resultado`.
       AND e.anulado_por IS NULL AND e.anula_a IS NULL
  ),
  -- Ventas sin costo, por mes: asientos de venta u orden sin línea en 5.1.01.
  sin_costo AS (
    SELECT date_trunc('month', e.fecha)::date AS mes, count(*)::int AS n
      FROM public.ledger_entries e
     WHERE e.org_id = p_org
       AND e.fecha >= v_desde
       AND e.anulado_por IS NULL AND e.anula_a IS NULL
       AND e.referencia_tipo IN ('orden', 'venta')
       AND NOT EXISTS (
         SELECT 1 FROM public.ledger_lines l2
           JOIN public.ledger_accounts a2 ON a2.id = l2.account_id
          WHERE l2.entry_id = e.id AND a2.codigo = '5.1.01' AND l2.debe > 0)
     GROUP BY 1
  ),
  agregado AS (
    SELECT m.mes,
           COALESCE(SUM(m.haber - m.debe) FILTER (WHERE m.codigo = '4.1.01'), 0) AS ventas,
           COALESCE(SUM(m.haber - m.debe) FILTER (WHERE m.codigo = '4.1.02'), 0) AS fletes,
           COALESCE(SUM(m.debe - m.haber) FILTER (WHERE m.codigo = '5.1.01'), 0) AS costo,
           COALESCE(SUM(m.debe - m.haber) FILTER (WHERE m.codigo = '5.2.01'), 0) AS com_mp,
           COALESCE(SUM(m.debe - m.haber) FILTER (WHERE m.codigo = '5.2.02'), 0) AS com_plat,
           COALESCE(SUM(m.debe - m.haber) FILTER (WHERE m.codigo = '5.3.01'), 0) AS flete_pag,
           COALESCE(SUM(m.debe - m.haber) FILTER (WHERE m.codigo = '5.9.01'), 0) AS otros,
           COUNT(DISTINCT m.entry_id)::int AS asientos
      FROM movimiento m
     GROUP BY m.mes
  )
  SELECT g.mes,
         g.ventas,
         g.fletes,
         g.ventas + g.fletes,
         g.costo,
         g.ventas - g.costo,
         g.com_mp,
         g.com_plat,
         g.flete_pag,
         g.otros,
         g.com_mp + g.com_plat + g.flete_pag + g.otros,
         (g.ventas + g.fletes) - g.costo - g.com_mp - g.com_plat - g.flete_pag - g.otros,
         g.asientos,
         COALESCE(sc.n, 0)
    FROM agregado g
    LEFT JOIN sin_costo sc ON sc.mes = g.mes
   ORDER BY g.mes;
END;
$fn$;

COMMENT ON FUNCTION public.ledger_resultado_mensual(uuid, int) IS
  'Resultado por mes desde el ledger: la fuente unica del P&L. Suma cuentas, no filas de sales. Devuelve ventas_sin_costo por mes porque un mes con ventas sin costo tiene el margen mejor de lo que es.';

REVOKE ALL ON FUNCTION public.ledger_resultado_mensual(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_resultado_mensual(uuid, int) TO authenticated;

-- ── Verificación: contra la fuente operativa y como el rol real ───────────
DO $verif$
DECLARE
  v_org     uuid;
  v_user    uuid;
  v_ventas  numeric;
  v_costo   numeric;
  v_gastos  numeric;
  v_meses   int;
  v_rventas numeric;
  v_rcosto  numeric;
  v_rgastos numeric;
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.sales s WHERE s.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;

  SELECT COALESCE(SUM(s.total_ars), 0), COALESCE(SUM(s.cost_of_goods_ars), 0)
    INTO v_ventas, v_costo FROM public.sales s WHERE s.org_id = v_org;
  SELECT COALESCE(SUM(e.amount_ars), 0) INTO v_gastos
    FROM public.expenses e WHERE e.org_id = v_org;

  -- ⚠️ Como el comercio, no como superusuario: la funcion exige membresia y un
  --    bloque DO normal la saltearia.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  SELECT COALESCE(SUM(r.ventas), 0), COALESCE(SUM(r.costo_mercaderia), 0),
         COALESCE(SUM(r.otros_gastos), 0), count(*)::int
    INTO v_rventas, v_rcosto, v_rgastos, v_meses
    FROM public.ledger_resultado_mensual(v_org, 24) r;

  RESET ROLE;

  ASSERT v_meses > 0, 'la funcion no devolvio ningun mes';
  ASSERT abs(v_rventas - v_ventas) <= 1,
    'las ventas no concilian: RPC ' || v_rventas || ' vs sales ' || v_ventas;
  ASSERT abs(v_rcosto - v_costo) <= 1,
    'el costo no concilia: RPC ' || v_rcosto || ' vs sales ' || v_costo;
  ASSERT abs(v_rgastos - v_gastos) <= 1,
    'los gastos no concilian: RPC ' || v_rgastos || ' vs expenses ' || v_gastos;

  RAISE NOTICE 'OK: % meses, ventas $%, costo $%, gastos $% — concilia con la fuente operativa',
    v_meses, round(v_rventas), round(v_rcosto), round(v_rgastos);
END $verif$;
