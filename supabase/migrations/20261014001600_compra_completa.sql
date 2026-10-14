-- Compras: una compra es una unidad (se ve, se anula y se rastrea entera) y la
-- recepción de una orden de compra registra lo mismo que una compra directa.
--
-- Funciones incoherentes (pedido del dueño 2026-10-14). Medido en el código:
-- · Una compra de varios productos quedaba como renglones sueltos: borrar uno
--   desde la pantalla dejaba la cuenta del proveedor y el egreso por el total.
-- · `receive_purchase_order` guardaba la cantidad como entero (`v_qty::int`):
--   recibir 12,5 m de cable sumaba 12 al stock y 12,5 a la orden.
-- · Una orden en pesos sin cotización cargada guardaba el costo en pesos como
--   si fueran dólares y el total en pesos en 0; una en dólares, total 0.
--
-- Esta migración:
-- · agrega `purchases.compra_id`: todos los renglones de una compra (o de una
--   recepción) lo comparten; `registrar_compra` lo devuelve y lo usa como
--   origen del egreso;
-- · `anular_compra`: deshace la compra entera en una transacción (renglones →
--   el trigger revierte el stock; cuenta del proveedor sin pagos; egreso) y deja
--   la auditoría. Si ya hay pagos al proveedor o entró por una orden de compra,
--   se rechaza con el motivo;
-- · un guardia que impide editar o borrar, por fuera de la recepción, una
--   compra que entró por una orden (la orden quedaría diciendo «recibido» sin
--   la mercadería);
-- · corrige `receive_purchase_order` (cantidad con decimales, costo en la
--   moneda de la orden, exige cotización para una orden en dólares, número de
--   la orden como comprobante).
-- Idempotente.
BEGIN;

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS compra_id uuid;
CREATE INDEX IF NOT EXISTS purchases_org_compra_idx ON public.purchases (org_id, compra_id);
COMMENT ON COLUMN public.purchases.compra_id IS
  'Agrupa los renglones de una misma compra (registrar_compra) o de una misma recepción de orden (receive_purchase_order).';

