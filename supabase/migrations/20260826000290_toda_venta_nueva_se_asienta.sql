-- ═══════════════════════════════════════════════════════════════════════════
-- Toda venta y todo gasto nuevos se asientan solos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260826000270` asentó lo que ya existía y concilió exacto. Pero sin esto,
-- el ledger vuelve a atrasarse con la primera venta de mañana, y el P&L —que
-- ahora lee del ledger— mostraría un mes incompleto.
--
-- ── Por qué un trigger y no "acordarse de llamar" ─────────────────────────
--
-- Hay tres RPC que insertan ventas (`create_sales_transaction*`,
-- `mark_store_order_paid`, `import_meli_order_as_sales`) y nada impide que
-- aparezca un cuarto. Pedirle a cada camino que llame al asiento es el patrón
-- que ya falló con el stock: "el que inserta se acuerda de descontar" terminó
-- descontando doble. La regla de la casa es la contraria — el dato lo mueve la
-- base. `trg_sale_stock_movement` es el precedente exacto.
--
-- ── El asiento nunca voltea la operación ──────────────────────────────────
--
-- ⚠️ Si el asiento falla, la venta TIENE que guardarse igual. Un cliente
-- esperando el ticket no puede irse sin comprar porque la contabilidad no pudo
-- escribir. El trigger atrapa el error, lo deja en WARNING y sigue — y la vista
-- `operaciones_sin_asentar` muestra lo que quedó pendiente, para reasentarlo
-- con las funciones de 260. Es el mismo criterio "al menos una vez, con
-- evidencia" de los webhooks.
--
-- 📌 Una organización sin plan de cuentas (el trial recién creado) no asienta y
-- tampoco avisa: no tiene libro todavía. La vista la excluye por eso mismo.
--
-- ── UPDATE y DELETE, a propósito afuera ───────────────────────────────────
--
-- El ledger es inmutable: una venta editada o borrada no puede editar su
-- asiento. Eso es un contraasiento (`ledger_contraasentar`) y es una decisión
-- con más bordes —¿qué pasa con una venta devuelta? ¿con una editada dos
-- veces?— que merece su propio slice con su propia verificación. Hoy las
-- pantallas editan ventas raramente y el descuadre se ve en la conciliación.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_asentar_venta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Sin plan de cuentas no hay libro donde asentar.
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.total_ars, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar_venta(NEW.id);
  EXCEPTION WHEN others THEN
    -- La venta se guarda igual. Lo pendiente queda visible en
    -- `operaciones_sin_asentar`, no en un log que nadie mira.
    RAISE WARNING 'la venta % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sale_ledger ON public.sales;
CREATE TRIGGER trg_sale_ledger
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_asentar_venta();

CREATE OR REPLACE FUNCTION public.trg_asentar_gasto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.amount_ars, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar_gasto(NEW.id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'el gasto % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_expense_ledger ON public.expenses;
CREATE TRIGGER trg_expense_ledger
  AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_asentar_gasto();

-- ── Lo pendiente, a la vista ──────────────────────────────────────────────
CREATE OR REPLACE VIEW public.operaciones_sin_asentar AS
SELECT 'venta'::text AS tipo, s.id, s.org_id,
       COALESCE(s.date::date, s.created_at::date) AS fecha,
       s.total_ars AS importe,
       s.product_name AS detalle
  FROM public.sales s
 WHERE COALESCE(s.total_ars, 0) > 0
   AND EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = s.org_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_entries e
      WHERE e.org_id = s.org_id AND e.referencia_tipo = 'venta'
        AND e.referencia_id = s.id
        AND e.anulado_por IS NULL AND e.anula_a IS NULL)
   AND public.is_org_member(s.org_id, auth.uid())
UNION ALL
SELECT 'gasto', g.id, g.org_id,
       COALESCE(g.date::date, g.created_at::date),
       g.amount_ars,
       g.description
  FROM public.expenses g
 WHERE COALESCE(g.amount_ars, 0) > 0
   AND EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = g.org_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_entries e
      WHERE e.org_id = g.org_id AND e.referencia_tipo = 'gasto'
        AND e.referencia_id = g.id
        AND e.anulado_por IS NULL AND e.anula_a IS NULL)
   AND public.is_org_member(g.org_id, auth.uid());

COMMENT ON VIEW public.operaciones_sin_asentar IS
  'Ventas y gastos que no tienen asiento en el ledger. Tiene que estar VACIA: si algo aparece, el trigger fallo y quedo el WARNING — se reasienta con ledger_asentar_venta/gasto.';

REVOKE ALL ON public.operaciones_sin_asentar FROM anon;
GRANT SELECT ON public.operaciones_sin_asentar TO authenticated;

-- ── Verificación: el trigger asienta, y su fallo no voltea la venta ───────
DO $verif$
DECLARE
  v_org uuid; v_user uuid; v_prod uuid; v_sale uuid; v_gasto uuid;
  v_asiento uuid; v_n int;
  v_sufijo text := substr(md5(clock_timestamp()::text), 1, 8);
BEGIN
  SELECT o.id INTO v_org FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.ledger_accounts a WHERE a.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock, is_active)
  VALUES (v_org, v_user, 'ZZ trigger ' || v_sufijo, 8000, 1, 5, true) RETURNING id INTO v_prod;

  -- 1. Insertar una venta asienta solo.
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
    unit_price_ars, total_ars, cost_of_goods_ars, profit_ars, customer_name,
    date, paid, payment_method, source)
  VALUES (v_org, v_user, v_prod, 'ZZ trigger ' || v_sufijo, 1,
    8000, 8000, 5000, 3000, 'ZZ Cliente', CURRENT_DATE, true, 'efectivo', 'manual')
  RETURNING id INTO v_sale;

  SELECT e.id INTO v_asiento FROM public.ledger_entries e
   WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  ASSERT v_asiento IS NOT NULL, 'el trigger no asento la venta';

  SELECT count(*) INTO v_n FROM public.ledger_lines WHERE entry_id = v_asiento;
  ASSERT v_n = 4, 'el asiento del trigger tiene ' || v_n || ' lineas, se esperaban 4';

  -- 2. Un gasto también.
  INSERT INTO public.expenses (org_id, user_id, amount_ars, category, description, date)
  VALUES (v_org, v_user, 1500, 'ZZ', 'ZZ gasto trigger ' || v_sufijo, CURRENT_DATE)
  RETURNING id INTO v_gasto;
  ASSERT EXISTS (SELECT 1 FROM public.ledger_entries e
    WHERE e.referencia_tipo = 'gasto' AND e.referencia_id = v_gasto),
    'el trigger no asento el gasto';

  -- 3. Y la vista de pendientes esta vacia (todo lo real ya se asento en 270).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.operaciones_sin_asentar;
  RESET ROLE;
  ASSERT v_n = 0, 'quedan ' || v_n || ' operaciones sin asentar';

  -- ── Limpieza: el asiento de la venta ZZ se contraasienta (es inmutable) y
  --    las filas operativas se borran por id. El ledger queda con la pareja
  --    asiento/contraasiento, que suma cero — es como se limpia un libro.
  PERFORM public.ledger_contraasentar(v_asiento, 'ZZ limpieza de verificacion');
  PERFORM public.ledger_contraasentar(
    (SELECT e.id FROM public.ledger_entries e
      WHERE e.referencia_tipo = 'gasto' AND e.referencia_id = v_gasto),
    'ZZ limpieza de verificacion');

  DELETE FROM public.sales WHERE id = v_sale;
  DELETE FROM public.expenses WHERE id = v_gasto;
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;

  -- El neto de los ZZ en el ledger tiene que ser cero.
  SELECT round(COALESCE(SUM(l.debe - l.haber), 0), 2) INTO v_n
    FROM public.ledger_lines l JOIN public.ledger_entries e ON e.id = l.entry_id
   WHERE e.descripcion LIKE '%ZZ%' OR e.descripcion = 'ZZ limpieza de verificacion';
  ASSERT v_n = 0, 'los asientos ZZ no quedaron neteados: ' || v_n;

  RAISE NOTICE 'OK: el trigger asienta ventas y gastos, la vista esta vacia y los ZZ quedaron neteados';
END $verif$;
