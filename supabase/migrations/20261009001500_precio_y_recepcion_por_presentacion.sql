-- ═══════════════════════════════════════════════════════════════════════════
-- La caja tiene su propio precio, y la compra se recibe por caja
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `product_presentations` (20261009001200) resolvió la cantidad: escanear la
-- caja suma N unidades. Pero cobraba N × precio unitario, y en un mayorista la
-- caja vale menos por unidad que el suelto. El comercio tenía dos caminos, los
-- dos malos: cargar la caja como otro producto —y partir el stock en dos— o
-- descontar a mano en cada venta por bulto.
--
-- ── Por qué el precio no puede venir del navegador ───────────────────────
--
-- `create_sales_transaction_v2` acepta el precio —el cajero tiene que poder
-- descontar— pero mide cada peso contra el precio autoritativo y, arriba del
-- tope del comercio, exige el PIN de un encargado (20261009001000). Un precio
-- de caja mandado por el cliente sería indistinguible de un descuento manual:
-- o pide PIN en cada venta mayorista, o cualquiera cobra lo que quiere
-- diciendo «es el precio de la caja». Es el agujero que cerró 0d40eef4.
--
-- Entonces la línea viaja con `presentation_id` —cuál caja, no cuánto sale—
-- y la base resuelve el precio. Tres reglas:
--
--   Sólo mejora el precio. Si la caja sale más cara por unidad que el suelto,
--   gana el suelto: la misma regla que `discount_price_ars` en
--   `precio_pos_autoritativo`. Y cierra la palanca: elegir una presentación
--   nunca encarece la venta.
--
--   Hay que llevarse la caja. El precio por bulto aplica si la cantidad
--   alcanza el factor; si no, se escanea la caja de 12, se borran 11 unidades
--   y queda una al precio mayorista. Con 18 unidades de una caja de 12, las 18
--   van a precio de caja: es precio mayorista desde un bulto.
--
--   El precio de la caja pasa a ser el baseline. El tope de descuento se mide
--   contra él: vender la caja a su precio no es un descuento manual. Un
--   descuento SOBRE la caja sí, y se mide desde ahí.
--
-- El descuento por medio de pago no se apila sobre la caja: sigue saliendo de
-- la lista y gana el menor, como ya hacía la función.
--
-- `sales.presentation_id` deja evidencia de que el renglón salió por bulto:
-- `jsonb_populate_record` descarta en silencio las claves que no son columnas.
--
-- ── Recepción ────────────────────────────────────────────────────────────
--
-- `receive_purchase_order` acepta `{item_id, presentation_id, bultos}`: quien
-- recibe cuenta cajas y la base las convierte con el factor guardado. La
-- presentación tiene que ser del producto del renglón. El idempotente
-- (`receive_purchase_order_idem`) pasa los ítems tal cual, así que no cambia.
--
-- v2 y la recepción se generaron desde `pg_get_functiondef` de la base
-- vinculada (2026-10-09; v2 idéntica a 20261009001000) con bloques insertados
-- por script. v3 delega en v2.
--
-- Idempotente. Reversible: las columnas son nullables y NULL es exactamente el
-- comportamiento anterior.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.product_presentations
  ADD COLUMN IF NOT EXISTS price_ars numeric(14,2);

ALTER TABLE public.product_presentations
  DROP CONSTRAINT IF EXISTS product_presentations_price_positivo;
ALTER TABLE public.product_presentations
  ADD CONSTRAINT product_presentations_price_positivo
  CHECK (price_ars IS NULL OR price_ars > 0);

COMMENT ON COLUMN public.product_presentations.price_ars IS
  'Precio de la presentación completa en pesos. NULL = sin precio propio: la caja es un atajo de cantidad y se cobra N x precio unitario.';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS presentation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sales_presentation_id_fkey'
       AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_presentation_id_fkey
      FOREIGN KEY (presentation_id)
      REFERENCES public.product_presentations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_presentation_idx
  ON public.sales(org_id, presentation_id) WHERE presentation_id IS NOT NULL;

COMMENT ON COLUMN public.sales.presentation_id IS
  'Presentación de la que salió el renglón, validada por la base. Borrar la presentación no borra la historia: queda en NULL.';

