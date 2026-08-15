-- B5: el comprador tiene que saber que pasó después de pagar.
--
-- La etiqueta y el tracking ya existían, pero la operación no tenía un camino
-- explícito para "en camino" y "entregado", ni un aviso confiable que no se
-- reenviara cada vez que alguien abría el pedido. Este archivo deja el cambio
-- de estado en la base (con permisos y transiciones hacia adelante) y la Edge
-- Function se limita a enviar el email y registrar su resultado.
--
-- Idempotente. No toca stock ni crea ventas: un estado logístico nunca es un
-- movimiento de inventario.

CREATE TABLE IF NOT EXISTS public.store_order_status_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecommerce_order_id uuid NOT NULL REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('shipped', 'delivered')),
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecommerce_order_id, event)
);

CREATE INDEX IF NOT EXISTS store_order_status_email_log_pending_idx
  ON public.store_order_status_email_log (status, updated_at)
  WHERE status <> 'sent';

ALTER TABLE public.store_order_status_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_order_status_email_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.store_order_status_email_log IS
  'Auditoría privada e idempotencia de los avisos de envío de ecommerce. Sólo la Edge Function con service_role la lee o escribe.';

-- Las fechas son una propiedad del cambio de estado, no de la pantalla que lo
-- disparó. Así `set_order_tracking` y el nuevo RPC no pueden olvidarlas.
CREATE OR REPLACE FUNCTION public.stamp_store_order_fulfillment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status THEN
    IF NEW.fulfillment_status = 'shipped' THEN
      NEW.shipped_at := COALESCE(NEW.shipped_at, now());
    ELSIF NEW.fulfillment_status = 'delivered' THEN
      NEW.delivered_at := COALESCE(NEW.delivered_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_order_fulfillment_timestamps ON public.ecommerce_orders;
CREATE TRIGGER trg_store_order_fulfillment_timestamps
  BEFORE UPDATE OF fulfillment_status ON public.ecommerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.stamp_store_order_fulfillment();

-- Sólo permite avanzar desde una entrega ya preparada: cobrar no equivale a
-- despachar, y marcar entregado sin que haya salido tampoco. El cliente nunca
-- puede llamar esto porque el RPC exige rol de operación dentro de la org.
CREATE OR REPLACE FUNCTION public.update_store_order_fulfillment(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_delivery_id uuid;
  v_status text := lower(btrim(COALESCE(p_status, '')));
BEGIN
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Estado de entrega inválido: %', COALESCE(p_status, '');
  END IF;

  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para actualizar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;

  SELECT id INTO v_delivery_id
  FROM public.deliveries
  WHERE ecommerce_order_id = p_order_id
  ORDER BY created_at
  LIMIT 1;
  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Primero prepará el envío de la orden';
  END IF;

  IF v_order.fulfillment_status = 'delivered' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'delivered');
  END IF;

  IF v_status = 'shipped' THEN
    -- Repetir el click no cambia fechas ni vuelve a mandar el pedido hacia
    -- atrás; la función de email resuelve el aviso una sola vez por evento.
    IF v_order.fulfillment_status = 'shipped' THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'shipped');
    END IF;
    IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
      RAISE EXCEPTION 'La orden no está en un estado que se pueda despachar';
    END IF;

    UPDATE public.deliveries
       SET status = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
           picked_up_at = COALESCE(picked_up_at, now()),
           updated_at = now()
     WHERE id = v_delivery_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'shipped', updated_at = now()
     WHERE id = p_order_id;
  ELSE
    IF v_order.fulfillment_status <> 'shipped' THEN
      RAISE EXCEPTION 'La orden tiene que estar en camino antes de marcarse entregada';
    END IF;

    UPDATE public.deliveries
       SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
     WHERE id = v_delivery_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'delivered', updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', true, 'status', v_status);
END;
$$;

