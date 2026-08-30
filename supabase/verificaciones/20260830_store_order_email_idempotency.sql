-- Verificación reversible del ledger de emails de órdenes.
-- No llama a ningún proveedor ni imprime datos de compradores.

BEGIN;

CREATE TEMP TABLE zz_store_order_email_result (
  first_claim boolean,
  concurrent_blocked boolean,
  wrong_worker_blocked boolean,
  finished boolean,
  sent_deduplicated boolean,
  stale_reclaimed boolean,
  stale_worker_blocked boolean,
  retry_attempt integer
) ON COMMIT DROP;

DO $$
DECLARE
  v_order_id uuid;
  v_first jsonb;
  v_concurrent jsonb;
  v_after_sent jsonb;
  v_stale_first jsonb;
  v_stale_second jsonb;
  v_wrong_finish boolean;
  v_finished boolean;
  v_stale_finish boolean;
BEGIN
  SELECT id INTO v_order_id
  FROM public.ecommerce_orders
  ORDER BY created_at
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'La fixture necesita al menos una orden existente';
  END IF;

  DELETE FROM public.store_order_status_email_log
  WHERE ecommerce_order_id = v_order_id
    AND event IN ('order_created', 'payment_confirmed')
    AND audience = 'merchant';

  v_first := public.claim_store_order_email(
    v_order_id,
    'merchant',
    'order_created',
    'zz-email-idempotency@example.invalid',
    300
  );
  v_concurrent := public.claim_store_order_email(
    v_order_id,
    'merchant',
    'order_created',
    'zz-email-idempotency@example.invalid',
    300
  );

  v_wrong_finish := public.finish_store_order_email(
    (v_first->>'deliveryId')::uuid,
    gen_random_uuid(),
    true,
    'resend',
    'zz-wrong-worker',
    NULL
  );
  v_finished := public.finish_store_order_email(
    (v_first->>'deliveryId')::uuid,
    (v_first->>'claimToken')::uuid,
    true,
    'resend',
    'zz-provider-id',
    NULL
  );
  v_after_sent := public.claim_store_order_email(
    v_order_id,
    'merchant',
    'order_created',
    'zz-email-idempotency@example.invalid',
    300
  );

  v_stale_first := public.claim_store_order_email(
    v_order_id,
    'merchant',
    'payment_confirmed',
    'zz-email-idempotency@example.invalid',
    30
  );
  UPDATE public.store_order_status_email_log
  SET claimed_at = clock_timestamp() - interval '31 seconds'
  WHERE id = (v_stale_first->>'deliveryId')::uuid;
  v_stale_second := public.claim_store_order_email(
    v_order_id,
    'merchant',
    'payment_confirmed',
    'zz-email-idempotency@example.invalid',
    30
  );
  v_stale_finish := public.finish_store_order_email(
    (v_stale_first->>'deliveryId')::uuid,
    (v_stale_first->>'claimToken')::uuid,
    true,
    'smtp',
    NULL,
    NULL
  );

  INSERT INTO zz_store_order_email_result VALUES (
    COALESCE((v_first->>'claimed')::boolean, false),
    COALESCE((v_concurrent->>'inProgress')::boolean, false),
    NOT v_wrong_finish,
    v_finished,
    COALESCE((v_after_sent->>'duplicate')::boolean, false),
    COALESCE((v_stale_second->>'claimed')::boolean, false),
    NOT v_stale_finish,
    COALESCE((v_stale_second->>'attempt')::integer, 0)
  );
END;
$$;

SELECT
  r.*,
  NOT has_table_privilege('anon', 'public.store_order_status_email_log', 'SELECT') AS anon_table_blocked,
  NOT has_table_privilege('authenticated', 'public.store_order_status_email_log', 'SELECT') AS authenticated_table_blocked,
  NOT has_function_privilege('anon', 'public.claim_store_order_email(uuid,text,text,text,integer)', 'EXECUTE') AS anon_claim_blocked,
  NOT has_function_privilege('authenticated', 'public.finish_store_order_email(uuid,uuid,boolean,text,text,text)', 'EXECUTE') AS authenticated_finish_blocked
FROM zz_store_order_email_result r;

ROLLBACK;