-- ── Autoridad del precio por bulto ─────────────────────────────────────────
-- No se expone a `authenticated`: sólo la llama v2, que ya verificó
-- membresía y permiso de ventas. El POS lee `price_ars` por RLS para
-- mostrarlo; para cobrarlo pasa por acá.
CREATE OR REPLACE FUNCTION public.precio_presentacion_autoritativo(
  p_org             uuid,
  p_product_id      uuid,
  p_presentation_id uuid,
  p_qty             numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pp record;
BEGIN
  SELECT pp.id, pp.product_id, pp.name, pp.factor, pp.price_ars
    INTO v_pp
    FROM public.product_presentations pp
   WHERE pp.id = p_presentation_id AND pp.org_id = p_org;

  IF v_pp.id IS NULL THEN
    RETURN jsonb_build_object('existe', false, 'aplica', false, 'motivo', 'no_existe');
  END IF;

  -- Una caja de otro producto no es un borrado offline: es un dato falso.
  IF p_product_id IS NULL OR v_pp.product_id <> p_product_id THEN
    RAISE EXCEPTION 'La presentación «%» no pertenece a ese producto', v_pp.name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF COALESCE(v_pp.price_ars, 0) <= 0 THEN
    RETURN jsonb_build_object('existe', true, 'aplica', false, 'motivo', 'sin_precio_propio',
      'factor', v_pp.factor);
  END IF;

  IF COALESCE(p_qty, 0) + 0.0005 < v_pp.factor THEN
    RETURN jsonb_build_object('existe', true, 'aplica', false, 'motivo', 'cantidad_menor_al_bulto',
      'factor', v_pp.factor,
      'precio_bulto', public.redondear_moneda(v_pp.price_ars, 'ARS'),
      'precio_unitario', public.redondear_moneda(v_pp.price_ars / v_pp.factor, 'ARS'));
  END IF;

  RETURN jsonb_build_object('existe', true, 'aplica', true, 'motivo', 'ok',
    'factor', v_pp.factor,
    'precio_bulto', public.redondear_moneda(v_pp.price_ars, 'ARS'),
    'precio_unitario', public.redondear_moneda(v_pp.price_ars / v_pp.factor, 'ARS'));
END;
$function$;

COMMENT ON FUNCTION public.precio_presentacion_autoritativo(uuid, uuid, uuid, numeric) IS
  'Precio por unidad de una caja/bulto, leído de la base. Rechaza una presentación de otro producto; una borrada se informa sin tirar la venta. Sólo la llama create_sales_transaction_v2.';

REVOKE ALL ON FUNCTION public.precio_presentacion_autoritativo(uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.precio_presentacion_autoritativo(uuid, uuid, uuid, numeric)
  TO service_role;

-- ── La venta usa el precio de la caja como baseline ─────────────────────
CREATE OR REPLACE FUNCTION public.create_sales_transaction_v2(p_org_id uuid, p_sales jsonb, p_source text DEFAULT 'pos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_linea jsonb;
  v_precios jsonb;
  v_salida jsonb := '[]'::jsonb;
  v_qty numeric;
  v_precio numeric;
  v_precio_pre_medio numeric;
  v_precio_lista numeric;
  v_precio_medio numeric;
  v_pedido numeric;
  v_costo_ars numeric;
  v_method text;
  v_split boolean;
  v_payment_pct numeric;
  v_payment_discount_ars numeric;
  v_overrides integer := 0;
  v_method_discounts integer := 0;
  v_stale_prices_ignored integer := 0;
  v_limite numeric;
  v_es_encargado boolean;
  v_descuento_pct numeric;
  v_aprobacion uuid;
  v_aut public.pos_autorizaciones%ROWTYPE;
  v_usadas uuid[] := '{}';
  v_presentacion uuid;
  v_bulto jsonb;
  v_lineas_por_bulto integer := 0;
  v_presentaciones_ignoradas integer := 0;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid())
     OR NOT public.has_permission(p_org_id, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenes permiso para registrar ventas en esta organizacion'
      USING ERRCODE = '42501';
  END IF;

  -- Descuento manual máximo sin autorización (NULL = sin límite, como antes).
  SELECT s.pos_descuento_max_pct INTO v_limite FROM public.settings s WHERE s.org_id = p_org_id;
  v_es_encargado := public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']);

  FOR v_linea IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_sales, '[]'::jsonb))
  LOOP
    -- La autorización la completa la base; nunca se acepta del navegador.
    v_aprobacion := NULLIF(v_linea->>'autorizacion_id', '')::uuid;
    v_linea := v_linea - 'autorizacion_id' - 'price_override_approved_by';
    v_qty := GREATEST(COALESCE((v_linea->>'quantity')::numeric, 0), 0);
    v_precios := public.precio_pos_autoritativo(
      p_org_id,
      NULLIF(v_linea->>'product_id', '')::uuid,
      NULLIF(v_linea->>'variant_id', '')::uuid,
      v_qty
    );

    v_precio := (v_precios->>'precio_vigente')::numeric;
    v_precio_lista := (v_precios->>'precio_lista')::numeric;

    -- Precio propio de la caja. El navegador dice CUÁL presentación escaneó;
    -- el precio y el factor los lee la base, igual que el costo. Sólo puede
    -- mejorar el precio: afirmar una presentación nunca encarece una venta.
    v_presentacion := NULLIF(v_linea->>'presentation_id', '')::uuid;
    IF v_presentacion IS NOT NULL THEN
      v_bulto := public.precio_presentacion_autoritativo(
        p_org_id,
        NULLIF(v_linea->>'product_id', '')::uuid,
        v_presentacion,
        v_qty
      );
      IF NOT (v_bulto->>'existe')::boolean THEN
        -- Borrada mientras el POS estaba offline: se cobra por unidad y no
        -- queda un id huérfano, como con los cupones.
        v_presentaciones_ignoradas := v_presentaciones_ignoradas + 1;
        v_linea := v_linea - 'presentation_id';
      ELSIF (v_bulto->>'aplica')::boolean
        AND (v_bulto->>'precio_unitario')::numeric < v_precio THEN
        v_precio := (v_bulto->>'precio_unitario')::numeric;
        v_lineas_por_bulto := v_lineas_por_bulto + 1;
      END IF;
    END IF;

    -- Desde acá el precio de la caja ES el baseline: el tope de descuento se
    -- mide contra él, así que vender la caja a su precio no pide PIN.
    v_precio_pre_medio := v_precio;
    v_costo_ars := (v_precios->>'costo_ars')::numeric * v_qty;
    v_method := lower(btrim(COALESCE(v_linea->>'payment_method', 'efectivo')));
    v_split := jsonb_typeof(v_linea->'split_payments') = 'array'
      AND jsonb_array_length(v_linea->'split_payments') > 0;
    v_payment_pct := CASE
      WHEN v_split THEN 0
      ELSE public.pos_payment_discount_pct(p_org_id, v_method)
    END;

    IF v_payment_pct > 0 AND v_precio_lista > 0 THEN
      v_precio_medio := public.redondear_moneda(
        v_precio_lista * (100 - v_payment_pct) / 100.0,
        'ARS'
      );
      v_precio := LEAST(v_precio, v_precio_medio);
    END IF;

    v_payment_discount_ars := public.redondear_moneda(
      GREATEST(0, v_precio_pre_medio - v_precio) * v_qty,
      'ARS'
    );
    IF v_payment_discount_ars > 0 THEN
      v_method_discounts := v_method_discounts + 1;
    END IF;

    v_pedido := NULLIF(v_linea->>'unit_price_ars', '')::numeric;

    IF v_pedido IS NOT NULL AND abs(v_pedido - v_precio) > 0.01 THEN
      IF v_payment_pct > 0 AND v_pedido > v_precio THEN
        -- Compatibilidad con una pestaÃ±a/deploy viejo: el servidor respeta el
        -- descuento configurado aunque el navegador todavÃ­a mande lista.
        v_stale_prices_ignored := v_stale_prices_ignored + 1;
        v_linea := v_linea || jsonb_build_object(
          'unit_price_ars', v_precio,
          'precio_autoritativo', v_precio,
          'override_de_precio', false,
          'client_price_ignored', true
        );
      ELSE
        -- El cajero puede otorgar un descuento adicional hacia abajo. Como
        -- antes, queda comparado contra el baseline autoritativo. Arriba del
        -- máximo del comercio necesita la autorización de un encargado.
        IF v_pedido < v_precio AND v_precio > 0 AND v_limite IS NOT NULL AND NOT v_es_encargado THEN
          v_descuento_pct := round((v_precio - v_pedido) / v_precio * 100, 2);
          IF v_descuento_pct > v_limite + 0.01 THEN
            SELECT * INTO v_aut FROM public.pos_autorizaciones a
            WHERE a.id = v_aprobacion AND a.org_id = p_org_id AND a.cashier_id = auth.uid()
              AND a.expires_at > now() AND a.max_descuento_pct + 0.01 >= v_descuento_pct;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'El descuento de % %% en «%» supera el máximo de % %%. Pedí la autorización del encargado.',
                v_descuento_pct, v_linea->>'product_name', v_limite
                USING ERRCODE = '42501';
            END IF;
            v_linea := v_linea || jsonb_build_object('price_override_approved_by', v_aut.approver_id);
            v_usadas := array_append(v_usadas, v_aut.id);
          END IF;
        END IF;
        v_overrides := v_overrides + 1;
        v_linea := v_linea || jsonb_build_object(
          'unit_price_ars', v_pedido,
          'precio_autoritativo', v_precio,
          'override_de_precio', true
        );
        v_precio := v_pedido;
      END IF;
    ELSE
      v_linea := v_linea || jsonb_build_object(
        'unit_price_ars', v_precio,
        'precio_autoritativo', v_precio,
        'override_de_precio', false
      );
    END IF;

    v_linea := v_linea || jsonb_build_object(
      'payment_discount_percent', v_payment_pct,
      'payment_discount_ars', v_payment_discount_ars,
      'discount_applied',
        COALESCE(v_linea->>'discount_applied', 'false')::boolean
        OR v_payment_discount_ars > 0
        OR COALESCE((v_linea->>'override_de_precio')::boolean, false),
      'total_ars', public.redondear_moneda(v_precio * v_qty, 'ARS'),
      'cost_per_unit_usd', (v_precios->>'costo_usd')::numeric,
      'cost_of_goods_ars', public.redondear_moneda(v_costo_ars, 'ARS'),
      'profit_ars', public.redondear_moneda(v_precio * v_qty - v_costo_ars, 'ARS')
    );

    IF COALESCE((v_precios->>'tipo_cambio')::numeric, 0) > 0 THEN
      v_linea := v_linea || jsonb_build_object(
        'profit_usd', round(
          (v_precio * v_qty - v_costo_ars) / (v_precios->>'tipo_cambio')::numeric,
          2
        )
      );
    ELSE
      v_linea := v_linea || jsonb_build_object('profit_usd', 0);
    END IF;

    v_salida := v_salida || jsonb_build_array(v_linea);
  END LOOP;

  IF cardinality(v_usadas) > 0 THEN
    UPDATE public.pos_autorizaciones SET used_at = COALESCE(used_at, now()) WHERE id = ANY(v_usadas);
  END IF;

  RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)
    || jsonb_build_object(
      'overrides_de_precio', v_overrides,
      'lineas_con_descuento_medio', v_method_discounts,
      'precios_viejos_ignorados', v_stale_prices_ignored,
      'lineas_por_bulto', v_lineas_por_bulto,
      'presentaciones_ignoradas', v_presentaciones_ignoradas
    );
