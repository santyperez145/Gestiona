-- ═══════════════════════════════════════════════════════════════════════════
-- La cobranza del fiado también se asienta
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260826000260` dejó dicho el hueco de frente: la venta fiado queda en
-- `1.2.01 Deudores por ventas` y ahí se queda aunque la deuda esté saldada. El
-- resultado era correcto; el balance mostraba $149.500 de créditos ya cobrados.
--
-- ── De qué evento cuelga, y por qué NO de `debt_payments` ─────────────────
--
-- La intuición dice "trigger sobre `debt_payments`". Medido, eso se pierde los
-- caminos reales: `debt_payments` tiene **0 filas con 3 deudas pagadas**,
-- porque `DebtsPage` tiene dos botones —"marcar pagada" en masa y "Cobrar
-- todo"— que actualizan `debts` directo, sin crear el pago. Sólo
-- `addDebtPaymentDB` inserta en `debt_payments`, y encima **después** de
-- actualizar la deuda, en otra request: un trigger sobre el pago no puede
-- coordinarse con el update sin inventar estado compartido.
--
-- Lo único que TODOS los caminos tocan, exactamente una vez por cobranza, es
-- **`debts.paid_ars`**. El evento es el delta:
--
--     sube  → cobranza: Caja D / Deudores H, por la diferencia
--     baja  → NO se asienta y queda un WARNING: una corrección de deuda es un
--             contraasiento con criterio propio, no un número negativo metido
--             a presión
--
-- ⚠️ La cuenta de destino es Caja siempre. El medio de pago vive en
-- `debt_payments`, que llega en otra request y a veces nunca: elegir Banco a
-- veces y Caja otras según una fila que puede no existir sería un balance que
-- depende de una carrera. Caja, dicho en la metadata, y corregible por
-- contraasiento si alguna vez importa.
--
-- ── Las 3 cobranzas históricas ────────────────────────────────────────────
--
-- Karima $54.100, Karima $49.400, Ornella $46.000: pagadas, sin fila de pago.
-- Se asientan con **fecha = `updated_at`** (2026-07-31), que es "a más tardar
-- ese día ya estaba cobrada", y la metadata lo marca como fecha estimada.
--
-- 📌 Esto no es backfillear para que un reporte dé limpio — la regla de
-- CONTRIBUTING.md sigue en pie. La cobranza **ocurrió** (status pagada, importe
-- exacto, cliente y venta identificados); lo único aproximado es el día, y
-- queda declarado en el asiento en vez de escondido. La alternativa era un
-- balance con $149.500 de deudores falsos para siempre.
--
-- La cobranza no toca el resultado: mueve activo contra activo. La serie
-- mensual del P&L no cambia con nada de esto.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_asentar_cobranza()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_delta numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = NEW.org_id) THEN
    RETURN NEW;
  END IF;

  v_delta := ROUND(COALESCE(NEW.paid_ars, 0) - COALESCE(OLD.paid_ars, 0), 2);

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  IF v_delta < 0 THEN
    -- Una corrección no es una cobranza negativa: es un contraasiento que
    -- alguien tiene que decidir. Se avisa y no se inventa.
    RAISE WARNING 'la deuda % bajo su pagado en %: corresponde contraasiento manual', NEW.id, -v_delta;
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar(
      p_org         := NEW.org_id,
      p_descripcion := 'Cobranza' || COALESCE(' — ' || NEW.customer_name, ''),
      p_lineas      := jsonb_build_array(
        jsonb_build_object('cuenta', '1.1.01', 'debe', v_delta,
          'detalle', 'Cobro de deuda',
          'metadata', jsonb_build_object('debt_id', NEW.id, 'medio', 'sin registrar: ver debt_payments')),
        jsonb_build_object('cuenta', '1.2.01', 'haber', v_delta,
          'detalle', 'Cancelacion de deudores')),
      p_fecha       := CURRENT_DATE,
      p_ref_tipo    := 'cobranza',
      p_ref_id      := NEW.id);
  EXCEPTION WHEN others THEN
    -- El cobro se guarda igual: la contabilidad nunca voltea la operación.
    RAISE WARNING 'la cobranza de la deuda % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_debt_ledger ON public.debts;
CREATE TRIGGER trg_debt_ledger
  AFTER UPDATE OF paid_ars ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.trg_asentar_cobranza();

-- ── Las 3 históricas ──────────────────────────────────────────────────────
DO $backfill$
DECLARE
  v_d record;
  v_n int := 0;
BEGIN
  FOR v_d IN
    SELECT d.* FROM public.debts d
     WHERE COALESCE(d.paid_ars, 0) > 0
       AND EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = d.org_id)
       -- Sólo las que no tienen ya su cobranza asentada.
       AND NOT EXISTS (
         SELECT 1 FROM public.ledger_entries e
          WHERE e.org_id = d.org_id AND e.referencia_tipo = 'cobranza'
            AND e.referencia_id = d.id
            AND e.anulado_por IS NULL AND e.anula_a IS NULL)
  LOOP
    PERFORM public.ledger_asentar(
      p_org         := v_d.org_id,
      p_descripcion := 'Cobranza' || COALESCE(' — ' || v_d.customer_name, ''),
      p_lineas      := jsonb_build_array(
        jsonb_build_object('cuenta', '1.1.01', 'debe', ROUND(v_d.paid_ars, 2),
          'detalle', 'Cobro de deuda (historico)',
          'metadata', jsonb_build_object('debt_id', v_d.id,
            'fecha_estimada', true,
            'nota', 'cobrada a mas tardar en esta fecha; no hay fila de pago')),
        jsonb_build_object('cuenta', '1.2.01', 'haber', ROUND(v_d.paid_ars, 2),
          'detalle', 'Cancelacion de deudores')),
      p_fecha       := v_d.updated_at::date,
      p_ref_tipo    := 'cobranza',
      p_ref_id      := v_d.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cobranzas historicas asentadas: %', v_n;
END $backfill$;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_org uuid; v_user uuid; v_prod uuid; v_sale uuid; v_debt uuid;
  v_deudores numeric; v_n int;
  v_sufijo text := substr(md5(clock_timestamp()::text), 1, 8);
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.ledger_accounts a WHERE a.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;

  -- 1. Con las históricas asentadas, Deudores del libro tiene que netear cero:
  --    las 3 ventas fiado entraron por el debe y las 3 cobranzas por el haber.
  SELECT ROUND(COALESCE(SUM(l.debe - l.haber), 0), 2) INTO v_deudores
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = v_org AND a.codigo = '1.2.01'
     AND e.anulado_por IS NULL AND e.anula_a IS NULL;
  ASSERT v_deudores = 0,
    'Deudores quedo en ' || v_deudores || ': las cobranzas no netearon las ventas fiado';

  -- 2. Una cobranza nueva por cualquier camino (update directo, como los
  --    botones de DebtsPage) asienta sola.
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock, is_active)
  VALUES (v_org, v_user, 'ZZ cobranza ' || v_sufijo, 9000, 1, 5, true) RETURNING id INTO v_prod;

  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
    unit_price_ars, total_ars, cost_of_goods_ars, profit_ars, customer_name,
    date, paid, payment_method, source)
  VALUES (v_org, v_user, v_prod, 'ZZ cobranza ' || v_sufijo, 1,
    9000, 9000, 5000, 4000, 'ZZ Fiado', CURRENT_DATE, true, 'fiado', 'manual')
  RETURNING id INTO v_sale;

  INSERT INTO public.debts (org_id, user_id, sale_id, customer_name, amount_ars,
    paid_ars, remaining_ars, status, date)
  VALUES (v_org, v_user, v_sale, 'ZZ Fiado', 9000, 0, 9000, 'pending', CURRENT_DATE)
  RETURNING id INTO v_debt;

  -- Cobro parcial y saldo, como los dos gestos reales de la UI.
  UPDATE public.debts SET paid_ars = 4000, remaining_ars = 5000, status = 'partial'
   WHERE id = v_debt;
  UPDATE public.debts SET paid_ars = 9000, remaining_ars = 0, status = 'paid'
   WHERE id = v_debt;

  SELECT count(*) INTO v_n FROM public.ledger_entries e
   WHERE e.referencia_tipo = 'cobranza' AND e.referencia_id = v_debt;
  ASSERT v_n = 2, 'se esperaban 2 asientos de cobranza (parcial y saldo), hay ' || v_n;

  SELECT ROUND(COALESCE(SUM(l.debe), 0), 2) INTO v_deudores
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE e.referencia_tipo = 'cobranza' AND e.referencia_id = v_debt
     AND a.codigo = '1.1.01';
  ASSERT v_deudores = 9000, 'las cobranzas suman ' || v_deudores || ', se esperaban 9000';

  -- 3. Y una baja del pagado NO asienta (queda para contraasiento manual).
  UPDATE public.debts SET paid_ars = 8000 WHERE id = v_debt;
  SELECT count(*) INTO v_n FROM public.ledger_entries e
   WHERE e.referencia_tipo = 'cobranza' AND e.referencia_id = v_debt;
  ASSERT v_n = 2, 'una correccion hacia abajo genero un asiento';

  -- ── Limpieza: contraasentar los ZZ (el libro es inmutable) y borrar filas ─
  PERFORM public.ledger_contraasentar(e.id, 'ZZ limpieza de verificacion')
    FROM public.ledger_entries e
   WHERE (e.referencia_tipo = 'cobranza' AND e.referencia_id = v_debt)
      OR (e.referencia_tipo = 'venta'    AND e.referencia_id = v_sale);

  DELETE FROM public.debts WHERE id = v_debt;
  DELETE FROM public.sales WHERE id = v_sale;
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;

  SELECT ROUND(COALESCE(SUM(l.debe - l.haber), 0), 2) INTO v_deudores
    FROM public.ledger_lines l JOIN public.ledger_entries e ON e.id = l.entry_id
   WHERE e.descripcion LIKE '%ZZ%';
  ASSERT v_deudores = 0, 'los asientos ZZ no quedaron neteados: ' || v_deudores;

  RAISE NOTICE 'OK: deudores neteado, la cobranza se asienta por cualquier camino y las bajas no inventan asientos';
END $verif$;
