-- ═══════════════════════════════════════════════════════════════════════════
-- El ledger recibe las operaciones: ventas y gastos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Paso previo a que el ledger sea la autoridad financiera. Medido antes de
-- empezar (2026-08-26):
--
--     ledger_entries    0 filas
--     ledger_lines      0 filas
--     ventas           34
--     gastos            1
--
-- ⚠️ **No hay ningún trigger que asiente una venta, un gasto ni una compra.** Lo
-- único que entra al ledger es la liquidación de cobros de la tienda, por
-- `ledger_asentar_liquidacion_pos`. Por eso hacer hoy "todos los estados salen
-- del ledger" pondría el resultado en cero: se cambiaría "varios números que no
-- coinciden" por "uno solo, confiable de aspecto, y equivocado".
--
-- ── El diseño no se inventa: ya estaba determinado ────────────────────────
--
-- El asiento de liquidación **no toca ingresos**. Debita banco por el neto, los
-- aranceles y la comisión, y acredita `1.1.03 MercadoPago a liquidar` por el
-- bruto. O sea que la mitad que falta —la que acredita ventas y debita
-- `1.1.03`— es exactamente el asiento de la venta. Encaja sin solaparse.
--
--     Venta (MP)      1.1.03  a liquidar   D
--                     4.1.01  Ventas          H
--                     5.1.01  Costo         D
--                     1.3.01  Mercaderia       H
--
--     Liquidacion     1.1.02  Banco (neto) D
--                     5.2.01  Arancel      D
--                     5.2.02  Comision     D
--                     1.1.03  a liquidar       H
--
-- ── Dónde cae el cobro, decidido midiendo ─────────────────────────────────
--
-- Los medios de pago que hay, con lo que se midió de cada uno:
--
--     transferencia  21 ventas  $658.538  → 1.1.02 Banco
--     efectivo        4 ventas  $223.872  → 1.1.01 Caja
--     fiado           3 ventas  $149.500  → 1.2.01 Deudores por ventas
--     mayorista       3 ventas  $ 72.000  → 1.1.01 Caja  (ver abajo)
--     credito         1 venta   $ 39.784  → 1.1.02 Banco
--     mercado_pago    2 ventas  $      2  → 1.1.03 MercadoPago a liquidar
--
-- `fiado` no se dedujo del nombre: las 3 ventas **tienen su fila en `debts`**,
-- así que son ventas a crédito y van a deudores. `credito` es literalmente el
-- cliente "Tarjeta Credito" — una tarjeta liquida en banco, y mandarla a
-- `1.1.03` dejaría un saldo a liquidar que nunca se liquida.
--
-- ⚠️ **`mayorista` no es un medio de pago, es un tipo de cliente.** No hay dato
-- de dónde entró la plata. Se manda a Caja como destino menos malo y **se
-- expone en `ventas_con_cobro_sin_clasificar`** para que el comercio lo
-- corrija, en vez de esconder la duda dentro de un número.
--
-- 📌 Esto afecta el **balance**, no el **resultado**: `ledger_resultado` lee
-- `4.1.01` y `5.1.01`, que no dependen de dónde cayó el cobro.
--
-- ── Lo que este paso NO hace, dicho de frente ─────────────────────────────
--
-- No asienta la **cobranza** de una venta fiado. La venta queda en deudores y
-- ahí se queda, aunque las 3 deudas estén saldadas. El resultado es correcto;
-- el activo muestra un crédito que ya se cobró. Asentar cobranzas es el paso
-- siguiente y necesita decidir de qué evento cuelga.
--
-- Tampoco asienta compras: hay 0. La función queda para cuando haya.
--
-- ── IVA ───────────────────────────────────────────────────────────────────
--
-- ⚠️ El comercio es **monotributo**, que no discrimina IVA: el total va entero a
-- `4.1.01`. Para un responsable inscripto habría que separar neto e IVA débito
-- contra `2.1.02`, y eso **no está implementado**. La función **falla** en ese
-- caso en vez de asentar de más: un ingreso inflado por el IVA es exactamente el
-- tipo de número que este trabajo viene a sacar.
--
-- Idempotente: cada asiento se identifica por (referencia_tipo, referencia_id).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Dónde cae el cobro de una venta ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_de_cobro(p_metodo text, p_paid boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    -- Una venta no cobrada es un crédito, sea cual sea el medio previsto.
    WHEN COALESCE(p_paid, true) IS FALSE THEN '1.2.01'
    WHEN p_metodo = 'efectivo'      THEN '1.1.01'
    WHEN p_metodo = 'transferencia' THEN '1.1.02'
    WHEN p_metodo = 'credito'       THEN '1.1.02'
    WHEN p_metodo = 'mercado_pago'  THEN '1.1.03'
    WHEN p_metodo = 'fiado'         THEN '1.2.01'
    -- Sin dato de dónde entró: Caja, y se expone en la vista de sin clasificar.
    ELSE '1.1.01'
  END;
$fn$;

COMMENT ON FUNCTION public.cuenta_de_cobro(text, boolean) IS
  'Cuenta contable donde cae el cobro de una venta segun el medio. Afecta el balance, no el resultado. Lo que no mapea va a Caja y se expone en ventas_con_cobro_sin_clasificar.';

-- ── El asiento de una venta ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_asentar_venta(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_s        public.sales;
  v_existing uuid;
  v_emisor   text;
  v_costo    numeric;
  v_lineas   jsonb := '[]'::jsonb;
  v_cuenta   text;
BEGIN
  SELECT * INTO v_s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe';
  END IF;

  -- Idempotencia: mismo criterio que la liquidación.
  SELECT e.id INTO v_existing
    FROM public.ledger_entries e
   WHERE e.org_id = v_s.org_id
     AND e.referencia_tipo = 'venta'
     AND e.referencia_id = v_s.id
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF COALESCE(v_s.total_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'La venta % no tiene importe', v_s.id;
  END IF;

  -- ⚠️ Ver la cabecera: sin el corte de IVA implementado, un responsable
  -- inscripto quedaría con el ingreso inflado. Se corta acá.
  SELECT st.afip_tipo_emisor INTO v_emisor
    FROM public.settings st WHERE st.org_id = v_s.org_id;
  IF COALESCE(v_emisor, 'monotributo') <> 'monotributo' THEN
    RAISE EXCEPTION 'El asiento de venta todavia no separa IVA: el emisor es %', v_emisor;
  END IF;

  v_cuenta := public.cuenta_de_cobro(v_s.payment_method, v_s.paid);
  v_costo  := ROUND(COALESCE(v_s.cost_of_goods_ars, 0), 2);

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_cuenta, 'debe', ROUND(v_s.total_ars, 2),
      'detalle', 'Cobro de venta (' || COALESCE(v_s.payment_method, 'sin medio') || ')',
      'metadata', jsonb_build_object('sale_id', v_s.id, 'payment_method', v_s.payment_method)),
    jsonb_build_object('cuenta', '4.1.01', 'haber', ROUND(v_s.total_ars, 2),
      'detalle', COALESCE(v_s.product_name, 'Venta'))
  );

  -- El costo sólo se asienta si se conoce. Una venta sin costo NO se asienta
  -- con costo cero: eso pondría margen 100% en el libro, que es el error que
  -- 20260826000250 vino a sacar de la pantalla.
  IF v_costo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '5.1.01', 'debe', v_costo,
        'detalle', 'Costo de lo vendido'),
      jsonb_build_object('cuenta', '1.3.01', 'haber', v_costo,
        'detalle', 'Salida de mercaderia')
    );
  END IF;

  RETURN public.ledger_asentar(
    p_org         := v_s.org_id,
    p_descripcion := 'Venta' || COALESCE(' — ' || v_s.customer_name, ''),
    p_lineas      := v_lineas,
    p_fecha       := COALESCE(v_s.date::date, v_s.created_at::date),
    p_ref_tipo    := 'venta',
    p_ref_id      := v_s.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ledger_asentar_venta(uuid) FROM PUBLIC, anon;

-- ── El asiento de un gasto ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_asentar_gasto(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_e        public.expenses;
  v_existing uuid;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'El gasto no existe';
  END IF;

  SELECT e.id INTO v_existing
    FROM public.ledger_entries e
   WHERE e.org_id = v_e.org_id
     AND e.referencia_tipo = 'gasto'
     AND e.referencia_id = v_e.id
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF COALESCE(v_e.amount_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'El gasto % no tiene importe', v_e.id;
  END IF;

  -- 📌 Todos los gastos van a `5.9.01 Otros gastos`. El plan de cuentas no
  -- tiene una cuenta por categoria de gasto, y crear once cuentas para mapear
  -- `expenses.category` seria inventar un plan contable que nadie pidio. La
  -- categoria queda en la metadata para poder abrirlo despues sin reescribir
  -- asientos, que son inmutables.
  RETURN public.ledger_asentar(
    p_org         := v_e.org_id,
    p_descripcion := 'Gasto' || COALESCE(' — ' || v_e.description, ''),
    p_lineas      := jsonb_build_array(
      jsonb_build_object('cuenta', '5.9.01', 'debe', ROUND(v_e.amount_ars, 2),
        'detalle', COALESCE(v_e.category, 'sin categoria'),
        'metadata', jsonb_build_object('expense_id', v_e.id, 'category', v_e.category)),
      jsonb_build_object('cuenta', '1.1.01', 'haber', ROUND(v_e.amount_ars, 2),
        'detalle', 'Salida de caja')),
    p_fecha       := COALESCE(v_e.date::date, v_e.created_at::date),
    p_ref_tipo    := 'gasto',
    p_ref_id      := v_e.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ledger_asentar_gasto(uuid) FROM PUBLIC, anon;

-- ── Lo que quedó sin clasificar, a la vista ───────────────────────────────
CREATE OR REPLACE VIEW public.ventas_con_cobro_sin_clasificar AS
SELECT s.org_id,
       s.id                       AS sale_id,
       s.date,
       s.customer_name,
       s.product_name,
       s.total_ars,
       s.payment_method,
       'Se asento en Caja por no tener un destino conocido' AS motivo
  FROM public.sales s
 WHERE COALESCE(s.payment_method, '') NOT IN
       ('efectivo', 'transferencia', 'credito', 'mercado_pago', 'fiado')
   AND public.is_org_member(s.org_id, auth.uid());

COMMENT ON VIEW public.ventas_con_cobro_sin_clasificar IS
  'Ventas cuyo medio de pago no nombra un destino contable (por ejemplo mayorista, que es un tipo de cliente). Afecta el balance, no el resultado.';

REVOKE ALL ON public.ventas_con_cobro_sin_clasificar FROM anon;
GRANT SELECT ON public.ventas_con_cobro_sin_clasificar TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Y la advertencia de "venta sin costo" tiene que ver estas ventas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `ledger_resultado` cuenta las ventas sin costo para poder decir que el
-- margen bruto está mejor de lo que es. Pero filtraba por
-- `referencia_tipo = 'orden'`, o sea **sólo órdenes de la tienda online**.
--
-- Con `ledger_asentar_venta` asentando ventas de mostrador, una venta sin costo
-- inflaría el margen y la función informaría `ventas_sin_costo: 0`. Es el mismo
-- patrón de guard que cuenta de menos que apareció esta semana en
-- `audit_policies_sin_tenant`, que sólo miraba lecturas.
--
-- La función se regeneró con `pg_get_functiondef` cambiando **sólo** esa línea.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ledger_resultado(p_org uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_desde     date := COALESCE(p_desde, date_trunc('month', CURRENT_DATE)::date);
  v_hasta     date := COALESCE(p_hasta, CURRENT_DATE);
  v_ventas    numeric := 0;
  v_fletes    numeric := 0;
  v_costo     numeric := 0;
  v_com_mp    numeric := 0;
  v_com_plat  numeric := 0;
  v_flete_pag numeric := 0;
  v_otros     numeric := 0;
  v_asientos  int := 0;
  v_sin_costo int := 0;
BEGIN
  -- La organización se verifica siempre: esta función devuelve el resultado
  -- economico completo de un comercio, que es de lo mas sensible que hay.
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para ver el resultado de esta organización';
  END IF;

  SELECT
    -- Ingresos: viven por el haber, se devuelven positivos.
    COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0),
    COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.02'), 0),
    -- Gastos: viven por el debe, se devuelven positivos.
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.2.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.2.02'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.3.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.9.01'), 0),
    COUNT(DISTINCT e.id)
  INTO v_ventas, v_fletes, v_costo, v_com_mp, v_com_plat, v_flete_pag, v_otros, v_asientos
  FROM public.ledger_lines l
  JOIN public.ledger_entries e ON e.id = l.entry_id
  JOIN public.ledger_accounts a ON a.id = l.account_id
  WHERE l.org_id = p_org
    AND e.fecha BETWEEN v_desde AND v_hasta
    -- Un asiento anulado y su anulación se cancelan entre sí en los importes,
    -- pero contarlos inflaría `asientos` y ensuciaría el detalle.
    AND e.anulado_por IS NULL AND e.anula_a IS NULL;

  -- ⚠️ Cuántas ventas se asentaron sin costo. Es la advertencia que hace que
  -- el margen bruto sea creíble: si este número no es cero, el margen que se
  -- muestra está mejor de lo que la realidad es, y hay que decirlo en la
  -- pantalla, no esconderlo en un log.
  SELECT COUNT(DISTINCT e.id) INTO v_sin_costo
    FROM public.ledger_entries e
   WHERE e.org_id = p_org
     AND e.fecha BETWEEN v_desde AND v_hasta
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
     -- ⚠️ Tambien las ventas de mostrador. Hasta 2026-08-26 esto decia solo
     -- 'orden', asi que la advertencia que hace creible el margen bruto no
     -- veia ninguna venta que no viniera de la tienda online. Una venta sin
     -- costo asentada por `ledger_asentar_venta` inflaba el margen y la
     -- funcion informaba ventas_sin_costo = 0.
     AND e.referencia_tipo IN ('orden', 'venta')
     AND NOT EXISTS (
       SELECT 1 FROM public.ledger_lines l2
         JOIN public.ledger_accounts a2 ON a2.id = l2.account_id
        WHERE l2.entry_id = e.id AND a2.codigo = '5.1.01' AND l2.debe > 0);

  RETURN jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'ventas', v_ventas,
    'fletes_cobrados', v_fletes,
    'ingresos', v_ventas + v_fletes,
    'costo_mercaderia', v_costo,
    'margen_bruto', v_ventas - v_costo,
    'comision_medios_pago', v_com_mp,
    'comision_plataforma', v_com_plat,
    'fletes_pagados', v_flete_pag,
    'otros_gastos', v_otros,
    'gastos_operativos', v_com_mp + v_com_plat + v_flete_pag + v_otros,
    'resultado', (v_ventas + v_fletes) - v_costo - v_com_mp - v_com_plat - v_flete_pag - v_otros,
    'asientos', v_asientos,
    'ventas_sin_costo', v_sin_costo);
END;
$function$
;