END;
$function$;

-- ── Recepción por bulto ──────────────────────────────────────────────────
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
  v_rate        numeric;
  v_item        jsonb;
  v_it          record;
  v_qty         numeric;
  v_pendiente   numeric;
  v_cost_usd    numeric;
  v_purchase    uuid;
  v_recibidos   int := 0;
  v_estado      text;
  v_presentacion uuid;
  v_bultos      numeric;
  v_factor      numeric;
  v_pp_producto uuid;
  v_pp_nombre   text;
BEGIN
  SELECT po.org_id, po.currency, po.supplier_name, po.supplier_id, po.status
    INTO v_org, v_currency, v_supplier, v_supplier_id, v_status
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

  PERFORM set_config('gestiona.po_receipt_authority', 'on', true);
  SELECT NULLIF(s.exchange_rate, 0) INTO v_rate
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

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

    v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0);
    IF v_qty > v_pendiente THEN
      RAISE EXCEPTION 'De "%" faltan % unidades y se quieren recibir %',
        v_it.product_name, v_pendiente, v_qty USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_cost_usd := CASE
      WHEN upper(COALESCE(v_currency, 'USD')) = 'ARS' AND v_rate IS NOT NULL
        THEN v_it.unit_cost / v_rate
      ELSE v_it.unit_cost
    END;

    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id, location_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty::int,
      v_cost_usd, 0, v_cost_usd * v_qty, COALESCE(v_rate, 0),
      CASE WHEN v_rate IS NULL THEN 0 ELSE v_cost_usd * v_qty * v_rate END,
      now(), v_supplier, v_supplier_id, p_location_id
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
    'pendientes', (
      SELECT COALESCE(sum(quantity_ordered - COALESCE(quantity_received, 0)), 0)
        FROM public.purchase_order_items WHERE order_id = p_order_id
    )
  );
END;
$function$;
