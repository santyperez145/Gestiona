-- ═══════════════════════════════════════════════════════════════════════════
-- Confirmar cobro manual de tienda (transferencia / efectivo)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tras Slice transferencia usable: el comprador ve CBU y el pedido queda
-- pending. mark_store_order_paid es service_role (webhooks). Sin una RPC
-- autenticada el comercio no puede acreditar ni despachar. Eso deja la
-- primera venta por transferencia trabada en el panel.
--
-- Sólo medios offline. Gestiona Pay / Mercado Pago se acreditan por webhook;
-- marcarlos a mano saltaría la evidencia del proveedor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirmar_pago_manual_tienda(
  p_order_id uuid,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_order public.ecommerce_orders;
  v_method text;
  v_payment_id text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_order
    FROM public.ecommerce_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  PERFORM public.exigir_permiso(
    v_order.org_id,
    'ecommerce',
    'edit',
    'confirmar el cobro de un pedido de la tienda'
  );

  v_method := lower(btrim(COALESCE(v_order.payment_method, '')));
  IF v_method NOT IN ('transferencia', 'efectivo') THEN
    RAISE EXCEPTION
      'Sólo se puede confirmar a mano transferencia o efectivo. Gestiona Pay se acredita solo cuando el procesador confirma el pago.';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true, 'order_id', v_order.id);
  END IF;

  IF v_order.payment_status IN ('refunded', 'charged_back') THEN
    RAISE EXCEPTION 'El pago de la orden fue revertido; no se puede marcar como cobrado';
  END IF;

  IF v_order.payment_status NOT IN ('pending', 'failed', 'partial') THEN
    RAISE EXCEPTION 'Esta orden no está esperando un cobro manual (estado %)', v_order.payment_status;
  END IF;

  v_payment_id := format(
    'manual-%s-%s%s',
    v_method,
    v_order.order_number,
    CASE
      WHEN NULLIF(btrim(COALESCE(p_nota, '')), '') IS NULL THEN ''
      ELSE '-' || left(md5(btrim(p_nota)), 8)
    END
  );

  v_result := public.mark_store_order_paid(v_order.id, v_payment_id, v_method);

  PERFORM public.emitir_evento(
    v_order.org_id,
    'pago',
    v_order.id,
    'pago.manual_confirmado',
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'method', v_method,
      'payment_id', v_payment_id,
      'nota', NULLIF(btrim(COALESCE(p_nota, '')), ''),
      'por', auth.uid()
    )
  );

  RETURN COALESCE(v_result, '{}'::jsonb)
    || jsonb_build_object('order_id', v_order.id, 'method', v_method, 'payment_id', v_payment_id);
END;
$$;

COMMENT ON FUNCTION public.confirmar_pago_manual_tienda(uuid, text) IS
  'Acredita un pedido de tienda cobrado por transferencia o efectivo. Exige ecommerce.edit. No aplica a Gestiona Pay.';

REVOKE ALL ON FUNCTION public.confirmar_pago_manual_tienda(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pago_manual_tienda(uuid, text)
  TO authenticated;

DO $$
BEGIN
  IF NOT has_function_privilege(
    'authenticated',
    'public.confirmar_pago_manual_tienda(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated no puede ejecutar confirmar_pago_manual_tienda';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.confirmar_pago_manual_tienda(uuid, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon no debe ejecutar confirmar_pago_manual_tienda';
  END IF;
  IF NOT (
    pg_get_functiondef('public.confirmar_pago_manual_tienda(uuid, text)'::regprocedure)
    ILIKE '%exigir_permiso%'
  ) THEN
    RAISE EXCEPTION 'confirmar_pago_manual_tienda debe exigir permiso';
  END IF;
  IF pg_get_functiondef('public.confirmar_pago_manual_tienda(uuid, text)'::regprocedure)
     NOT ILIKE '%transferencia%' THEN
    RAISE EXCEPTION 'confirmar_pago_manual_tienda debe acotar a medios offline';
  END IF;
END $$;
