-- ═══════════════════════════════════════════════════════════════════════════
-- Si una pantalla se aparta del ledger, se tiene que ver
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El diagnóstico de consolidación decía que Analytics, Reportes y el P&L
-- competían por ser la verdad financiera y proponía unificar cada métrica en un
-- registro (ANA-001, KPI Registry).
--
-- 📌 **Medido el 2026-08-27 antes de refactorizar: ya no divergen.** Después de
-- que el ledger recibiera las operaciones (`20260826000260`–`000300`) y de que
-- se reparara el costo de las 34 ventas (`20260826000250`), la serie mensual
-- que arman Analytics y Reportes desde `sales` coincide **peso por peso** con
-- la del ledger:
--
--     mes       ingreso ledger = analytics    COGS ledger = analytics
--     2026-04   616.784                       437.265
--     2026-05   526.910                       361.586
--     2026-07         2                             0
--
-- Entonces migrar esas pantallas al RPC canónico sería **consistencia
-- arquitectónica, no corrección**. Este repo tiene la regla de no construir por
-- prolijidad antes de lanzar; lo que sí hace falta es no volver a enterarse
-- tarde.
--
-- ── Qué hace esta vista ───────────────────────────────────────────────────
--
-- Compara, mes a mes, lo que dice el ledger contra lo que sale de la fuente
-- operativa con la misma fórmula que usan las pantallas
-- (`ingreso = Σ total_ars`, `COGS = Σ (total_ars − profit_ars)`).
--
-- ⚠️ **Tiene que estar vacía.** Una fila acá significa que el P&L, Analytics y
-- Reportes están mostrando números distintos para el mismo mes — el problema
-- original, que volvió.
--
-- Tolerancia de $1 por el redondeo a dos decimales de cada línea del asiento.
-- Más que eso no es redondeo.
--
-- 📌 Los meses que existen en una fuente y no en la otra **también aparecen**:
-- una venta sin asentar es exactamente la clase de silencio que hay que ver.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_resultado_divergente AS
WITH del_ledger AS (
  SELECT l.org_id,
         date_trunc('month', e.fecha)::date AS mes,
         COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0) AS ingreso,
         COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0) AS costo
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE e.anulado_por IS NULL AND e.anula_a IS NULL
   GROUP BY 1, 2
),
de_las_pantallas AS (
  SELECT s.org_id,
         date_trunc('month', s.date)::date AS mes,
         COALESCE(SUM(s.total_ars), 0)                        AS ingreso,
         COALESCE(SUM(s.total_ars - s.profit_ars), 0)          AS costo
    FROM public.sales s
   WHERE COALESCE(s.total_ars, 0) > 0
   GROUP BY 1, 2
)
SELECT
  COALESCE(l.org_id, p.org_id)                       AS org_id,
  COALESCE(l.mes, p.mes)                             AS mes,
  ROUND(COALESCE(l.ingreso, 0), 2)                   AS ingreso_ledger,
  ROUND(COALESCE(p.ingreso, 0), 2)                   AS ingreso_pantallas,
  ROUND(COALESCE(l.costo, 0), 2)                     AS costo_ledger,
  ROUND(COALESCE(p.costo, 0), 2)                     AS costo_pantallas,
  ROUND(COALESCE(l.ingreso, 0) - COALESCE(p.ingreso, 0), 2) AS dif_ingreso,
  ROUND(COALESCE(l.costo, 0) - COALESCE(p.costo, 0), 2)     AS dif_costo,
  CASE WHEN l.mes IS NULL THEN 'el mes no tiene asientos: hay ventas sin asentar'
       WHEN p.mes IS NULL THEN 'hay asientos sin ventas que los expliquen'
       ELSE 'los importes no coinciden' END           AS motivo
FROM del_ledger l
FULL OUTER JOIN de_las_pantallas p
  ON p.org_id = l.org_id AND p.mes = l.mes
WHERE (l.mes IS NULL OR p.mes IS NULL
       OR abs(COALESCE(l.ingreso, 0) - COALESCE(p.ingreso, 0)) > 1
       OR abs(COALESCE(l.costo, 0) - COALESCE(p.costo, 0)) > 1)
  AND public.is_org_member(COALESCE(l.org_id, p.org_id), auth.uid());

COMMENT ON VIEW public.audit_resultado_divergente IS
  'Meses donde el ledger y la fuente operativa no dicen lo mismo. Tiene que estar VACIA: una fila significa que el P&L, Analytics y Reportes muestran numeros distintos para el mismo mes.';

REVOKE ALL ON public.audit_resultado_divergente FROM anon;
GRANT SELECT ON public.audit_resultado_divergente TO authenticated;

-- ── Verificación, en los dos sentidos ─────────────────────────────────────
DO $verif$
DECLARE
  v_org   uuid;
  v_user  uuid;
  v_filas int;
  v_sale  uuid;
  v_prod  uuid;
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.sales s WHERE s.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_filas FROM public.audit_resultado_divergente;
  RESET ROLE;

  ASSERT v_filas = 0,
    'el ledger y las pantallas ya divergen en ' || v_filas || ' mes(es)';

  -- ⚠️ Y que SÍ detecte: una vista que no devuelve nada nunca tampoco sirve de
  --    guarda. Se crea una venta sin asentar (el trigger se desactiva a
  --    propósito) y se comprueba que aparece. Se deshace todo al final.
  SELECT p.id INTO v_prod FROM public.products p WHERE p.org_id = v_org LIMIT 1;

  ALTER TABLE public.sales DISABLE TRIGGER trg_sale_ledger;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
    unit_price_ars, total_ars, cost_of_goods_ars, profit_ars, customer_name,
    date, paid, payment_method, source)
  VALUES (v_org, v_user, v_prod, 'ZZ divergencia', 1,
    777000, 777000, 400000, 377000, 'ZZ', CURRENT_DATE, true, 'efectivo', 'manual')
  RETURNING id INTO v_sale;
  ALTER TABLE public.sales ENABLE TRIGGER trg_sale_ledger;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_filas FROM public.audit_resultado_divergente;
  RESET ROLE;

  DELETE FROM public.stock_movements WHERE reference_id = v_sale;
  DELETE FROM public.sales WHERE id = v_sale;

  ASSERT v_filas > 0, 'la vista NO detecto una venta sin asentar: no sirve como guarda';

  -- Y después de deshacerlo, vuelve a estar vacía.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_filas FROM public.audit_resultado_divergente;
  RESET ROLE;
  ASSERT v_filas = 0, 'quedaron restos ZZ: la vista sigue con ' || v_filas || ' fila(s)';

  RAISE NOTICE 'OK: vacia hoy, y detecta una venta sin asentar cuando la hay';
END $verif$;
