-- Los efectos comerciales pertenecen al ticket, no a cada renglon ni a la
-- pestaña que lo cobro.
--
-- Hasta esta migracion convivian tres autoridades:
--   * un trigger otorgaba fidelidad por cada fila de `sales`;
--   * POS volvia a otorgarla desde el navegador, usando por error product_id
--     como reference_id;
--   * la alerta de venta grande se creaba una vez por renglon y otra vez en UI.
--
-- Una acreditacion QR recuperada por webhook/cron no ejecuta codigo del
-- navegador, por lo que ademas perdia los efectos client-only. La unidad
-- correcta ya existe: `sale_transactions`. Esta funcion reconcilia el total
-- completo de ese ticket y es idempotente frente a insert, retry, update y
-- anulacion de renglones.

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_points_org_ticket_sale_uidx
  ON public.loyalty_points (org_id, reference_id, reason)
  WHERE reference_id IS NOT NULL AND reason = 'sale';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_org_sale_transaction_uidx
  ON public.notifications (org_id, type, entity_type, entity_id)
  WHERE type = 'venta_grande'
    AND entity_type = 'sale_transaction'
    AND entity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_sale_transaction_effects(
  p_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction public.sale_transactions%ROWTYPE;
  v_lines integer := 0;
  v_total numeric := 0;
  v_customer_name text;
  v_customer_id uuid;
  v_customer_names integer := 0;
  v_user_id uuid;
  v_loyalty_enabled boolean := false;
  v_points_per_1000 integer := 1;
  v_points integer := 0;
  v_large_threshold numeric := 50000;
  v_loyalty_written boolean := false;
  v_notification_written boolean := false;
BEGIN
  IF p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ignored', 'reason', 'transaction_id_missing');
  END IF;

  SELECT transaction.* INTO v_transaction
  FROM public.sale_transactions transaction
  WHERE transaction.id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RETURN jsonb_build_object('status', 'ignored', 'reason', 'transaction_not_found');
  END IF;

  SELECT
    count(*),
    COALESCE(sum(COALESCE(sale.total_ars, 0)), 0),
    min(NULLIF(btrim(sale.customer_name), '')),
    min(sale.customer_id::text)::uuid,
    count(DISTINCT public.normalize_person_name(NULLIF(btrim(sale.customer_name), ''))),
    min(sale.user_id::text)::uuid
  INTO
    v_lines, v_total, v_customer_name, v_customer_id,
    v_customer_names, v_user_id
  FROM public.sales sale
  WHERE sale.sale_transaction_id = p_transaction_id;

  -- La ultima linea anulada retira los efectos del ticket. El padre comercial
  -- permanece como evidencia; por eso no se depende de ON DELETE CASCADE.
  IF v_lines = 0 THEN
    DELETE FROM public.loyalty_points point
    WHERE point.org_id = v_transaction.org_id
      AND point.reference_id = p_transaction_id
      AND point.reason = 'sale';

    DELETE FROM public.notifications notification
    WHERE notification.org_id = v_transaction.org_id
      AND notification.type = 'venta_grande'
      AND notification.entity_type = 'sale_transaction'
      AND notification.entity_id = p_transaction_id::text;

    RETURN jsonb_build_object(
      'status', 'removed', 'transaction_id', p_transaction_id,
      'lines', 0, 'total_ars', 0
    );
  END IF;

  SELECT
    COALESCE(setting.loyalty_enabled, false),
    GREATEST(COALESCE(setting.loyalty_points_per_1000, 1), 0),
    GREATEST(COALESCE(setting.large_sale_threshold_ars, 50000), 0)
  INTO v_loyalty_enabled, v_points_per_1000, v_large_threshold
  FROM public.settings setting
  WHERE setting.org_id = v_transaction.org_id
  LIMIT 1;

  IF NOT FOUND THEN
    v_loyalty_enabled := false;
    v_points_per_1000 := 1;
    v_large_threshold := 50000;
  END IF;

  -- `points_per_1000` conserva la politica historica: cada bloque completo de
  -- ARS 1.000 multiplica la tasa. Un ticket de 1.500 con tasa 2 gana 2, no 3.
  v_points := floor(v_total / 1000.0)::integer * v_points_per_1000;

  IF v_loyalty_enabled
     AND v_customer_name IS NOT NULL
     AND v_customer_names = 1
     AND v_points > 0 THEN
    INSERT INTO public.loyalty_points (
      org_id, customer_id, customer_name, delta, reason, reference_id
    ) VALUES (
      v_transaction.org_id, v_customer_id, v_customer_name,
      v_points, 'sale', p_transaction_id
    )
    ON CONFLICT (org_id, reference_id, reason)
      WHERE reference_id IS NOT NULL AND reason = 'sale'
    DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      customer_name = EXCLUDED.customer_name,
      delta = EXCLUDED.delta;
    v_loyalty_written := true;
  ELSE
    -- No atribuir puntos a un nombre arbitrario cuando un ticket inconsistente
    -- trae mas de un cliente. El resultado lo hace visible para observabilidad.
    DELETE FROM public.loyalty_points point
    WHERE point.org_id = v_transaction.org_id
      AND point.reference_id = p_transaction_id
      AND point.reason = 'sale';
  END IF;

  v_user_id := COALESCE(v_transaction.created_by, v_user_id);
  IF v_total >= v_large_threshold AND v_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, org_id, title, message, type, entity_type, entity_id
    ) VALUES (
      v_user_id,
      v_transaction.org_id,
      'Venta grande registrada',
      format(
        '%s renglones - $%s ARS%s',
        v_lines,
        round(v_total),
        CASE
          WHEN v_customer_names = 1 THEN ' - Cliente: ' || v_customer_name
          WHEN v_customer_names > 1 THEN ' - Revisar: el ticket tiene mas de un cliente'
          ELSE ' - Venta sin nombre de cliente'
        END
      ),
      'venta_grande',
      'sale_transaction',
      p_transaction_id::text
    )
    ON CONFLICT (org_id, type, entity_type, entity_id)
      WHERE type = 'venta_grande'
        AND entity_type = 'sale_transaction'
        AND entity_id IS NOT NULL
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      read = false;
    v_notification_written := true;
  ELSE
    DELETE FROM public.notifications notification
    WHERE notification.org_id = v_transaction.org_id
      AND notification.type = 'venta_grande'
      AND notification.entity_type = 'sale_transaction'
      AND notification.entity_id = p_transaction_id::text;
  END IF;

  RETURN jsonb_build_object(
    'status', 'reconciled',
    'transaction_id', p_transaction_id,
    'lines', v_lines,
    'total_ars', v_total,
    'loyalty_points', CASE WHEN v_loyalty_written THEN v_points ELSE 0 END,
    'loyalty_written', v_loyalty_written,
    'large_sale_notification', v_notification_written,
    'customer_conflict', v_customer_names > 1
  );
