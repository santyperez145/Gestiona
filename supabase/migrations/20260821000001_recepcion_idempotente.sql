-- I6a — la recepción de mercadería no se puede duplicar.
--
-- ── El agujero, medido antes de taparlo ──────────────────────────────────
--
-- `receive_purchase_order` parecía protegida: al recibir una orden completa, el
-- estado pasa a "recibida" y la guarda de estado frena el segundo intento.
--
-- Pero la **recepción parcial** no. Verificado contra producción con rollback:
--
--     stock inicial          0
--     tras 1ra recepción     4      (se reciben 4 de 10)
--     tras 2da recepción     8      ← el mismo pedido, otra vez
--     DUPLICA_STOCK       true
--
-- Con la orden en "confirmada" —que es donde queda tras una recepción
-- parcial— nada impide que un reintento del navegador, un timeout que en
-- realidad completó o un doble clic sumen la mercadería dos veces.
--
-- Es exactamente la familia del bug que hizo que vender 3 unidades bajara 6 y
-- vivió meses sin que nadie lo viera: una operación que corre dos veces y deja
-- un número plausible.
--
-- ── Por qué un envoltorio ────────────────────────────────────────────────
--
-- Mismo criterio que el checkout: la función original queda intacta, se puede
-- desactivar volviendo a llamarla, y agregarle un parámetro habría creado una
-- sobrecarga en vez de reemplazarla.
--
-- ── La organización la resuelve el servidor ──────────────────────────────
--
-- Sale de la orden de compra, no la manda el navegador. Si la mandara,
-- cualquiera podría reservar claves en la organización de otro y bloquearle las
-- recepciones.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.receive_purchase_order_idem(
  p_order_id        uuid,
  p_items           jsonb,
  p_notes           text  DEFAULT NULL,
  p_location_id     uuid  DEFAULT NULL,
  p_idempotency_key text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org       uuid;
  v_reserva   jsonb;
  v_resultado jsonb;
  v_payload   jsonb;
BEGIN
  SELECT po.org_id INTO v_org
    FROM public.purchase_orders po WHERE po.id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  -- El hash lleva la orden, los renglones y el depósito: recibir 4 y después
  -- otros 4 de la misma orden es legítimo y tiene que poder hacerse — con otra
  -- clave. Lo que se frena es el MISMO pedido repetido.
  v_payload := jsonb_build_object(
    'order_id', p_order_id, 'items', p_items, 'location_id', p_location_id);

  v_reserva := public.idempotencia_reservar(
    v_org, 'receive_purchase_order', p_idempotency_key, v_payload);

  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN COALESCE(v_reserva->'respuesta', '{}'::jsonb)
           || jsonb_build_object('reintento', true);
  END IF;

  BEGIN
    v_resultado := public.receive_purchase_order(
      p_order_id, p_items, p_notes, p_location_id);
  EXCEPTION WHEN OTHERS THEN
    -- Sin esto la clave queda en `en_curso` para siempre y el comercio no
    -- puede volver a intentar la recepción nunca más.
    PERFORM public.idempotencia_fallar(
      v_org, 'receive_purchase_order', p_idempotency_key, SQLERRM);
    RAISE;
  END;

  PERFORM public.idempotencia_completar(
    v_org, 'receive_purchase_order', p_idempotency_key, v_resultado);

  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.receive_purchase_order_idem IS
  'Recepcion de mercaderia con clave de idempotencia. Envuelve receive_purchase_order sin modificarla. La recepcion PARCIAL no estaba protegida: recibir 4 dos veces sumaba 8, verificado contra produccion.';

REVOKE ALL ON FUNCTION public.receive_purchase_order_idem(uuid, jsonb, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_idem(uuid, jsonb, text, uuid, text)
  TO authenticated;