-- ───────────────────────── registrar_compra ─────────────────────────
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
  v_tc := coalesce(v_tc, 1);

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
    SELECT id, name INTO v_prod FROM public.products
     WHERE id = CASE WHEN coalesce(it->>'producto_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN (it->>'producto_id')::uuid END
       AND org_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Renglón %: elegí un producto del catálogo', v_n USING ERRCODE = '22023';
    END IF;

    IF v_moneda = 'USD' THEN
      v_linea_usd := round(v_cant * v_costo, 2);
      v_linea_ars := round(v_linea_usd * v_tc, 2);
    ELSE
      v_linea_ars := round(v_cant * v_costo, 2);
      v_linea_usd := round(v_linea_ars / v_tc, 2);
    END IF;
    v_total_ars := v_total_ars + v_linea_ars;

    INSERT INTO public.purchases (user_id, org_id, product_id, product_name, quantity, unit_cost_usd, customs_fee,
                                  total_usd, exchange_rate, total_ars, date, supplier, supplier_id, batch_name,
                                  is_scheduled, location_id, compra_id)
    VALUES (auth.uid(), p_org, v_prod.id, v_prod.name, round(v_cant, 3),
            CASE WHEN v_moneda = 'USD' THEN round(v_costo, 4) ELSE round(v_costo / v_tc, 4) END, 0,
            v_linea_usd, v_tc, v_linea_ars, v_fecha, v_proveedor, v_proveedor_id, v_comprobante,
            false, v_sucursal, v_compra)
    RETURNING id INTO v_id;
    v_primera := coalesce(v_primera, v_id);
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

  RETURN jsonb_build_object('compra_id', v_compra, 'renglones', v_n, 'total_ars', v_total_ars,
                            'comprobante', v_comprobante, 'deuda_id', v_deuda, 'primera_compra', v_primera);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_compra(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra(uuid, jsonb) TO authenticated, service_role;

-- ───────────────────────── anular_compra ─────────────────────────
CREATE OR REPLACE FUNCTION public.anular_compra(p_org uuid, p_compra uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_total numeric;
  v_comprobante text;
  v_orden text;
  v_pagado numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden anular compras' USING ERRCODE = '42501';
  END IF;
  -- Las compras anteriores a compra_id son de un solo renglón: se anulan por su id.
  SELECT array_agg(id), sum(total_ars), min(batch_name) INTO v_ids, v_total, v_comprobante
    FROM public.purchases
   WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra));
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'La compra no existe en este negocio' USING ERRCODE = 'P0002';
  END IF;

  SELECT po.order_number INTO v_orden
    FROM public.purchase_order_receipts r JOIN public.purchase_orders po ON po.id = r.order_id
   WHERE r.purchase_id = ANY (v_ids)
   LIMIT 1;
  IF v_orden IS NOT NULL THEN
    RAISE EXCEPTION 'Esta compra entró al recibir la orden %: la orden ya la cuenta como recibida y no se anula desde Compras', v_orden
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(paid_ars), 0) INTO v_pagado
    FROM public.supplier_debts WHERE org_id = p_org AND purchase_id = ANY (v_ids);
  IF v_pagado > 0 THEN
    RAISE EXCEPTION 'Ya registraste pagos por $% al proveedor por esta compra: revertilos en Cuentas a pagar antes de anularla', v_pagado
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.supplier_debts WHERE org_id = p_org AND purchase_id = ANY (v_ids);
  DELETE FROM public.financial_movements
   WHERE org_id = p_org AND source_type = 'supplier_payment' AND (source_id = p_compra OR source_id = ANY (v_ids));
  -- trg_purchase_stock_movement revierte el stock de cada renglón.
  DELETE FROM public.purchases WHERE org_id = p_org AND id = ANY (v_ids);

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, entity_label, details, severity, tags)
  VALUES (auth.uid(), p_org, 'delete', 'purchase', p_compra::text, coalesce('Compra ' || v_comprobante, 'Compra'),
          jsonb_build_object('renglones', cardinality(v_ids), 'total_ars', v_total, 'anulada', true),
          'warning', ARRAY['purchases', 'inventory']::text[]);

  RETURN jsonb_build_object('renglones', cardinality(v_ids), 'total_ars', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.anular_compra(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_compra(uuid, uuid) TO authenticated, service_role;

-- ───────────── guardia: lo recibido por una orden no se toca desde afuera ─────────────
-- Sólo lo que mueve stock o cambia de negocio; que se borre el producto, el
-- proveedor o la sucursal (FK SET NULL) no se bloquea. Al borrar un negocio
-- entero (mark_organization_deleting) tampoco.
CREATE OR REPLACE FUNCTION public.guard_compra_de_recepcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('gestiona.organization_deleting', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.is_scheduled IS NOT DISTINCT FROM OLD.is_scheduled
     AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
     AND (NEW.product_id IS NOT DISTINCT FROM OLD.product_id OR NEW.product_id IS NULL) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_receipts r WHERE r.purchase_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta compra entró al recibir una orden de compra: no se edita ni se borra desde Compras'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_compra_de_recepcion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_compra_de_recepcion ON public.purchases;
CREATE TRIGGER trg_guard_compra_de_recepcion
BEFORE UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.guard_compra_de_recepcion();

-- ───────────────────────── receive_purchase_order ─────────────────────────
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_order_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org         uuid;
  v_user        uuid := auth.uid();
  v_currency    text;
  v_supplier    text;
  v_supplier_id uuid;
  v_status      text;
  v_numero      text;
  v_rate        numeric;
  v_item        jsonb;
  v_it          record;
  v_qty         numeric;
  v_pendiente   numeric;
  v_cost_usd    numeric;
  v_cost_ars    numeric;
  v_purchase    uuid;
  v_recibidos   int := 0;
  v_estado      text;
  v_presentacion uuid;
  v_bultos      numeric;
  v_factor      numeric;
  v_pp_producto uuid;
  v_pp_nombre   text;
  v_compra      uuid := gen_random_uuid();
BEGIN
  SELECT po.org_id, upper(COALESCE(po.currency, 'USD')), po.supplier_name, po.supplier_id, po.status, po.order_number
    INTO v_org, v_currency, v_supplier, v_supplier_id, v_status, v_numero
    FROM public.purchase_orders po
   WHERE po.id = p_order_id
   FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La orden de compra no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.has_org_role(v_org, v_user, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'No tenés permiso para recibir mercadería de esta orden'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status NOT IN ('confirmed', 'partially_received') THEN
    RAISE EXCEPTION 'La orden debe estar confirmada para recibir mercadería'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = p_location_id AND l.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se indicó qué recibir' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT NULLIF(s.exchange_rate, 0) INTO v_rate
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;
  -- Sin cotización una orden en dólares no tiene costo en pesos: antes se
  -- guardaba 0 y el costo de la mercadería quedaba mal para siempre.
  IF v_currency <> 'ARS' AND v_rate IS NULL THEN
    RAISE EXCEPTION 'La orden está en dólares: cargá la cotización del dólar en Configuración antes de recibirla'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('gestiona.po_receipt_authority', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := NULLIF(v_item->>'quantity', '')::numeric;
    v_presentacion := NULLIF(v_item->>'presentation_id', '')::uuid;
    v_bultos := NULLIF(v_item->>'bultos', '')::numeric;
    IF v_presentacion IS NULL AND (v_qty IS NULL OR v_qty <= 0) THEN CONTINUE; END IF;
    IF v_presentacion IS NOT NULL AND (v_bultos IS NULL OR v_bultos <= 0) THEN CONTINUE; END IF;

    SELECT i.* INTO v_it
      FROM public.purchase_order_items i
     WHERE i.id = (v_item->>'item_id')::uuid
       AND i.order_id = p_order_id
     FOR UPDATE;
    IF v_it.id IS NULL THEN
      RAISE EXCEPTION 'El renglón % no pertenece a esta orden', v_item->>'item_id'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Recibir por caja: quien recibe cuenta bultos y la base, no el
    -- navegador, los convierte con el factor guardado. La caja tiene que ser
    -- del mismo producto que el renglón de la orden.
    IF v_presentacion IS NOT NULL THEN
      SELECT pp.factor, pp.product_id, pp.name
        INTO v_factor, v_pp_producto, v_pp_nombre
        FROM public.product_presentations pp
       WHERE pp.id = v_presentacion AND pp.org_id = v_org;
      IF v_factor IS NULL OR v_pp_producto IS DISTINCT FROM v_it.product_id THEN
        RAISE EXCEPTION 'La presentación indicada no corresponde a "%"', v_it.product_name
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_qty := v_bultos * v_factor;
    END IF;
    v_qty := round(v_qty, 3);

    v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0);
    IF v_qty > v_pendiente THEN
      RAISE EXCEPTION 'De "%" faltan % unidades y se quieren recibir %',
        v_it.product_name, v_pendiente, v_qty USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- El costo se toma en la moneda de la orden y se guarda en las dos.
    IF v_currency = 'ARS' THEN
      v_cost_ars := v_it.unit_cost;
      v_cost_usd := CASE WHEN v_rate IS NULL THEN 0 ELSE v_it.unit_cost / v_rate END;
    ELSE
      v_cost_usd := v_it.unit_cost;
      v_cost_ars := v_it.unit_cost * v_rate;
    END IF;

    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id, location_id, batch_name, compra_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty,
      round(v_cost_usd, 4), 0, round(v_cost_usd * v_qty, 2), COALESCE(v_rate, 0),
      round(v_cost_ars * v_qty, 2),
      now(), v_supplier, v_supplier_id, p_location_id, v_numero, v_compra
    ) RETURNING id INTO v_purchase;

    INSERT INTO public.purchase_order_receipts (
      org_id, order_id, order_item_id, purchase_id, quantity, received_by, notes
    ) VALUES (v_org, p_order_id, v_it.id, v_purchase, v_qty, v_user, p_notes);

    UPDATE public.purchase_order_items
       SET quantity_received = COALESCE(quantity_received, 0) + v_qty
     WHERE id = v_it.id;
    v_recibidos := v_recibidos + 1;
  END LOOP;

  IF v_recibidos = 0 THEN
    RAISE EXCEPTION 'No se recibió ningún renglón' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT CASE
           WHEN bool_and(COALESCE(quantity_received, 0) >= quantity_ordered) THEN 'received'
           ELSE 'partially_received'
         END
    INTO v_estado
    FROM public.purchase_order_items
   WHERE order_id = p_order_id;

  UPDATE public.purchase_orders
     SET status = v_estado,
         received_date = CASE WHEN v_estado = 'received' THEN current_date ELSE received_date END,
         updated_at = now()
   WHERE id = p_order_id;

  PERFORM set_config('gestiona.po_receipt_authority', 'off', true);
  RETURN jsonb_build_object(
    'status', v_estado,
    'renglones_recibidos', v_recibidos,
    'compra_id', v_compra,
    'pendientes', (
      SELECT COALESCE(sum(quantity_ordered - COALESCE(quantity_received, 0)), 0)
        FROM public.purchase_order_items WHERE order_id = p_order_id
    )
  );
END;
$function$;

COMMIT;
