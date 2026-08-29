-- Prueba reversible del cierre QR de mostrador.
--
-- No llama a Mercado Pago ni toca un comercio real: crea una organización ZZ,
-- atraviesa la misma máquina de estados que usa la Edge Function y hace
-- ROLLBACK después de comprobar reserva, acreditación, idempotencia y vencimiento.
BEGIN;

CREATE TEMP TABLE zz_pos_qr_proof (
  check_name text,
  value text
) ON COMMIT DROP;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_user uuid;
  v_client_key uuid := gen_random_uuid();
  v_cancel_key uuid := gen_random_uuid();
  v_abandon_key uuid := gen_random_uuid();
  v_orphan_key uuid := gen_random_uuid();
  v_session uuid;
  v_cancel_session uuid;
  v_abandon_session uuid;
  v_orphan_session uuid;
  v_sale_id uuid := gen_random_uuid();
  v_cancel_sale_id uuid := gen_random_uuid();
  v_abandon_sale_id uuid := gen_random_uuid();
  v_orphan_sale_id uuid := gen_random_uuid();
  v_response jsonb;
  v_transaction uuid;
  v_amount numeric;
  v_platform_fee numeric;
  v_stock numeric;
  v_retry_state text;
  v_count integer;
  v_restos integer;
  v_payment public.payment_transactions%ROWTYPE;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No hay usuario para la fixture ZZ';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org,
    'ZZ POS QR Orders',
    'zz-pos-qr-' || substr(v_org::text, 1, 8),
    v_user
  );
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  UPDATE public.settings SET exchange_rate = 1000 WHERE org_id = v_org;

  INSERT INTO public.products (
    id, org_id, user_id, name, sale_price_ars,
    cost_usd, total_cost_usd, stock
  ) VALUES (
    v_product, v_org, v_user, 'ZZ Producto QR', 9000,
    2, 2, 10
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  v_response := public.pos_qr_session_prepare(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_sale_id,
      'product_id', v_product,
      'product_name', 'ZZ Producto QR',
      'quantity', 1,
      'unit_price_ars', 9000,
      'customer_name', 'ZZ Cliente QR',
      'paid', true,
      'payment_method', 'qr',
      'source', 'pos'
    )),
    v_client_key
  );
  v_session := (v_response->>'session_id')::uuid;
  v_amount := (v_response->>'amount')::numeric;
  v_platform_fee := (v_response->>'platform_fee')::numeric;

  ASSERT v_response->>'state' = 'preparing', 'la sesión no nació preparando';
  ASSERT v_amount = 9000, 'el QR no bloqueó el total server-side';
  ASSERT (SELECT stock FROM public.products WHERE id = v_product) = 10,
    'preparar el QR movió stock físico';
  ASSERT (SELECT count(*) FROM public.stock_reservations
          WHERE pos_qr_session_id = v_session AND status = 'active') = 1,
    'el QR no reservó una unidad';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id),
    'se creó una venta antes de acreditar';

  PERFORM public.pos_qr_provider_created(
    v_session,
    'ORD_ZZ_' || replace(v_session::text, '-', ''),
    '000201010212ZZGESTIONAQR6304ABCD',
    'created',
    jsonb_build_object('proof', true)
  );

  v_response := public.pos_qr_apply_provider(
    v_session,
    'ORD_ZZ_' || replace(v_session::text, '-', ''),
    'processed',
    'accredited',
    'PAY_ZZ_' || replace(v_session::text, '-', ''),
    v_amount,
    v_amount - v_platform_fee - 300,
    300,
    jsonb_build_object('proof', true)
  );
  v_transaction := (v_response->>'sale_transaction_id')::uuid;

  SELECT stock INTO v_stock FROM public.products WHERE id = v_product;
  SELECT * INTO v_payment
  FROM public.payment_transactions payment
  WHERE payment.org_id = v_org
    AND payment.source = 'pos'
    AND payment.source_id = v_transaction;

  ASSERT v_response->>'state' = 'completed', 'processed no cerró la sesión';
  ASSERT v_transaction IS NOT NULL, 'processed no devolvió el ticket';
  ASSERT (SELECT count(*) FROM public.sales WHERE sale_transaction_id = v_transaction) = 1,
    'la acreditación no creó exactamente una línea';
  ASSERT v_stock = 9, 'la acreditación no movió exactamente una unidad';
  ASSERT (SELECT status FROM public.stock_reservations
          WHERE pos_qr_session_id = v_session) = 'fulfilled',
    'la reserva acreditada no quedó cumplida';
  ASSERT v_payment.status = 'approved'
    AND v_payment.provider = 'mercadopago'
    AND v_payment.method = 'wallet'
    AND v_payment.gross_amount = v_amount
    AND v_payment.provider_fee = 300
    AND v_payment.platform_fee = v_platform_fee
    AND v_payment.net_amount = v_amount - v_platform_fee - 300,
    'la evidencia conciliable no coincide con Mercado Pago';

  -- La misma notificación/poll no puede duplicar ticket ni Kardex.
  v_response := public.pos_qr_apply_provider(
    v_session,
    'ORD_ZZ_' || replace(v_session::text, '-', ''),
    'processed', 'accredited', NULL,
    v_amount, NULL, NULL, jsonb_build_object('retry', true)
  );
  ASSERT (v_response->>'reused')::boolean, 'el segundo processed no fue idempotente';
  ASSERT (SELECT count(*) FROM public.sale_transactions
          WHERE id = v_transaction) = 1,
    'el retry duplicó la transacción';
  ASSERT (SELECT stock FROM public.products WHERE id = v_product) = 9,
    'el retry descontó stock otra vez';
  v_retry_state := v_response->>'state';

  -- Un QR vencido libera disponible y jamás fabrica una venta.
  v_response := public.pos_qr_session_prepare(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_cancel_sale_id,
      'product_id', v_product,
      'product_name', 'ZZ Producto QR',
      'quantity', 2,
      'unit_price_ars', 9000,
      'customer_name', 'ZZ Cliente vencido',
      'paid', true,
      'payment_method', 'qr',
      'source', 'pos'
    )),
    v_cancel_key
  );
  v_cancel_session := (v_response->>'session_id')::uuid;
  PERFORM public.pos_qr_provider_created(
    v_cancel_session,
    'ORD_ZZ_' || replace(v_cancel_session::text, '-', ''),
    '000201010212ZZEXPIRED6304ABCD',
    'created', '{}'::jsonb
  );
  v_response := public.pos_qr_apply_provider(
    v_cancel_session,
    'ORD_ZZ_' || replace(v_cancel_session::text, '-', ''),
    'expired', 'expired', NULL, NULL, NULL, NULL, '{}'::jsonb
  );
  ASSERT v_response->>'state' = 'expired', 'el proveedor vencido no cerró la sesión';
  ASSERT (SELECT status FROM public.stock_reservations
          WHERE pos_qr_session_id = v_cancel_session) = 'expired',
    'el QR vencido no liberó la reserva';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_cancel_sale_id),
    'el QR vencido creó una venta';

  -- Cerrar la pestaña antes de recibir la Order no puede dejar una reserva
  -- activa. Cancelar el intento lo resuelve en todas las tablas y no vende.
  v_response := public.pos_qr_session_prepare(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_abandon_sale_id,
      'product_id', v_product,
      'product_name', 'ZZ QR cancelado antes de Order',
      'quantity', 1,
      'unit_price_ars', 9000,
      'paid', true,
      'payment_method', 'qr',
      'source', 'pos'
    )),
    v_abandon_key
  );
  v_abandon_session := (v_response->>'session_id')::uuid;
  v_response := public.pos_qr_cancel_uncreated(v_abandon_session);
  ASSERT v_response->>'state' = 'cancelled', 'cancelar sin Order no cerró la sesión';
  ASSERT (SELECT status FROM public.stock_reservations
          WHERE pos_qr_session_id = v_abandon_session) = 'cancelled',
    'cancelar sin Order no liberó la reserva';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_abandon_sale_id),
    'cancelar sin Order fabricó una venta';

  -- Una respuesta ambigua se conserva durante el vencimiento y 30 minutos
  -- extra. Después ya no puede cobrarse y el reconciliador la expira.
  v_response := public.pos_qr_session_prepare(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_orphan_sale_id,
      'product_id', v_product,
      'product_name', 'ZZ QR huérfano',
      'quantity', 1,
      'unit_price_ars', 9000,
      'paid', true,
      'payment_method', 'qr',
      'source', 'pos'
    )),
    v_orphan_key
  );
  v_orphan_session := (v_response->>'session_id')::uuid;
  UPDATE public.pos_qr_sessions
  SET expires_at = now() - interval '31 minutes'
  WHERE id = v_orphan_session;
  ASSERT public.pos_qr_expire_orphans() >= 1,
    'el reconciliador no encontró el intento huérfano';
  ASSERT (SELECT state FROM public.pos_qr_sessions WHERE id = v_orphan_session) = 'expired',
    'el intento huérfano no venció';
  ASSERT (SELECT status FROM public.stock_reservations
          WHERE pos_qr_session_id = v_orphan_session) = 'expired',
    'el intento huérfano no liberó la reserva';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_orphan_sale_id),
    'expirar el intento huérfano fabricó una venta';

  UPDATE public.pos_qr_sessions
  SET cashier_acknowledged_at = now()
  WHERE id = v_session AND state = 'completed';
  ASSERT (SELECT cashier_acknowledged_at IS NOT NULL
          FROM public.pos_qr_sessions WHERE id = v_session),
    'Caja no puede persistir el reconocimiento del cierre';

  INSERT INTO zz_pos_qr_proof VALUES
    ('total_qr', v_amount::text),
    ('comision_plataforma', v_platform_fee::text),
    ('ticket', v_transaction::text),
    ('stock_final', v_stock::text),
    ('pago', v_payment.provider || ':' || v_payment.status || ':' || v_payment.gross_amount),
    ('retry_idempotente', v_retry_state),
    ('cancelacion_sin_order', 'cancelled'),
    ('huerfano_vencido', 'expired'),
    ('cierre_reconocido', 'si');

  -- payment_intents no tiene FK a organizations en el esquema histórico; se
  -- limpian explícitamente para que la prueba también detecte restos reales.
  DELETE FROM public.pos_qr_sessions WHERE org_id = v_org;
  DELETE FROM public.payment_intents WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sale_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_intents WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_attempts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.pos_qr_sessions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.stock_reservations WHERE org_id = v_org)
  INTO v_restos;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' restos ZZ';
  INSERT INTO zz_pos_qr_proof VALUES ('restos', v_restos::text);
END;
$proof$;

SELECT check_name, value FROM zz_pos_qr_proof ORDER BY check_name;

ROLLBACK;