-- Preparar sigue siendo una acción de ecommerce: `vendedor` puede hacerlo si
-- la matriz le concede editar el módulo; owner/admin siguen pasando por la
-- misma autoridad, no por una lista de roles que se desincroniza.
CREATE OR REPLACE FUNCTION public.prepare_order_shipment(
  p_order_id uuid,
  p_carrier text DEFAULT 'propio',
  p_weight_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_dir jsonb;
  v_id uuid;
  v_code text;
  v_peso numeric;
  v_carrier text := COALESCE(NULLIF(btrim(p_carrier), ''), 'propio');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para preparar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN RAISE EXCEPTION 'La orden todavía no está paga'; END IF;
  IF v_carrier NOT IN ('propio','oca','andreani','correo_arg','mercado_envios','otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  SELECT id, tracking_code INTO v_id, v_code
  FROM public.deliveries WHERE ecommerce_order_id = p_order_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', true);
  END IF;

  v_dir := COALESCE(v_order.shipping_address, '{}'::jsonb);
  IF p_weight_kg IS NOT NULL AND p_weight_kg > 0 THEN
    v_peso := p_weight_kg;
  ELSE
    SELECT COALESCE(s.default_item_weight_kg, 0.5)
             * GREATEST(1, (SELECT COALESCE(sum((it->>'quantity')::int), 1)
                            FROM jsonb_array_elements(v_order.items) it))
      INTO v_peso
    FROM public.ecommerce_stores s WHERE s.org_id = v_order.org_id LIMIT 1;
    v_peso := COALESCE(v_peso, 0.5);
  END IF;

  v_code := 'ENV-' || v_order.order_number;
  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code,
    customer_name, customer_phone, customer_email,
    address_street, address_city, address_province, address_zip, address_notes,
    carrier, status, weight_kg, cod_amount, cod_collected
  ) VALUES (
    v_order.org_id, p_order_id, v_code,
    v_order.customer_name, v_order.customer_phone, v_order.customer_email,
    COALESCE(NULLIF(v_dir->>'calle', ''), NULLIF(v_dir->>'street', ''), v_dir->>'address', ''),
    COALESCE(NULLIF(v_dir->>'ciudad', ''), v_dir->>'city', ''),
    COALESCE(NULLIF(v_dir->>'provincia', ''), NULLIF(v_dir->>'province', ''), v_dir->>'state', ''),
    COALESCE(NULLIF(v_dir->>'cp', ''), NULLIF(v_dir->>'zip', ''), v_dir->>'postal_code', ''),
    COALESCE(NULLIF(v_dir->>'notas', ''), NULLIF(v_dir->>'notes', '')),
    v_carrier, 'pending', v_peso, 0, true
  ) RETURNING id INTO v_id;

  UPDATE public.ecommerce_orders
     SET fulfillment_status = 'processing', updated_at = now()
   WHERE id = p_order_id AND fulfillment_status IN ('pending', 'unfulfilled');

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', false);
END;
$$;

-- Cargar un tracking también es marcar que salió, pero no puede devolver una
-- orden ya entregada a "en camino" por accidente.
CREATE OR REPLACE FUNCTION public.set_order_tracking(
  p_order_id uuid,
  p_carrier text,
  p_tracking text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_tracking text := NULLIF(btrim(p_tracking), '');
  v_carrier text := NULLIF(btrim(p_carrier), '');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN RAISE EXCEPTION 'La orden todavía no está paga'; END IF;
  IF v_order.fulfillment_status = 'delivered' THEN
    RAISE EXCEPTION 'La orden ya fue marcada como entregada';
  END IF;
  IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing', 'shipped') THEN
    RAISE EXCEPTION 'La orden no está en un estado que se pueda despachar';
  END IF;
  IF v_tracking IS NULL THEN RAISE EXCEPTION 'Falta el número de seguimiento'; END IF;
  IF v_carrier IS NOT NULL
     AND v_carrier NOT IN ('propio','oca','andreani','correo_arg','mercado_envios','otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  UPDATE public.deliveries
     SET carrier = COALESCE(v_carrier, carrier),
         external_tracking = v_tracking,
         status = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
         picked_up_at = COALESCE(picked_up_at, now()),
         updated_at = now()
   WHERE ecommerce_order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Primero prepará el envío de la orden'; END IF;

  UPDATE public.ecommerce_orders
     SET tracking_number = v_tracking,
         carrier = COALESCE(v_carrier, carrier),
         fulfillment_status = 'shipped',
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'tracking', v_tracking);
END;
$$;

REVOKE ALL ON FUNCTION public.update_store_order_fulfillment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_store_order_fulfillment(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_order_tracking(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_tracking(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.update_store_order_fulfillment(uuid, text) IS
  'Avanza una orden pagada y ya preparada a shipped o delivered; valida rol y nunca toca stock.';

-- Verificación real sin tocar datos del comercio. Se ejecuta como una
-- membresía real mediante request.jwt.claims, recorre shipped -> delivered,
-- comprueba fechas y permisos, y borra hasta el último ZZ.
CREATE TEMP TABLE IF NOT EXISTS zz_store_status_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
);
TRUNCATE zz_store_status_verification;

DO $$
DECLARE
  v_store record;
  v_user uuid;
  v_order uuid;
  v_delivery uuid;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_shipped_at timestamptz;
  v_delivered_at timestamptz;
  v_status text;
BEGIN
  SELECT s.id, s.org_id INTO v_store
  FROM public.ecommerce_stores s
  JOIN public.memberships m ON m.org_id = s.org_id
  WHERE m.role IN ('owner', 'admin')
  ORDER BY s.created_at
  LIMIT 1;

  IF v_store.id IS NULL THEN
    INSERT INTO zz_store_status_verification VALUES
      ('flujo_real', false, 'No hay tienda con membresía operativa para ejecutar el caso ZZ');
    RETURN;
  END IF;

  SELECT m.user_id INTO v_user
  FROM public.memberships m
  WHERE m.org_id = v_store.org_id AND m.role IN ('owner', 'admin')
  ORDER BY m.joined_at
  LIMIT 1;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    payment_status, fulfillment_status, shipping_address
  ) VALUES (
    v_store.org_id, v_store.id, 'ZZ-EST-' || v_suffix, 'ZZ estado',
    'zz-status-' || v_suffix || '@invalid.test', 'paid', 'processing',
    jsonb_build_object('calle', 'ZZ 123', 'ciudad', 'ZZ Ciudad', 'provincia', 'C', 'cp', '1000')
  ) RETURNING id INTO v_order;

  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code, customer_name, customer_email,
    address_street, address_city, carrier, status, cod_amount, cod_collected
  ) VALUES (
    v_store.org_id, v_order, 'ZZ-ENV-' || v_suffix, 'ZZ estado',
    'zz-status-' || v_suffix || '@invalid.test', 'ZZ 123', 'ZZ Ciudad',
    'propio', 'pending', 0, true
  ) RETURNING id INTO v_delivery;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM public.update_store_order_fulfillment(v_order, 'shipped');
  SELECT fulfillment_status, shipped_at INTO v_status, v_shipped_at
  FROM public.ecommerce_orders WHERE id = v_order;
  IF v_status <> 'shipped' OR v_shipped_at IS NULL THEN
    RAISE EXCEPTION 'No se registró el estado o fecha de envío';
  END IF;

  PERFORM public.update_store_order_fulfillment(v_order, 'delivered');
  SELECT delivered_at INTO v_delivered_at FROM public.ecommerce_orders WHERE id = v_order;
  IF v_delivered_at IS NULL THEN RAISE EXCEPTION 'No se registró la fecha de entrega'; END IF;

  INSERT INTO zz_store_status_verification VALUES ('flujo_real', true, 'shipped -> delivered con fechas');

  DELETE FROM public.store_order_status_email_log WHERE ecommerce_order_id = v_order;
  DELETE FROM public.deliveries WHERE id = v_delivery;
  DELETE FROM public.ecommerce_orders WHERE id = v_order;
END;
$$;

INSERT INTO zz_store_status_verification
SELECT 'anon_no_ejecuta_rpc',
       NOT has_function_privilege('anon', 'public.update_store_order_fulfillment(uuid,text)', 'EXECUTE'),
       'El cliente anónimo no puede cambiar el estado'
ON CONFLICT (check_name) DO UPDATE SET passed = EXCLUDED.passed, detail = EXCLUDED.detail;

INSERT INTO zz_store_status_verification
SELECT 'log_privado',
       NOT has_table_privilege('anon', 'public.store_order_status_email_log', 'SELECT')
         AND NOT has_table_privilege('authenticated', 'public.store_order_status_email_log', 'SELECT'),
       'El navegador no puede leer destinatarios ni historial de email'
ON CONFLICT (check_name) DO UPDATE SET passed = EXCLUDED.passed, detail = EXCLUDED.detail;

INSERT INTO zz_store_status_verification
SELECT 'restos_zz',
       NOT EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE order_number LIKE 'ZZ-EST-%')
         AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE tracking_code LIKE 'ZZ-ENV-%'),
       'La verificación no dejó orden ni entrega de prueba'
ON CONFLICT (check_name) DO UPDATE SET passed = EXCLUDED.passed, detail = EXCLUDED.detail;

SELECT * FROM zz_store_status_verification ORDER BY check_name;
