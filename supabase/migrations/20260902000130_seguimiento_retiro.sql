-- Seguimiento público: el retiro no es un envío.
--
-- Medido 2026-09-02: 2 órdenes pagas carrier=retiro. La página de gracias
-- ya no promete envío (131–132). OrderTracking seguía: «Preparando el
-- envío» → «En camino» → «Entregado». get_order_tracking devolvía
-- carrier de deliveries (NULL en pickup sin etiqueta), no el de la orden.
--
-- RETURNS jsonb: CREATE OR REPLACE alcanza; no hace falta DROP.

CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_number text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_del   record;
  v_url   text;
BEGIN
  SELECT o.id, o.fulfillment_status, o.tracking_number, o.created_at, o.org_id,
         o.carrier, o.shipping_service
    INTO v_order
  FROM public.ecommerce_orders o
  WHERE upper(o.order_number) = upper(btrim(p_order_number))
    AND lower(o.customer_email) = lower(btrim(p_email));

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT d.carrier, d.external_tracking, d.status, d.picked_up_at, d.delivered_at
    INTO v_del
  FROM public.deliveries d WHERE d.ecommerce_order_id = v_order.id LIMIT 1;

  SELECT replace(c.tracking_url, '{tracking_number}', COALESCE(v_del.external_tracking, ''))
    INTO v_url
  FROM public.carriers c
  WHERE c.org_id = v_order.org_id
    AND lower(c.code) = lower(COALESCE(v_del.carrier, ''))
    AND c.tracking_url IS NOT NULL
  LIMIT 1;

  RETURN jsonb_build_object(
    'found', true,
    'fulfillment_status', v_order.fulfillment_status,
    'tracking_number', v_order.tracking_number,
    -- Preferir el de la etiqueta; si no hay delivery (retiro), el de la orden.
    'carrier', COALESCE(v_del.carrier, v_order.carrier),
    'shipping_service', v_order.shipping_service,
    'shipment_status', v_del.status,
    'picked_up_at', v_del.picked_up_at,
    'delivered_at', v_del.delivered_at,
    'tracking_url', NULLIF(v_url, ''),
    'ordered_at', v_order.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_tracking(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_order_tracking(text, text) IS
  'Seguimiento público por número+email. Incluye carrier/shipping_service de la orden para no pintar envío en un retiro.';

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_order_tracking';
  IF v_src IS NULL OR v_src NOT ILIKE '%shipping_service%' THEN
    RAISE EXCEPTION 'get_order_tracking no expone shipping_service';
  END IF;
  IF v_src NOT ILIKE '%COALESCE(v_del.carrier, v_order.carrier)%' THEN
    RAISE EXCEPTION 'get_order_tracking no cae al carrier de la orden';
  END IF;
END $$;
