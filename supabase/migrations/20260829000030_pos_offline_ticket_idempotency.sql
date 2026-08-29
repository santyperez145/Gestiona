-- POS offline: el ticket, no cada renglon, es la unidad idempotente.
--
-- El navegador ya conservaba `offline_transaction_id`, pero `sales` ignoraba
-- esa clave porque no es una columna de la tabla. Un timeout despues del
-- commit podia dejar el ticket en la cola local y el reintento creaba otra
-- venta, descontaba stock otra vez y volvia a usar el cupon. La clave queda en
-- el padre comercial y todas las consecuencias necesarias del ticket ocurren
-- en esta misma transaccion PostgreSQL.

ALTER TABLE public.sale_transactions
  ADD COLUMN IF NOT EXISTS client_transaction_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sale_transactions_org_client_transaction_uidx
  ON public.sale_transactions (org_id, client_transaction_id)
  WHERE client_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.sale_transactions.client_transaction_id IS
  'Clave idempotente generada por el dispositivo. Un reintento del mismo ticket devuelve la operacion existente sin volver a mover stock, usar cupones ni atribuir ventas.';

-- Una venta impaga genera una sola cuenta corriente. Antes se insertaba desde
-- el navegador despues del commit principal: perder la respuesta podia dejar
-- la venta sin deuda o duplicarla al reintentar.
CREATE UNIQUE INDEX IF NOT EXISTS debts_org_sale_uidx
  ON public.debts (org_id, sale_id)
  WHERE sale_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_sales_transaction(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'manual'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_source text := lower(btrim(COALESCE(p_source, 'manual')));
  v_transaction_id uuid := gen_random_uuid();
  v_client_transaction_id uuid;
  v_client_key_count integer := 0;
  v_existing_transaction_id uuid;
  v_incoming_sale_ids uuid[];
  v_existing_sale_ids uuid[];
  v_line jsonb;
  v_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_sale_ids jsonb := '[]'::jsonb;
  v_first_date timestamptz;
  v_offline_origin boolean := false;
  v_coupon_id uuid;
  v_coupon_count integer := 0;
  v_coupon_lines integer := 0;
  v_coupon public.coupons%ROWTYPE;
  v_coupon_found boolean := false;
  v_coupon_recorded boolean := false;
  v_coupon_code text;
  v_coupon_baseline numeric := 0;
  v_customer_id uuid;
  v_customer_name text;
  v_customer_uses integer := 0;
  v_exchange_id uuid;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organizacion' USING ERRCODE = '42501';
  END IF;

  IF v_actor_id IS NULL
     OR NOT public.has_org_role(p_org_id, v_actor_id, ARRAY['owner','admin','vendedor']) THEN
    RAISE EXCEPTION 'No tenes permiso para registrar ventas en esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sales) = 0
     OR jsonb_array_length(p_sales) > 100 THEN
    RAISE EXCEPTION 'Una venta debe tener entre 1 y 100 renglones';
  END IF;

  IF v_source NOT IN ('manual', 'pos', 'presupuesto') THEN
    RAISE EXCEPTION 'Este canal se registra unicamente desde su integracion de servidor';
  END IF;

  SELECT
    count(DISTINCT NULLIF(value->>'offline_transaction_id', '')),
    min(NULLIF(value->>'offline_transaction_id', ''))::uuid,
    bool_or(COALESCE(NULLIF(value->>'offline_origin', '')::boolean, false)),
    NULLIF((p_sales->0)->>'date', '')::timestamptz
  INTO v_client_key_count, v_client_transaction_id, v_offline_origin, v_first_date
  FROM jsonb_array_elements(p_sales);

  IF v_client_key_count > 1 THEN
    RAISE EXCEPTION 'Todos los renglones deben compartir la misma clave de ticket';
  END IF;

  IF v_client_transaction_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_sales)
      WHERE NULLIF(value->>'id', '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Un ticket reintentable necesita id estable en cada renglon';
    END IF;

    SELECT array_agg((value->>'id')::uuid ORDER BY value->>'id')
      INTO v_incoming_sale_ids
    FROM jsonb_array_elements(p_sales);

    -- Serializa dos requests concurrentes con la misma clave aun antes de que
    -- exista la fila protegida por el indice unico.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('pos-ticket:' || p_org_id::text || ':' || v_client_transaction_id::text, 0)
    );

    SELECT transaction.id
      INTO v_existing_transaction_id
    FROM public.sale_transactions transaction
    WHERE transaction.org_id = p_org_id
      AND transaction.client_transaction_id = v_client_transaction_id;

    IF v_existing_transaction_id IS NOT NULL THEN
      SELECT array_agg(sale.id ORDER BY sale.id::text)
        INTO v_existing_sale_ids
      FROM public.sales sale
      WHERE sale.sale_transaction_id = v_existing_transaction_id;

      IF v_existing_sale_ids IS DISTINCT FROM v_incoming_sale_ids THEN
        RAISE EXCEPTION 'La clave de ticket ya fue usada con otro contenido'
          USING ERRCODE = '23505';
      END IF;

      SELECT COALESCE(jsonb_agg(sale.id ORDER BY sale.created_at, sale.id), '[]'::jsonb)
        INTO v_sale_ids
      FROM public.sales sale
      WHERE sale.sale_transaction_id = v_existing_transaction_id;

      RETURN jsonb_build_object(
        'transaction_id', v_existing_transaction_id,
        'sale_ids', v_sale_ids,
        'lines', jsonb_array_length(v_sale_ids),
        'reused', true,
        'coupon_recorded', true
      );
    END IF;
  END IF;

  -- Un cupon se consume por ticket, no por renglon. El bloqueo de la fila
  -- vuelve atomico el limite incluso con dos cajas vendiendo a la vez.
  SELECT
    count(DISTINCT NULLIF(value->>'coupon_id', '')),
    count(*) FILTER (WHERE NULLIF(value->>'coupon_id', '') IS NOT NULL),
    min(NULLIF(value->>'coupon_id', ''))::uuid,
    max(NULLIF(btrim(value->>'coupon_code'), '')),
    COALESCE(sum(
      COALESCE(NULLIF(value->>'precio_autoritativo', '')::numeric,
               NULLIF(value->>'unit_price_ars', '')::numeric, 0)
      * COALESCE(NULLIF(value->>'quantity', '')::numeric, 0)
    ), 0),
    min(NULLIF(value->>'customer_id', ''))::uuid,
    min(NULLIF(btrim(value->>'customer_name'), ''))
  INTO v_coupon_count, v_coupon_lines, v_coupon_id, v_coupon_code,
       v_coupon_baseline, v_customer_id, v_customer_name
  FROM jsonb_array_elements(p_sales);

  IF v_coupon_count > 1 OR (v_coupon_lines > 0 AND v_coupon_lines <> jsonb_array_length(p_sales)) THEN
    RAISE EXCEPTION 'El cupon pertenece al ticket completo y debe coincidir en todos los renglones';
  END IF;

  IF v_coupon_id IS NOT NULL THEN
    SELECT * INTO v_coupon
    FROM public.coupons coupon
    WHERE coupon.id = v_coupon_id AND coupon.org_id = p_org_id
    FOR UPDATE;
    v_coupon_found := FOUND;

    -- Una venta aceptada sin conexion no puede quedar eternamente trabada si
    -- el cupon fue desactivado, agotado o eliminado mientras el dispositivo
    -- estaba offline. Ese riesgo queda explicitamente acotado a offline_origin.
    IF NOT v_coupon_found AND NOT v_offline_origin THEN
      RAISE EXCEPTION 'Cupon inexistente para esta organizacion';
    END IF;

    IF v_coupon_found THEN
      IF v_coupon_code IS NOT NULL AND upper(v_coupon_code) <> upper(v_coupon.code) THEN
        RAISE EXCEPTION 'El codigo no coincide con el cupon seleccionado';
      END IF;

      IF NOT v_offline_origin THEN
        IF NOT v_coupon.active THEN RAISE EXCEPTION 'Cupon inactivo'; END IF;
        IF v_coupon.valid_from IS NOT NULL AND COALESCE(v_first_date, now()) < v_coupon.valid_from THEN
          RAISE EXCEPTION 'Cupon aun no vigente';
        END IF;
        IF v_coupon.valid_until IS NOT NULL AND COALESCE(v_first_date, now()) > v_coupon.valid_until THEN
          RAISE EXCEPTION 'Cupon vencido';
        END IF;
        IF v_coupon.max_uses IS NOT NULL AND v_coupon.current_uses >= v_coupon.max_uses THEN
          RAISE EXCEPTION 'Cupon agotado';
        END IF;
        IF v_coupon.min_order_value IS NOT NULL AND v_coupon_baseline < v_coupon.min_order_value THEN
          RAISE EXCEPTION 'El ticket no alcanza el minimo del cupon';
        END IF;

        IF v_coupon.max_uses_per_customer IS NOT NULL
           AND (v_customer_id IS NOT NULL OR v_customer_name IS NOT NULL) THEN
          SELECT count(DISTINCT sale.sale_transaction_id)
            INTO v_customer_uses
          FROM public.sales sale
          WHERE sale.org_id = p_org_id
            AND sale.coupon_id = v_coupon_id
            AND (
              (v_customer_id IS NOT NULL AND sale.customer_id = v_customer_id)
              OR (v_customer_id IS NULL AND lower(btrim(COALESCE(sale.customer_name, ''))) = lower(v_customer_name))
            );
          IF v_customer_uses >= v_coupon.max_uses_per_customer THEN
            RAISE EXCEPTION 'Este cliente ya alcanzo el limite del cupon';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.sale_transactions (
    id, org_id, source, created_by, occurred_at, client_transaction_id
  ) VALUES (
    v_transaction_id, p_org_id, v_source, v_actor_id,
    COALESCE(v_first_date, now()), v_client_transaction_id
  );
  PERFORM set_config('gestiona.sale_transaction_id', v_transaction_id::text, true);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sales)
  LOOP
    SELECT * INTO v_sale
    FROM jsonb_populate_record(NULL::public.sales, v_line);

    v_sale.id := COALESCE(v_sale.id, gen_random_uuid());
    v_sale.org_id := p_org_id;
    v_sale.user_id := v_actor_id;
    v_sale.sale_transaction_id := v_transaction_id;
    v_sale.ecommerce_order_id := NULL;
    v_sale.source := v_source;
    v_sale.created_at := now();
    v_sale.product_name := NULLIF(left(btrim(COALESCE(v_sale.product_name, '')), 500), '');
    v_sale.quantity := COALESCE(v_sale.quantity, 0);
    v_sale.unit_price_ars := COALESCE(v_sale.unit_price_ars, 0);
    v_sale.total_ars := COALESCE(v_sale.total_ars, 0);
    v_sale.cost_per_unit_usd := COALESCE(v_sale.cost_per_unit_usd, 0);
    v_sale.cost_of_goods_ars := COALESCE(v_sale.cost_of_goods_ars, 0);
    v_sale.profit_ars := COALESCE(v_sale.profit_ars, 0);
    v_sale.profit_usd := COALESCE(v_sale.profit_usd, 0);
    v_sale.discount_applied := COALESCE(v_sale.discount_applied, false);
    v_sale.date := COALESCE(v_sale.date, now());
    v_sale.paid := COALESCE(v_sale.paid, true);
    v_sale.payment_method := COALESCE(NULLIF(left(btrim(COALESCE(v_sale.payment_method, '')), 100), ''), 'efectivo');
    v_sale.returned := COALESCE(v_sale.returned, false);
    v_sale.returned_quantity := COALESCE(v_sale.returned_quantity, 0);

    IF v_sale.product_name IS NULL OR v_sale.quantity <= 0 THEN
      RAISE EXCEPTION 'Cada renglon necesita un producto y una cantidad mayor a cero';
    END IF;

    -- Si el cupon desaparecio mientras el dispositivo estaba offline se
    -- conserva el codigo como evidencia, pero no un id huerfano.
    IF v_sale.coupon_id IS NOT NULL AND NOT v_coupon_found THEN
      v_sale.coupon_id := NULL;
    END IF;

    INSERT INTO public.sales
    SELECT (v_sale).*
    RETURNING id INTO v_sale_id;

    v_sale_ids := v_sale_ids || to_jsonb(v_sale_id);

    IF NOT v_sale.paid THEN
      INSERT INTO public.debts (
        user_id, org_id, sale_id, customer_id, customer_name,
        amount_ars, paid_ars, remaining_ars, description, date, status
      ) VALUES (
        v_actor_id, p_org_id, v_sale_id, v_sale.customer_id,
        COALESCE(NULLIF(btrim(v_sale.customer_name), ''), 'Sin nombre'),
        v_sale.total_ars, 0, v_sale.total_ars,
        format('Venta de %sx %s', v_sale.quantity, v_sale.product_name),
        v_sale.date, 'pending'
      ) ON CONFLICT DO NOTHING;
    END IF;

    v_exchange_id := NULLIF(v_line->>'influencer_exchange_id', '')::uuid;
    IF v_exchange_id IS NULL
       AND v_sale.attribution_source = 'influencer'
       AND v_sale.coupon_code IS NOT NULL THEN
      SELECT exchange.id INTO v_exchange_id
      FROM public.influencer_exchanges exchange
      WHERE exchange.org_id = p_org_id
        AND upper(exchange.discount_code) = upper(v_sale.coupon_code)
      ORDER BY exchange.created_at DESC NULLS LAST, exchange.id
      LIMIT 1;
    END IF;

    IF v_exchange_id IS NOT NULL THEN
      UPDATE public.influencer_exchanges exchange
      SET sales_generated_ars = COALESCE(exchange.sales_generated_ars, 0) + v_sale.total_ars
      WHERE exchange.id = v_exchange_id AND exchange.org_id = p_org_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'El canje no pertenece a esta organizacion';
      END IF;
    END IF;
  END LOOP;

  IF v_coupon_found THEN
    UPDATE public.coupons
    SET current_uses = current_uses + 1
    WHERE id = v_coupon_id AND org_id = p_org_id;
    v_coupon_recorded := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'sale_ids', v_sale_ids,
    'lines', jsonb_array_length(v_sale_ids),
    'reused', false,
    'coupon_recorded', v_coupon_recorded,
    'offline_coupon_override', v_offline_origin AND v_coupon_id IS NOT NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) IS
  'Crea un ticket idempotente y atomico: venta, stock por trigger, deuda, cupon y atribucion. offline_transaction_id es la clave del dispositivo; offline_origin acota la excepcion de vigencia del cupon.';

REVOKE ALL ON FUNCTION public.create_sales_transaction(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction(uuid, jsonb, text)
  TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000030', 'pos_offline_ticket_idempotency')
ON CONFLICT DO NOTHING;
