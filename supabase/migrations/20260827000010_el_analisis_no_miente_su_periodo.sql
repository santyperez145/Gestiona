-- ═══════════════════════════════════════════════════════════════════════════
-- El análisis ABC no puede mentir su propio período
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Preparando que Reposición consuma `run_abc_analysis` (INV-001) apareció esto:
-- `inventory_abc` tiene `UNIQUE (org_id, product_id, analysis_date)` y el
-- `ON CONFLICT DO UPDATE` del motor actualiza todas las métricas **menos
-- `period_days`**.
--
-- ⚠️ Consecuencia: si el análisis corre con 90 días y después corre con 30 el
-- mismo día —que es exactamente lo que pasa cuando dos vistas comparten el
-- motor con períodos distintos— la fila queda con los números del análisis de
-- 30 días **diciendo que son de 90**. El dato queda etiquetado con la ventana
-- equivocada, y "velocidad sobre 90 días" y "velocidad sobre 30" no son
-- comparables.
--
-- El arreglo es una línea: `period_days` entra al DO UPDATE. La función se
-- regeneró desde `pg_get_functiondef` — regla de la casa para funciones
-- grandes — cambiando sólo eso.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $patch$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_abc_analysis';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'run_abc_analysis no existe';
  END IF;

  -- Ya parcheada: no hay nada que hacer.
  IF v_def LIKE '%period_days   = EXCLUDED.period_days%' THEN
    RAISE NOTICE 'run_abc_analysis ya actualiza period_days';
    RETURN;
  END IF;

  IF v_def NOT LIKE '%DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,%' THEN
    RAISE EXCEPTION 'el DO UPDATE no tiene la forma esperada: revisar a mano';
  END IF;

  v_def := replace(v_def,
    'DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,',
    'DO UPDATE SET
    -- ⚠️ Sin esto, correr con otro período el mismo día dejaba los números
    -- nuevos etiquetados con la ventana vieja. Ver 20260827000010.
    period_days   = EXCLUDED.period_days,
    total_revenue = EXCLUDED.total_revenue,');

  EXECUTE v_def;
  RAISE NOTICE 'run_abc_analysis regenerada con period_days en el DO UPDATE';
END $patch$;

-- ── Verificación: correr 90 y después 30 el mismo día, y mirar la etiqueta ──
DO $verif$
DECLARE
  v_org  uuid;
  v_user uuid;
  v_mal  int;
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.sales s WHERE s.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;

  -- Como el rol real: la función exige membresía.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  PERFORM public.run_abc_analysis(v_org, 90);
  PERFORM public.run_abc_analysis(v_org, 30);

  RESET ROLE;

  -- ⚠️ El primer assert de esta verificación estaba mal y falló contra
  -- producción: exigía que NINGUNA fila de hoy dijera 90. Pero un producto
  -- sin ventas en los últimos 30 días no entra a la corrida de 30, y su fila
  -- de 90 queda — legítimamente. El invariante real es doble:
  --
  --   1. lo que la corrida de 30 tocó (productos con ventas en 30d) dice 30
  --   2. lo que quedó en 90 es EXACTAMENTE lo que no tenía ventas en 30d
  SELECT count(*) INTO v_mal
    FROM public.inventory_abc a
   WHERE a.org_id = v_org AND a.analysis_date = CURRENT_DATE AND a.period_days <> 30
     AND EXISTS (SELECT 1 FROM public.sales s
                  WHERE s.org_id = v_org AND s.product_id = a.product_id
                    AND s.date >= now() - interval '30 days');
  ASSERT v_mal = 0,
    v_mal || ' productos CON ventas recientes quedaron etiquetados con el período viejo';

  SELECT count(*) INTO v_mal
    FROM public.inventory_abc a
   WHERE a.org_id = v_org AND a.analysis_date = CURRENT_DATE AND a.period_days = 30
     AND NOT EXISTS (SELECT 1 FROM public.sales s
                  WHERE s.org_id = v_org AND s.product_id = a.product_id
                    AND s.date >= now() - interval '30 days');
  ASSERT v_mal = 0,
    v_mal || ' filas dicen período 30 sin ventas en esa ventana';

  RAISE NOTICE 'OK: la segunda corrida del día re-etiqueta el período';
END $verif$;
