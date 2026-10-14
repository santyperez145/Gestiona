-- Compras: la fecha de la compra queda en el día que se eligió.
--
-- `purchases.date` es timestamptz y `registrar_compra` guardaba la fecha a la
-- medianoche UTC, que en Argentina se ve como las 21 h del día anterior: una
-- compra del 14 aparecía el 13 en la lista y en los reportes del mes. Ahora se
-- guarda al mediodía, como el resto del sistema (dateToNoon) y como el egreso
-- de la misma compra. Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_compra(p_org uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  it jsonb;
  v_n int := 0;
  v_prod record;
  v_cant numeric;
  v_costo numeric;
  v_moneda text := upper(coalesce(nullif(btrim(p_datos->>'moneda'), ''), 'ARS'));
  v_tc numeric;
  v_total_ars numeric := 0;
  v_linea_ars numeric;
  v_linea_usd numeric;
  v_proveedor text := nullif(btrim(coalesce(p_datos->>'proveedor', '')), '');
  v_proveedor_id uuid := nullif(p_datos->>'proveedor_id', '')::uuid;
  v_fecha date := coalesce(nullif(p_datos->>'fecha', '')::date, current_date);
  v_comprobante text := left(nullif(btrim(coalesce(p_datos->>'comprobante', '')), ''), 80);
  v_a_pagar boolean := coalesce((p_datos->>'a_pagar')::boolean, false);
  v_medio text := lower(coalesce(nullif(btrim(p_datos->>'medio'), ''), 'efectivo'));
  v_sucursal uuid := nullif(p_datos->>'sucursal_id', '')::uuid;
  v_compra uuid := gen_random_uuid();
  v_actualizar boolean := coalesce((p_datos->>'actualizar_costos')::boolean, true);
  v_costo_ars numeric;
  v_costo_usd numeric;
  v_moneda_prod text;
  v_costos int := 0;
  v_primera uuid;
  v_id uuid;
  v_deuda uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden registrar compras' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un producto' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 300 THEN
    RAISE EXCEPTION 'Una compra puede tener hasta 300 renglones' USING ERRCODE = '22023';
  END IF;
  IF v_moneda NOT IN ('ARS', 'USD') THEN
    RAISE EXCEPTION 'Moneda no admitida: %', v_moneda USING ERRCODE = '22023';
  END IF;
  IF v_proveedor_id IS NOT NULL THEN
    SELECT coalesce(v_proveedor, name) INTO v_proveedor FROM public.suppliers WHERE id = v_proveedor_id AND org_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proveedor no es de este negocio' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_sucursal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.locations WHERE id = v_sucursal AND org_id = p_org) THEN
    RAISE EXCEPTION 'La sucursal no es de este negocio' USING ERRCODE = '22023';
  END IF;
  IF v_a_pagar AND v_proveedor IS NULL THEN
    RAISE EXCEPTION 'Para dejarla a pagar, elegí el proveedor' USING ERRCODE = '22023';
  END IF;
  v_tc := public._numero_o_nulo(p_datos->>'cotizacion');
  IF v_tc IS NULL OR v_tc <= 0 THEN
    SELECT nullif(exchange_rate, 0) INTO v_tc FROM public.settings WHERE org_id = p_org;
  END IF;
  IF v_moneda = 'USD' AND (v_tc IS NULL OR v_tc <= 0) THEN
    RAISE EXCEPTION 'Para una compra en dólares cargá la cotización' USING ERRCODE = '22023';
  END IF;
  -- Sin cotización una compra en pesos no tiene valor en dólares: queda en 0
  -- (antes se guardaban los pesos en las columnas de dólares).

  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_n := v_n + 1;
    v_cant := public._numero_o_nulo(it->>'cantidad');
    v_costo := coalesce(public._numero_o_nulo(it->>'costo_unitario'), 0);
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Renglón %: la cantidad tiene que ser mayor a cero', v_n USING ERRCODE = '22023';
    END IF;
    IF v_costo < 0 THEN
      RAISE EXCEPTION 'Renglón %: el costo no puede ser negativo', v_n USING ERRCODE = '22023';
    END IF;
    SELECT id, name, cost_currency, cost_ars, cost_usd, total_cost_usd INTO v_prod FROM public.products
     WHERE id = CASE WHEN coalesce(it->>'producto_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN (it->>'producto_id')::uuid END
       AND org_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Renglón %: elegí un producto del catálogo', v_n USING ERRCODE = '22023';
    END IF;

    IF v_moneda = 'USD' THEN
      v_costo_usd := v_costo;
      v_costo_ars := v_costo * v_tc;
    ELSE
      v_costo_ars := v_costo;
      v_costo_usd := CASE WHEN v_tc IS NULL THEN NULL ELSE v_costo / v_tc END;
    END IF;
    v_linea_ars := round(v_cant * v_costo_ars, 2);
    v_linea_usd := coalesce(round(v_cant * v_costo_usd, 2), 0);
    v_total_ars := v_total_ars + v_linea_ars;

    INSERT INTO public.purchases (user_id, org_id, product_id, product_name, quantity, unit_cost_usd, customs_fee,
                                  total_usd, exchange_rate, total_ars, date, supplier, supplier_id, batch_name,
                                  is_scheduled, location_id, compra_id)
    VALUES (auth.uid(), p_org, v_prod.id, v_prod.name, round(v_cant, 3),
            coalesce(round(v_costo_usd, 4), 0), 0,
            v_linea_usd, coalesce(v_tc, 0), v_linea_ars, (v_fecha::timestamp + time '12:00'), v_proveedor, v_proveedor_id, v_comprobante,
            false, v_sucursal, v_compra)
    RETURNING id INTO v_id;
    v_primera := coalesce(v_primera, v_id);

    -- El costo del producto pasa a ser el de esta compra, en la moneda en que
    -- el producto lleva su costo (costo_unitario_ars): así el margen de la
    -- caja, los reportes y el guardián de margen no siguen con un costo viejo.
    -- Un producto sin costo cargado adopta la moneda de la compra.
    IF v_actualizar AND v_costo > 0 THEN
      v_moneda_prod := coalesce(v_prod.cost_currency,
        CASE WHEN coalesce(v_prod.cost_ars, 0) > 0 THEN 'ARS'
             WHEN coalesce(v_prod.total_cost_usd, 0) > 0 OR coalesce(v_prod.cost_usd, 0) > 0 THEN 'USD'
             ELSE v_moneda END);
      IF v_moneda_prod = 'ARS' THEN
        UPDATE public.products SET cost_ars = round(v_costo_ars, 2), cost_currency = 'ARS'
         WHERE id = v_prod.id AND org_id = p_org;
        v_costos := v_costos + 1;
      ELSIF v_costo_usd IS NOT NULL THEN
        UPDATE public.products SET cost_usd = round(v_costo_usd, 4), total_cost_usd = round(v_costo_usd, 4), cost_currency = 'USD'
         WHERE id = v_prod.id AND org_id = p_org;
        v_costos := v_costos + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_a_pagar THEN
    -- remaining_ars lo calcula la tabla (amount_ars - paid_ars).
    INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars, paid_ars,
                                       due_date, status, notes, purchase_id)
    VALUES (p_org, v_proveedor_id, v_proveedor,
            'Compra' || coalesce(' ' || v_comprobante, '') || ' · ' || v_n || CASE WHEN v_n = 1 THEN ' producto' ELSE ' productos' END,
            v_total_ars, 0, nullif(p_datos->>'vencimiento', '')::date, 'pending',
            nullif(btrim(coalesce(p_datos->>'nota', '')), ''), v_primera)
    RETURNING id INTO v_deuda;
  ELSIF v_total_ars > 0 THEN
    INSERT INTO public.financial_movements (org_id, direction, source_type, source_id, amount_ars, description,
                                            counterparty, payment_method, channel, affects_cash, happened_at, created_by, metadata)
    VALUES (p_org, 'out', 'supplier_payment', v_compra, v_total_ars,
            'Compra' || coalesce(' ' || v_comprobante, '') || coalesce(' · ' || v_proveedor, ''),
            v_proveedor, v_medio,
            CASE WHEN v_medio IN ('efectivo', 'cash') THEN 'cash'
                 WHEN v_medio IN ('transferencia', 'deposito') THEN 'bank'
                 WHEN v_medio IN ('credito', 'debito', 'tarjeta', 'mercado_pago', 'mercadopago') THEN 'card'
                 ELSE 'other' END,
            v_medio IN ('efectivo', 'cash'), (v_fecha::timestamp + time '12:00'), auth.uid(),
            jsonb_build_object('renglones', v_n, 'comprobante', v_comprobante, 'compra_id', v_compra));
  END IF;

  RETURN jsonb_build_object('compra_id', v_compra, 'renglones', v_n, 'total_ars', v_total_ars, 'costos_actualizados', v_costos,
                            'comprobante', v_comprobante, 'deuda_id', v_deuda, 'primera_compra', v_primera);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_compra(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra(uuid, jsonb) TO authenticated, service_role;

COMMIT;
