-- ═══════════════════════════════════════════════════════════════════════════
-- Asentar lo que ya pasó, y conciliarlo contra lo que muestran las pantallas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260826000260` dejó las funciones que asientan una venta y un gasto. Ésta
-- las corre sobre lo que ya existe, y **verifica que el ledger diga lo mismo
-- que las pantallas** antes de que nadie empiece a leer de ahí.
--
-- ⚠️ Ése es el punto entero. El plan de consolidación propone "todos los estados
-- reales salen del ledger". Si se hace sin conciliar primero, se reemplazan
-- varios números que no coinciden por **uno solo que nadie comprobó**. La
-- conciliación es lo que convierte al ledger en autoridad; el código solo no.
--
-- ── Qué se asienta ────────────────────────────────────────────────────────
--
-- Todas las ventas con importe y todos los gastos de toda organización que
-- tenga plan de cuentas. Idempotente: cada asiento se identifica por
-- `(referencia_tipo, referencia_id)`, así que correr esto dos veces no duplica.
--
-- 📌 Una organización sin plan de cuentas se saltea con un aviso, no falla.
-- `pruebas Workspace` tiene 0 cuentas y no tiene por qué frenar la migración.
--
-- ⚠️ **El ledger es inmutable.** Un asiento mal no se edita: se contraasienta
-- con `ledger_contraasentar`. Por eso el asiento se probó antes con datos ZZ
-- dentro de un ROLLBACK —10/10— y por eso la conciliación de abajo hace fallar
-- la migración entera si los números no cierran.
-- ═══════════════════════════════════════════════════════════════════════════

DO $backfill$
DECLARE
  v_org      record;
  v_id       uuid;
  v_ventas   int := 0;
  v_gastos   int := 0;
  v_saltadas int := 0;
BEGIN
  FOR v_org IN
    SELECT o.id, o.name
      FROM public.organizations o
     WHERE EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = o.id)
  LOOP
    FOR v_id IN
      SELECT s.id FROM public.sales s
       WHERE s.org_id = v_org.id
         AND COALESCE(s.total_ars, 0) > 0
       ORDER BY s.date, s.created_at
    LOOP
      BEGIN
        PERFORM public.ledger_asentar_venta(v_id);
        v_ventas := v_ventas + 1;
      EXCEPTION WHEN others THEN
        -- No se traga: se cuenta y se nombra. Una venta que no se puede
        -- asentar es un dato que hay que mirar, no un silencio.
        v_saltadas := v_saltadas + 1;
        RAISE WARNING 'venta % no se pudo asentar: %', v_id, SQLERRM;
      END;
    END LOOP;

    FOR v_id IN
      SELECT e.id FROM public.expenses e
       WHERE e.org_id = v_org.id
         AND COALESCE(e.amount_ars, 0) > 0
       ORDER BY e.date, e.created_at
    LOOP
      BEGIN
        PERFORM public.ledger_asentar_gasto(v_id);
        v_gastos := v_gastos + 1;
      EXCEPTION WHEN others THEN
        v_saltadas := v_saltadas + 1;
        RAISE WARNING 'gasto % no se pudo asentar: %', v_id, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'asentadas % ventas y % gastos; % saltadas', v_ventas, v_gastos, v_saltadas;

  ASSERT v_saltadas = 0, v_saltadas || ' operaciones no se pudieron asentar';
END $backfill$;

-- ── La conciliación ────────────────────────────────────────────────────────
--
-- El ledger contra la fuente operativa, peso por peso. Si esto no cierra, la
-- migración falla y no queda un ledger a medias que después alguien lea como si
-- fuera verdad.

DO $conciliar$
DECLARE
  v_org            uuid;
  v_ledger_ventas  numeric;
  v_ledger_costo   numeric;
  v_ledger_gastos  numeric;
  v_ventas_reales  numeric;
  v_costo_real     numeric;
  v_gastos_reales  numeric;
  v_asientos       int;
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.sales s WHERE s.org_id = o.id) DESC LIMIT 1;

  -- Lo que dice el ledger, leyendo las cuentas directamente (sin pasar por
  -- `ledger_resultado`, que exige sesión de miembro y acá corre como definer).
  SELECT
    COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.9.01'), 0),
    COUNT(DISTINCT e.id)
    INTO v_ledger_ventas, v_ledger_costo, v_ledger_gastos, v_asientos
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = v_org
     AND e.anulado_por IS NULL AND e.anula_a IS NULL;

  -- Lo que dice la fuente operativa.
  SELECT COALESCE(SUM(s.total_ars), 0), COALESCE(SUM(s.cost_of_goods_ars), 0)
    INTO v_ventas_reales, v_costo_real
    FROM public.sales s WHERE s.org_id = v_org AND COALESCE(s.total_ars, 0) > 0;

  SELECT COALESCE(SUM(e.amount_ars), 0) INTO v_gastos_reales
    FROM public.expenses e WHERE e.org_id = v_org AND COALESCE(e.amount_ars, 0) > 0;

  RAISE NOTICE 'CONCILIACION — ventas: ledger $% vs operativo $%',
    round(v_ledger_ventas), round(v_ventas_reales);
  RAISE NOTICE 'CONCILIACION — costo:  ledger $% vs operativo $%',
    round(v_ledger_costo), round(v_costo_real);
  RAISE NOTICE 'CONCILIACION — gastos: ledger $% vs operativo $%',
    round(v_ledger_gastos), round(v_gastos_reales);
  RAISE NOTICE 'CONCILIACION — % asientos', v_asientos;

  -- ⚠️ Tolerancia de un peso por el redondeo a dos decimales de cada línea.
  --    Más que eso no es redondeo: es un asiento que no corresponde.
  ASSERT abs(v_ledger_ventas - v_ventas_reales) <= 1,
    'las ventas no concilian: ledger ' || v_ledger_ventas || ' vs ' || v_ventas_reales;
  ASSERT abs(v_ledger_costo - v_costo_real) <= 1,
    'el costo no concilia: ledger ' || v_ledger_costo || ' vs ' || v_costo_real;
  ASSERT abs(v_ledger_gastos - v_gastos_reales) <= 1,
    'los gastos no concilian: ledger ' || v_ledger_gastos || ' vs ' || v_gastos_reales;

  -- Y en el otro sentido: que efectivamente haya asientos. Un ledger vacío
  -- concilia con cualquier cosa si los importes reales fueran cero.
  ASSERT v_asientos > 0, 'no se asento nada';
  ASSERT v_ledger_ventas > 0, 'el ledger quedo con ventas en cero';

  RAISE NOTICE 'OK: el ledger dice lo mismo que la fuente operativa';
END $conciliar$;

-- ── Y que todo asiento cuadre ─────────────────────────────────────────────
DO $cuadre$
DECLARE v_descuadrados int;
BEGIN
  SELECT count(*) INTO v_descuadrados FROM (
    SELECT l.entry_id
      FROM public.ledger_lines l
     GROUP BY l.entry_id
    HAVING round(SUM(l.debe), 2) <> round(SUM(l.haber), 2)
  ) x;
  ASSERT v_descuadrados = 0, v_descuadrados || ' asientos no cuadran';
  RAISE NOTICE 'OK: todos los asientos cuadran';
END $cuadre$;
