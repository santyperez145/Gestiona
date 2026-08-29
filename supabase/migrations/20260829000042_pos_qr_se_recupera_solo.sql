-- Un cobro QR no puede depender de que Caja siga abierta.
--
-- El webhook de Mercado Pago sigue siendo el camino principal. Este slice
-- agrega dos redes de seguridad:
--   1. una tarea por minuto vuelve a consultar las Orders todavía abiertas;
--   2. Caja conserva una venta cerrada hasta que una persona la reconoce.
--
-- No se libera una reserva por un simple error de red. Una sesión sin order
-- conocida vence recién 30 minutos después del vencimiento del QR: incluso si
-- la respuesta de creación se perdió, esa Order ya no puede recibir un pago.

ALTER TABLE public.pos_qr_sessions
  ADD COLUMN IF NOT EXISTS cashier_acknowledged_at timestamptz;

COMMENT ON COLUMN public.pos_qr_sessions.cashier_acknowledged_at IS
  'Momento en que Caja mostró y reconoció un cierre QR recuperado. No altera el estado financiero.';

CREATE INDEX IF NOT EXISTS pos_qr_sessions_recovery_idx
  ON public.pos_qr_sessions (org_id, created_by, created_at DESC)
  WHERE state IN ('preparing','pending','accredited','finalizing')
     OR (state = 'completed' AND cashier_acknowledged_at IS NULL);

-- Cierra intentos huérfanos que nunca llegaron a guardar una Order. La demora
-- adicional evita tratar una respuesta ambigua de proveedor como rechazo.
CREATE OR REPLACE FUNCTION public.pos_qr_expire_orphans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session record;
  v_count integer := 0;
BEGIN
  FOR v_session IN
    SELECT id, payment_attempt_id, payment_intent_id
    FROM public.pos_qr_sessions
    WHERE state = 'preparing'
      AND provider_order_id IS NULL
      AND expires_at < now() - interval '30 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.pos_qr_sessions
    SET state = 'expired',
        provider_status = 'expired_without_persisted_order',
        provider_status_detail = 'El intento vencio sin una order recuperable',
        failure_reason = 'El intento QR vencio antes de confirmar la order de Mercado Pago',
        updated_at = now()
    WHERE id = v_session.id AND state = 'preparing';

    IF FOUND THEN
      UPDATE public.payment_attempts
      SET estado = 'expirado',
          motivo = 'El intento QR vencio sin una order recuperable',
          resuelto_at = now()
      WHERE id = v_session.payment_attempt_id AND estado <> 'aprobado';

      UPDATE public.payment_intents
      SET estado = 'expirado', updated_at = now()
      WHERE id = v_session.payment_intent_id AND estado <> 'acreditado';

      UPDATE public.stock_reservations
      SET status = 'expired', resolved_at = now()
      WHERE pos_qr_session_id = v_session.id AND status = 'active';

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Cancelar antes de que exista una Order es seguro y debe liberar la reserva.
-- Si la Order ya fue guardada, la Edge tiene que cancelarla en Mercado Pago y
-- reconciliar la respuesta; esta función se niega a saltear ese paso.
CREATE OR REPLACE FUNCTION public.pos_qr_cancel_uncreated(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.pos_qr_sessions;
BEGIN
  SELECT * INTO v_session
  FROM public.pos_qr_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Sesion QR inexistente'; END IF;
  IF v_session.provider_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'La order debe cancelarse primero en Mercado Pago';
  END IF;
  IF v_session.state IN ('completed','refunded') THEN
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;

  UPDATE public.pos_qr_sessions
  SET state = 'cancelled', provider_status = 'cancelled_before_order',
      provider_status_detail = 'Cancelado por el cajero antes de crear la order',
      updated_at = now()
  WHERE id = p_session_id;

  UPDATE public.payment_attempts
  SET estado = 'rechazado', motivo = 'Cancelado antes de crear la order',
      resuelto_at = now()
  WHERE id = v_session.payment_attempt_id AND estado <> 'aprobado';

  UPDATE public.payment_intents
  SET estado = 'cancelado', updated_at = now()
  WHERE id = v_session.payment_intent_id AND estado <> 'acreditado';

  UPDATE public.stock_reservations
  SET status = 'cancelled', resolved_at = now()
  WHERE pos_qr_session_id = p_session_id AND status = 'active';

  RETURN public.pos_qr_session_response(p_session_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_expire_orphans()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_qr_cancel_uncreated(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_qr_expire_orphans() TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_qr_cancel_uncreated(uuid) TO service_role;

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'reconcile-pos-qr-orders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'reconcile-pos-qr-orders',
    '* * * * *',
    $command$SELECT public.invoke_edge_function('mercadopago-pos-qr');$command$
  );
END;
$schedule$;

DO $guard$
BEGIN
  ASSERT NOT has_function_privilege(
    'authenticated', 'public.pos_qr_expire_orphans()', 'EXECUTE'
  ), 'el navegador puede expirar sesiones QR';
  ASSERT NOT has_function_privilege(
    'authenticated', 'public.pos_qr_cancel_uncreated(uuid)', 'EXECUTE'
  ), 'el navegador puede cancelar una reserva QR sin pasar por la Edge';
  ASSERT (
    SELECT count(*) = 1 FROM cron.job
    WHERE jobname = 'reconcile-pos-qr-orders' AND active
  ), 'falta el reconciliador periodico de QR';
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000042', 'pos_qr_se_recupera_solo')
ON CONFLICT DO NOTHING;
