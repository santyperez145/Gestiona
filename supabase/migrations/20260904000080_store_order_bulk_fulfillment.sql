-- D5.27 — fulfillment masivo con la misma autoridad que una orden individual.
--
-- Shopify y Tiendanube permiten operar el recorte seleccionado y reportan las
-- filas incompatibles. Nerqia no replica la transición: llama a
-- `update_store_order_fulfillment`, que ya distingue retiro de domicilio,
-- exige pago y no toca stock. El lote es parcial e informativo a propósito:
-- una orden sin entrega preparada no bloquea las otras 49.

CREATE OR REPLACE FUNCTION public.bulk_update_store_order_fulfillment(
  p_org_id uuid,
  p_order_ids uuid[],
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_requested integer := COALESCE(cardinality(p_order_ids), 0);
  v_seen uuid[] := '{}'::uuid[];
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_reason text;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
  v_duplicates integer := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para actualizar pedidos';
  END IF;
  IF p_org_id IS NULL OR NOT public.has_permission(p_org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para actualizar pedidos de esta tienda';
  END IF;
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Estado de entrega inválido: %', COALESCE(p_status, '');
  END IF;
  IF v_requested = 0 THEN
    RAISE EXCEPTION 'Seleccioná al menos un pedido';
  END IF;
  IF v_requested > 50 THEN
    RAISE EXCEPTION 'Podés actualizar hasta 50 pedidos por lote';
  END IF;

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    IF v_order_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', NULL,
        'order_number', NULL,
        'outcome', 'skipped',
        'reason', 'Pedido inválido'
      ));
      CONTINUE;
    END IF;

    IF v_order_id = ANY(v_seen) THEN
      v_duplicates := v_duplicates + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id,
        'order_number', NULL,
        'outcome', 'duplicate',
        'reason', 'Pedido repetido en la selección'
      ));
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_order_id);

    -- El filtro por organización evita revelar si un UUID pertenece a otro
    -- comercio. El lock estabiliza la precondición durante esta transacción.
    SELECT order_number
      INTO v_order_number
      FROM public.ecommerce_orders
     WHERE id = v_order_id
       AND org_id = p_org_id
     FOR UPDATE;

    IF v_order_number IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id,
        'order_number', NULL,
        'outcome', 'skipped',
        'reason', 'Pedido no encontrado en esta tienda'
      ));
      CONTINUE;
    END IF;

    BEGIN
      v_item := public.update_store_order_fulfillment(v_order_id, v_status);
      IF COALESCE((v_item ->> 'changed')::boolean, false) THEN
        v_changed := v_changed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'order_id', v_order_id,
          'order_number', v_order_number,
          'outcome', 'changed'
        ));
      ELSE
        v_unchanged := v_unchanged + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'order_id', v_order_id,
          'order_number', v_order_number,
          'outcome', 'unchanged',
          'reason', 'El pedido ya estaba en ese estado'
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Sólo se exponen mensajes operativos conocidos. Un error inesperado no
      -- filtra detalles del esquema, pero queda representado en el resultado.
      v_reason := CASE SQLERRM
        WHEN 'La orden todavía no está paga' THEN 'La orden todavía no está paga'
        WHEN 'Primero prepará el envío de la orden' THEN 'Primero prepará el envío de la orden'
        WHEN 'La orden tiene que estar en camino antes de marcarse entregada' THEN 'La orden tiene que estar en camino antes de marcarse entregada'
        WHEN 'La orden no está en un estado que se pueda despachar' THEN 'La orden no está en un estado que se pueda despachar'
        WHEN 'La orden no está en un estado que se pueda marcar como retirada' THEN 'La orden no está en un estado que se pueda marcar como retirada'
        WHEN 'El retiro en tienda no se despacha. Marcalo como retirado.' THEN 'El retiro en tienda no se despacha. Marcalo como retirado.'
        ELSE 'No se pudo actualizar este pedido'
      END;
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'outcome', 'skipped',
        'reason', v_reason
      ));
    END;
  END LOOP;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, details, severity, tags
  ) VALUES (
    auth.uid(), p_org_id, 'fulfillment_bulk', 'ecommerce_order',
    jsonb_build_object(
      'requested', v_requested,
      'unique', cardinality(v_seen),
      'status', v_status,
      'changed', v_changed,
      'unchanged', v_unchanged,
      'skipped', v_skipped,
      'duplicates', v_duplicates
    ),
    'info', ARRAY['ecommerce', 'orders', 'bulk']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'requested', v_requested,
    'unique', cardinality(v_seen),
    'status', v_status,
    'changed', v_changed,
    'unchanged', v_unchanged,
    'skipped', v_skipped,
    'duplicates', v_duplicates,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_store_order_fulfillment(uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_store_order_fulfillment(uuid, uuid[], text)
  TO authenticated;

COMMENT ON FUNCTION public.bulk_update_store_order_fulfillment(uuid, uuid[], text) IS
  'Avanza hasta 50 pedidos del mismo tenant usando la autoridad individual; devuelve resultado por fila y audita el lote.';

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.bulk_update_store_order_fulfillment(uuid, uuid[], text)'::regprocedure
  );
  IF v_def NOT LIKE '%public.update_store_order_fulfillment(v_order_id, v_status)%' THEN
    RAISE EXCEPTION 'el bulk duplicó o perdió la autoridad individual';
  END IF;
  IF v_def NOT LIKE '%v_requested > 50%' THEN
    RAISE EXCEPTION 'el bulk perdió su límite operativo';
  END IF;
  IF has_function_privilege('anon', 'public.bulk_update_store_order_fulfillment(uuid,uuid[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe ejecutar el bulk de pedidos';
  END IF;
END $$;
