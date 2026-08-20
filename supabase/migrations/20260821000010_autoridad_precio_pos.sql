-- C12 — el navegador deja de decidir cuánto costó y cuánto se ganó.
--
-- ── El agujero, medido antes de taparlo ──────────────────────────────────
--
-- `create_sales_transaction` toma `unit_price_ars`, `total_ars`,
-- `cost_per_unit_usd`, `cost_of_goods_ars`, `profit_ars` y `profit_usd` del
-- payload que manda el navegador, y sólo los `COALESCE` a cero.
--
-- Verificado contra producción con rollback, con un producto de USD 20 que se
-- vende a $100.000:
--
--     el navegador dijo:  precio 1 · costo 0 · ganancia 999999
--     la base guardó:     precio 1 · costo 0 · ganancia 999999
--
-- Es el último lugar del sistema donde el cliente decide plata. Todo lo demás
-- —checkout, cupones, envío, comisiones— se recalcula del lado del servidor
-- desde hace sesiones.
--
-- ── La distinción que ordena el arreglo ──────────────────────────────────
--
-- **El precio se puede pisar; el costo y la ganancia no.**
--
-- Un cajero necesita poder hacer un descuento a mano — el POS ya tiene
-- descuentos por categoría, y quitárselos rompería el mostrador. Eso es un
-- *override* legítimo.
--
-- Pero **no existe ninguna razón para que el navegador decida el costo**. El
-- costo sale del producto y el tipo de cambio; la ganancia se deriva. Aceptar
-- esos tres del cliente no habilita ninguna operación real: sólo permite que el
-- P&L sea ficción.
--
-- Por eso:
--   · costo y ganancia   → SIEMPRE del servidor, se ignora lo que llegue.
--   · precio             → se acepta distinto, pero queda registrado como
--                          override con el precio que correspondía.
--
-- ── Lo que NO cambia ─────────────────────────────────────────────────────
--
-- `create_sales_transaction` queda intacta. Esto es un envoltorio, igual que
-- en el checkout y en la recepción de compra: se puede desactivar volviendo a
-- llamar a la anterior.
--
-- Idempotente.