END;
$function$;

COMMENT ON FUNCTION public.reconcile_sale_transaction_effects(uuid) IS
  'Reconcilia fidelidad y alerta de venta grande una vez por ticket. Interna, idempotente y recalculable ante anulaciones.';

REVOKE ALL ON FUNCTION public.reconcile_sale_transaction_effects(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sale_transaction_effects(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trg_reconcile_sale_transaction_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction_id uuid;
BEGIN
  v_transaction_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.sale_transaction_id
    ELSE NEW.sale_transaction_id
  END;

  IF v_transaction_id IS NOT NULL THEN
    PERFORM public.reconcile_sale_transaction_effects(v_transaction_id);
  ELSIF TG_OP = 'DELETE' THEN
    -- Compatibilidad para una linea historica sin padre comercial.
    DELETE FROM public.loyalty_points point
    WHERE point.org_id = OLD.org_id
      AND point.reference_id = OLD.id
      AND point.reason = 'sale';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
EXCEPTION WHEN OTHERS THEN
  -- Fidelidad/alertas son secundarias: nunca revierten una venta o devolucion.
  -- A diferencia del trigger heredado, el fallo no queda silenciado.
  RAISE WARNING 'No se pudieron reconciliar efectos del ticket %: %',
    COALESCE(v_transaction_id::text, 'sin-id'), SQLERRM;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_reconcile_sale_transaction_effects()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale ON public.sales;
DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale_delete ON public.sales;
DROP TRIGGER IF EXISTS trg_notify_large_sale ON public.sales;
DROP TRIGGER IF EXISTS trg_reconcile_sale_transaction_effects ON public.sales;

CREATE TRIGGER trg_reconcile_sale_transaction_effects
AFTER INSERT OR UPDATE OR DELETE ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.trg_reconcile_sale_transaction_effects();

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000043', 'pos_ticket_post_sale_effects')
ON CONFLICT DO NOTHING;
