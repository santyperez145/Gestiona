-- ═══════════════════════════════════════════════════════════════════════════
-- El P&L informaba una ganancia bruta 3,4 veces mayor que la real
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `PLDashboardPage` calcula el costo de lo vendido así:
--
--     const cogsDirect = ventas.reduce((s, v) => s + (v.cost_of_goods_ars || 0), 0);
--     const cogs = cogsDirect > 0 ? cogsDirect : purchasesCogs;
--
-- ⚠️ Las **34 ventas** de la organización tienen `cost_of_goods_ars` en 0 o NULL,
-- así que `cogsDirect` da 0 y el fallback usa las compras del período — de las
-- que hay **cero**. Resultado: COGS 0 y margen bruto 100%.
--
-- Medido contra producción el 2026-08-26:
--
--     mes       ingreso    COGS que muestra   ganancia real guardada
--     2026-04   616.784           0                  179.519
--     2026-05   405.410           0                  130.356
--     2026-06   121.500           0                   34.968
--
-- En abril el P&L informa **$616.784 de ganancia bruta donde hubo $179.519**.
--
-- ── Por qué estaban vacías, y por qué las nuevas no lo están ──────────────
--
-- `cost_of_goods_ars` es posterior a esas ventas. Los tres caminos de alta que
-- existen hoy —`create_sales_transaction`, `mark_store_order_paid` e
-- `import_meli_order_as_sales`— **sí** la escriben, y el POS entra por
-- `create_sales_transaction_v3`. O sea que esto es una deuda histórica cerrada:
-- no vuelve a generarse.
--
-- ── De dónde sale el costo, y por qué NO se recalcula ─────────────────────
--
-- Las ventas guardan `profit_ars`, calculado al momento de vender. Entonces:
--
--     costo = total_ars - profit_ars
--
-- ⚠️ **No se usa `cost_per_unit_usd × cantidad × cotización de hoy`**, y la
-- diferencia importa: ese cálculo da $866.474 contra $798.851 del costo
-- implícito, un 8% de más. La razón es que `profit_ars` congeló la cotización
-- **del día de la venta**, y recalcular con la de hoy reescribiría la historia.
-- Es el mismo principio que `unit_cost_ars` en `record_stock_movement`.
--
-- Se comprobó que el número es sano antes de escribirlo (2026-08-26):
--
--     costo negativo (profit > total) ....... 0
--     costo mayor que la venta .............. 0
--     tipo de cambio implícito .............. entre 1470 y 1490, mediana 1470
--
-- Ese rango es exactamente lo que se espera de ventas de abril a junio, y es la
-- confirmación de que `profit_ars` trae el costo histórico y no uno inventado.
--
-- 📌 Las dos únicas ventas que quedan en costo 0 son del producto
-- `ZZ NO COMPRAR - Prueba de pago`, de $1: no tienen costo de verdad.
--
-- ── Qué NO hace esta migración ────────────────────────────────────────────
--
-- No toca `profit_ars`, ni `total_ars`, ni ninguna venta que ya tenga costo
-- cargado. Sólo completa una columna derivada a partir de datos que la propia
-- fila ya tenía. Es reversible: la vista de abajo deja ver qué quedó escrito.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El backfill ────────────────────────────────────────────────────────────
UPDATE public.sales s
   SET cost_of_goods_ars = round(s.total_ars - s.profit_ars, 2)
 WHERE COALESCE(s.cost_of_goods_ars, 0) = 0
   AND s.profit_ars IS NOT NULL
   AND s.total_ars IS NOT NULL
   -- Guardas: no se escribe un costo imposible.
   AND s.total_ars - s.profit_ars > 0
   AND s.total_ars - s.profit_ars <= s.total_ars;

COMMENT ON COLUMN public.sales.cost_of_goods_ars IS
  'Costo de lo vendido en pesos, congelado al momento de la venta. Es la fuente del COGS del P&L y del asiento contable. NUNCA se recalcula con la cotizacion de hoy: eso reescribiria la historia.';

-- ── La guarda: qué ventas quedan sin costo, y cuánto pesan ────────────────
--
-- Una venta sin costo no es una venta con margen 100%: es una venta cuyo margen
-- no se sabe. La pantalla tiene que poder decirlo en vez de mostrar un número
-- lindo y falso.

CREATE OR REPLACE VIEW public.ventas_sin_costo AS
SELECT
  s.org_id,
  date_trunc('month', s.created_at)::date        AS mes,
  count(*)::int                                  AS ventas_sin_costo,
  round(SUM(s.total_ars), 2)                     AS facturado_sin_costo,
  -- El total del mes se cuenta con una agregada aparte: un subquery
  -- correlacionado contra una columna sin agrupar no compila (42803).
  (SELECT count(*) FROM public.sales t
    WHERE t.org_id = s.org_id
      AND date_trunc('month', t.created_at) = date_trunc('month', min(s.created_at)))::int
                                                 AS ventas_del_mes
FROM public.sales s
WHERE COALESCE(s.cost_of_goods_ars, 0) = 0
  AND COALESCE(s.total_ars, 0) > 0
  AND public.is_org_member(s.org_id, auth.uid())
GROUP BY s.org_id, date_trunc('month', s.created_at);

COMMENT ON VIEW public.ventas_sin_costo IS
  'Ventas cuyo costo no se conoce, por mes. Una venta sin costo no tiene margen 100%: tiene margen desconocido, y el P&L tiene que decirlo.';

REVOKE ALL ON public.ventas_sin_costo FROM anon;
GRANT SELECT ON public.ventas_sin_costo TO authenticated;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_sin_costo   int;
  v_con_costo   int;
  v_negativos   int;
  v_mayores     int;
  v_suma        numeric;
  v_zz          int;
BEGIN
  SELECT count(*) FILTER (WHERE COALESCE(cost_of_goods_ars, 0) = 0),
         count(*) FILTER (WHERE COALESCE(cost_of_goods_ars, 0) > 0),
         count(*) FILTER (WHERE cost_of_goods_ars < 0),
         count(*) FILTER (WHERE cost_of_goods_ars > total_ars),
         COALESCE(SUM(cost_of_goods_ars), 0)
    INTO v_sin_costo, v_con_costo, v_negativos, v_mayores, v_suma
    FROM public.sales;

  ASSERT v_negativos = 0, 'quedaron ' || v_negativos || ' ventas con costo negativo';
  ASSERT v_mayores  = 0, 'quedaron ' || v_mayores || ' ventas con costo mayor que la venta';
  ASSERT v_con_costo > 0, 'no se completo ninguna venta';

  -- ⚠️ Las únicas que pueden quedar sin costo son las de prueba de $1. Si
  --    quedara otra, el backfill dejó algo afuera y hay que mirarlo.
  SELECT count(*) INTO v_zz
    FROM public.sales
   WHERE COALESCE(cost_of_goods_ars, 0) = 0
     AND COALESCE(total_ars, 0) > 0
     AND product_name NOT LIKE 'ZZ%';
  ASSERT v_zz = 0,
    'quedaron ' || v_zz || ' ventas reales sin costo que no son de prueba';

  -- Y en el otro sentido: que el total sea del orden esperado. Un backfill que
  -- escribiera ceros también pasaria los asserts de arriba.
  ASSERT v_suma > 700000,
    'el costo total quedo en ' || v_suma || ', se esperaban ~798.851';

  RAISE NOTICE 'OK: % ventas con costo, % sin costo (las de prueba), total $%',
    v_con_costo, v_sin_costo, round(v_suma);
END $verif$;