-- ── El precio y el costo que manda el servidor ───────────────────────────
CREATE OR REPLACE FUNCTION public.precio_pos_autoritativo(
  p_org        uuid,
  p_product_id uuid,
  p_variant_id uuid    DEFAULT NULL,
  p_qty        numeric DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_p          record;
  v_var_precio numeric;
  v_lista      numeric;
  v_vigente    numeric;
  v_promo      numeric;
  v_costo_usd  numeric;
  v_tc         numeric;
BEGIN
  SELECT p.id, p.sale_price_ars, p.discount_price_ars, p.category,
         p.cost_usd, p.total_cost_usd
    INTO v_p
    FROM public.products p
   WHERE p.id = p_product_id AND p.org_id = p_org;

  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'El producto no existe en esta organización';
  END IF;

  -- La variante puede pisar el precio del producto. Es el único override que
  -- vive en los datos y no en el navegador.
  SELECT v.price_override INTO v_var_precio
    FROM public.product_variants v
   WHERE v.id = p_variant_id AND v.org_id = p_org;

  v_lista := COALESCE(v_var_precio, v_p.sale_price_ars, 0);

  -- La oferta cargada en el producto. Sólo cuenta si mejora el precio: una
  -- "oferta" más cara que la lista es un dato mal cargado, no una oferta.
  v_vigente := CASE
    WHEN COALESCE(v_p.discount_price_ars, 0) > 0
     AND v_p.discount_price_ars < v_lista THEN v_p.discount_price_ars
    ELSE v_lista END;

  -- Las promociones se resuelven con la MISMA función que usa la tienda. Dos
  -- motores de promoción distintos terminan cobrando distinto en el mostrador
  -- y online, que es de los bugs más caros de encontrar.
  BEGIN
    v_promo := public.store_promo_price(
      p_org, p_product_id, v_p.category, v_lista, v_vigente * GREATEST(p_qty, 1));
  EXCEPTION WHEN OTHERS THEN
    v_promo := NULL;
  END;

  IF COALESCE(v_promo, 0) > 0 AND v_promo < v_vigente THEN
    v_vigente := v_promo;
  END IF;

  -- El costo NUNCA viene del cliente. Sale del producto.
  v_costo_usd := COALESCE(NULLIF(v_p.total_cost_usd, 0), v_p.cost_usd, 0);

  SELECT s.exchange_rate INTO v_tc FROM public.settings s WHERE s.org_id = p_org LIMIT 1;

  RETURN jsonb_build_object(
    'precio_lista',   public.redondear_moneda(v_lista, 'ARS'),
    'precio_vigente', public.redondear_moneda(v_vigente, 'ARS'),
    'costo_usd',      v_costo_usd,
    'costo_ars',      public.redondear_moneda(v_costo_usd * COALESCE(v_tc, 0), 'ARS'),
    'tipo_cambio',    v_tc,
    'promo_aplicada', (COALESCE(v_promo, 0) > 0 AND v_promo <= v_vigente));
END;
$$;

COMMENT ON FUNCTION public.precio_pos_autoritativo IS
  'Precio y costo que manda el servidor para una linea del POS. Usa store_promo_price, la misma que la tienda: dos motores de promocion distintos terminan cobrando distinto en el mostrador y online.';

REVOKE ALL ON FUNCTION public.precio_pos_autoritativo(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.precio_pos_autoritativo(uuid, uuid, uuid, numeric) TO authenticated;

-- ── La venta, con el dinero recalculado ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sales_transaction_v2(
  p_org_id uuid,
  p_sales  jsonb,
  p_source text DEFAULT 'pos'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_linea      jsonb;
  v_precios    jsonb;
  v_salida     jsonb := '[]'::jsonb;
  v_qty        numeric;
  v_precio     numeric;
  v_pedido     numeric;
  v_costo_ars  numeric;
  v_overrides  int := 0;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar ventas en esta organización';
  END IF;

  FOR v_linea IN SELECT * FROM jsonb_array_elements(COALESCE(p_sales, '[]'::jsonb)) LOOP
    v_qty := GREATEST(COALESCE((v_linea->>'quantity')::numeric, 0), 0);

    v_precios := public.precio_pos_autoritativo(
      p_org_id,
      NULLIF(v_linea->>'product_id', '')::uuid,
      NULLIF(v_linea->>'variant_id', '')::uuid,
      v_qty);

    v_precio    := (v_precios->>'precio_vigente')::numeric;
    v_costo_ars := (v_precios->>'costo_ars')::numeric * v_qty;

    -- El precio que pidió el navegador. Si difiere, es un override del cajero:
    -- se acepta —el mostrador lo necesita— pero queda registrado con el precio
    -- que correspondía, para que una diferencia se pueda investigar después.
    v_pedido := NULLIF(v_linea->>'unit_price_ars', '')::numeric;

    IF v_pedido IS NOT NULL AND abs(v_pedido - v_precio) > 0.01 THEN
      v_overrides := v_overrides + 1;
      v_linea := v_linea || jsonb_build_object(
        'unit_price_ars', v_pedido,
        'precio_autoritativo', v_precio,
        'override_de_precio', true);
      v_precio := v_pedido;
    ELSE
      v_linea := v_linea || jsonb_build_object('unit_price_ars', v_precio);
    END IF;

    -- El costo y la ganancia se PISAN siempre, venga lo que venga del cliente.
    -- No hay operación legítima que necesite decidirlos desde el navegador.
    v_linea := v_linea || jsonb_build_object(
      'total_ars',         public.redondear_moneda(v_precio * v_qty, 'ARS'),
      'cost_per_unit_usd', (v_precios->>'costo_usd')::numeric,
      'cost_of_goods_ars', public.redondear_moneda(v_costo_ars, 'ARS'),
      'profit_ars',        public.redondear_moneda(v_precio * v_qty - v_costo_ars, 'ARS'));

    -- La ganancia en dólares sólo existe si hay tipo de cambio. Sin él sería
    -- una división por cero disfrazada de número.
    IF COALESCE((v_precios->>'tipo_cambio')::numeric, 0) > 0 THEN
      v_linea := v_linea || jsonb_build_object('profit_usd',
        round((v_precio * v_qty - v_costo_ars) / (v_precios->>'tipo_cambio')::numeric, 2));
    ELSE
      v_linea := v_linea || jsonb_build_object('profit_usd', 0);
    END IF;

    v_salida := v_salida || jsonb_build_array(v_linea);
  END LOOP;

  RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)
         || jsonb_build_object('overrides_de_precio', v_overrides);
END;
$$;

COMMENT ON FUNCTION public.create_sales_transaction_v2 IS
  'Venta del POS con el dinero recalculado en el servidor. El precio admite override del cajero y queda registrado con el precio que correspondia; el costo y la ganancia se pisan SIEMPRE. Envuelve create_sales_transaction sin modificarla.';

REVOKE ALL ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text) TO authenticated;
