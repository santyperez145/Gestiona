-- D4 / Límite de ventas por plan: una venta es una transacción comercial,
-- no una fila de `sales`. Un mismo carrito, pedido de tienda o pedido de
-- MercadoLibre puede tener varios renglones y debe consumir un solo cupo.
--
-- Las filas históricas no se agrupan a posteriori: no hay evidencia suficiente
-- para distinguir dos tickets de dos renglones cargados separados. El medidor
-- empieza con estas transacciones hacia adelante, en vez de inventar consumo.

CREATE TABLE IF NOT EXISTS public.sale_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_transactions_source_check CHECK (source = ANY (ARRAY[
    'manual'::text,
    'pos'::text,
    'tiendanube'::text,
    'tienda_online'::text,
    'mercadolibre'::text,
    'api'::text,
    'presupuesto'::text
  ]))
);

ALTER TABLE public.sale_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read sale transactions" ON public.sale_transactions;
CREATE POLICY "Org members read sale transactions" ON public.sale_transactions
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

CREATE INDEX IF NOT EXISTS sale_transactions_org_created_idx
  ON public.sale_transactions (org_id, created_at DESC);

COMMENT ON TABLE public.sale_transactions IS
  'Unidad comercial de consumo del plan. Una transacción agrupa los renglones de una compra sin sustituir el libro detallado de sales.';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_transaction_id uuid
  REFERENCES public.sale_transactions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS sales_sale_transaction_idx
  ON public.sales (sale_transaction_id);

COMMENT ON COLUMN public.sales.sale_transaction_id IS
  'Transacción comercial que agrupa renglones de un mismo carrito/pedido. Las ventas históricas permanecen NULL porque no se infiere una agrupación sin evidencia.';

-- Se mantiene `organization_plan_limits` sin romper sus dependientes previos.
-- Este helper interno suma la dimensión que faltaba en D4.
CREATE OR REPLACE FUNCTION public.organization_sales_plan_limit(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.max_sales_per_month
  FROM public.organizations o
  LEFT JOIN public.subscriptions s ON s.org_id = o.id
  LEFT JOIN public.plans p ON p.id = COALESCE(s.plan_id, o.plan_id)
  WHERE o.id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION public.enforce_sale_transaction_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_sales integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_used integer;
BEGIN
  -- Un mismo comercio no puede crear dos tickets concurrentes leyendo el
  -- mismo contador. La cerradura dura sólo la transacción de alta.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sale-plan:' || NEW.org_id::text)
  );

  SELECT public.organization_sales_plan_limit(NEW.org_id)
    INTO v_max_sales;
  IF v_max_sales IS NULL THEN
    RETURN NEW;
  END IF;

  -- El plan mensual sigue el mes comercial argentino, no un cambio de día UTC.
  v_period_start := date_trunc(
    'month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'
  ) AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_period_end := v_period_start + interval '1 month';

  SELECT count(*) INTO v_used
  FROM public.sale_transactions
  WHERE org_id = NEW.org_id
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_used >= v_max_sales THEN
    RAISE EXCEPTION
      'Límite de % ventas/mes alcanzado para esta organización. Cambiá de plan para registrar otra venta.',
      v_max_sales
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_transaction_plan_limit ON public.sale_transactions;
CREATE TRIGGER trg_enforce_sale_transaction_plan_limit
BEFORE INSERT ON public.sale_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_transaction_plan_limit();

-- Todo INSERT en `sales`, incluso los que vienen de una Function de canal,
-- recibe una transacción. El identificador que llegue desde el navegador se
-- ignora: sólo el contexto de la transacción SQL o el pedido de tienda puede
-- agrupar renglones. Así un POST manual no puede reutilizar un ticket viejo
-- para eludir el límite.
CREATE OR REPLACE FUNCTION public.assign_sale_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context text;
  v_transaction_id uuid;
  v_parent record;
BEGIN
  IF NEW.ecommerce_order_id IS NOT NULL THEN
    -- Una orden propia ya es el identificador estable de la transacción.
    v_transaction_id := NEW.ecommerce_order_id;
  ELSE
    v_context := NULLIF(current_setting('gestiona.sale_transaction_id', true), '');
    IF v_context IS NOT NULL THEN
      BEGIN
        v_transaction_id := v_context::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Contexto interno de transacción de venta inválido';
      END;
    ELSE
      v_transaction_id := gen_random_uuid();
    END IF;
  END IF;

  -- Hace que una Function que inserta varias líneas en una misma transacción
  -- (por ejemplo MercadoLibre) conserve un único ticket sin tener que recibir
  -- un id controlable por el cliente.
  PERFORM set_config('gestiona.sale_transaction_id', v_transaction_id::text, true);

  -- Evita que dos renglones del mismo INSERT multirow vuelvan a disparar el
  -- trigger del límite mediante un `ON CONFLICT`. La cerradura también cubre
  -- dos callbacks concurrentes del mismo pedido externo.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sale-transaction:' || v_transaction_id::text)
  );
  SELECT org_id, source INTO v_parent
  FROM public.sale_transactions
  WHERE id = v_transaction_id;

  IF NOT FOUND THEN
    INSERT INTO public.sale_transactions (
      id, org_id, source, created_by, occurred_at
    ) VALUES (
      v_transaction_id, NEW.org_id, COALESCE(NEW.source, 'manual'), NEW.user_id,
      COALESCE(NEW.date, now())
    );
    SELECT org_id, source INTO v_parent
    FROM public.sale_transactions
    WHERE id = v_transaction_id;
  END IF;

  IF v_parent.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'La transacción de venta pertenece a otra organización';
  END IF;
  IF v_parent.source IS DISTINCT FROM COALESCE(NEW.source, 'manual') THEN
    RAISE EXCEPTION 'La transacción de venta no coincide con el canal de la venta';
  END IF;

  NEW.sale_transaction_id := v_transaction_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_sale_transaction ON public.sales;
CREATE TRIGGER trg_assign_sale_transaction
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.assign_sale_transaction();

CREATE OR REPLACE FUNCTION public.prevent_sale_transaction_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sale_transaction_id IS DISTINCT FROM OLD.sale_transaction_id THEN
    RAISE EXCEPTION 'La transacción de una venta es inmutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sale_transaction_reassignment ON public.sales;
CREATE TRIGGER trg_prevent_sale_transaction_reassignment
BEFORE UPDATE OF sale_transaction_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.prevent_sale_transaction_reassignment();

-- La única puerta autenticada crea el padre y todos sus renglones en la misma
-- transacción. Ignora identidad, organización, canal, transacción y momento
-- de creación que vinieran en el JSON del navegador.
CREATE OR REPLACE FUNCTION public.create_sales_transaction(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_source text := lower(btrim(COALESCE(p_source, 'manual')));
  v_transaction_id uuid := gen_random_uuid();
  v_line jsonb;
  v_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_sale_ids jsonb := '[]'::jsonb;
  v_first_date timestamptz;
BEGIN
  IF v_actor_id IS NULL
     OR NOT public.has_org_role(p_org_id, v_actor_id, ARRAY['owner','admin','vendedor']) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar ventas en esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sales) = 0
     OR jsonb_array_length(p_sales) > 100 THEN
    RAISE EXCEPTION 'Una venta debe tener entre 1 y 100 renglones';
  END IF;

  -- Los conectores de tienda, marketplace y API entran como servidor y usan
  -- el trigger de `sales`; este RPC autenticado sólo representa operaciones
  -- humanas del panel. Así nadie puede fingir una venta de otro canal ni
  -- inyectar ecommerce_order_id para reagrupar una orden externa.
  IF v_source NOT IN ('manual', 'pos', 'presupuesto') THEN
    RAISE EXCEPTION 'Este canal se registra únicamente desde su integración de servidor';
  END IF;

  SELECT NULLIF((p_sales->0)->>'date', '')::timestamptz
    INTO v_first_date;

  INSERT INTO public.sale_transactions (
    id, org_id, source, created_by, occurred_at
  ) VALUES (
    v_transaction_id, p_org_id, v_source, v_actor_id, COALESCE(v_first_date, now())
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
      RAISE EXCEPTION 'Cada renglón necesita un producto y una cantidad mayor a cero';
    END IF;

    INSERT INTO public.sales
    SELECT (v_sale).*
    RETURNING id INTO v_sale_id;

    v_sale_ids := v_sale_ids || to_jsonb(v_sale_id);
  END LOOP;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'sale_ids', v_sale_ids,
    'lines', jsonb_array_length(v_sale_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_plan_usage(p_org_id uuid)
RETURNS TABLE (
  max_sales_per_month integer,
  sales_used integer,
  sales_remaining integer,
  period_start timestamptz,
  period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_sales integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  period_start := date_trunc(
    'month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'
  ) AT TIME ZONE 'America/Argentina/Buenos_Aires';
  period_end := period_start + interval '1 month';
  SELECT public.organization_sales_plan_limit(p_org_id) INTO v_max_sales;

  SELECT count(*) INTO sales_used
  FROM public.sale_transactions
  WHERE org_id = p_org_id
    AND created_at >= period_start
    AND created_at < period_end;

  max_sales_per_month := v_max_sales;
  sales_remaining := CASE
    WHEN v_max_sales IS NULL THEN NULL
    ELSE GREATEST(v_max_sales - sales_used, 0)
  END;
  RETURN NEXT;
END;
$$;

-- Cerrar el bypass: las ventas nuevas entran por el RPC o por Functions de
-- servidor. Owner/admin conserva UPDATE y DELETE para correcciones trazables.
DROP POLICY IF EXISTS "Org members create sales" ON public.sales;

REVOKE ALL ON FUNCTION public.organization_sales_plan_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_sale_transaction_plan_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_sale_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_sale_transaction_reassignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_sales_plan_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_plan_usage(uuid) TO authenticated;

-- Verificación real: dos renglones de POS y dos de una importación de canal
-- consumen dos tickets, no cuatro. Prueba el RPC con JWT, el bloqueo del
-- insert directo, la inmutabilidad y deja los productos/stock ZZ sin restos.
CREATE TEMP TABLE IF NOT EXISTS zz_sale_transaction_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_sale_transaction_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_user_id uuid;
  v_plan_id uuid;
  v_org_id uuid;
  v_product_a uuid;
  v_product_b uuid;
  v_first_sale_id uuid;
  v_transaction_count integer;
  v_sales_count integer;
  v_shared_transaction boolean;
  v_usage integer;
  v_direct_blocked boolean := false;
  v_limit_blocked boolean := false;
  v_reassignment_blocked boolean := false;
  v_can_create boolean;
  v_can_usage boolean;
  v_result jsonb;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'D4 necesita un usuario existente para verificar transacciones de venta';
  END IF;

  INSERT INTO public.plans (
    code, name, description, price_usd_monthly, price_usd_yearly,
    max_products, max_sales_per_month, max_users,
    ai_enabled, backups_enabled, custom_branding, active, sort_order
  ) VALUES (
    'zz-sale-transaction-' || v_suffix, 'ZZ transacciones de venta',
    'Sólo para verificar D4', 0, 0, NULL, 2, NULL,
    false, false, false, false, 999998
  ) RETURNING id INTO v_plan_id;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id)
  VALUES ('ZZ transacciones de venta', 'zz-sale-transaction-' || v_suffix, v_user_id, v_plan_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.products (org_id, user_id, name, stock)
  VALUES (v_org_id, v_user_id, 'ZZ transacción A', 10)
  RETURNING id INTO v_product_a;
  INSERT INTO public.products (org_id, user_id, name, stock)
  VALUES (v_org_id, v_user_id, 'ZZ transacción B', 10)
  RETURNING id INTO v_product_b;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.create_sales_transaction(
    v_org_id,
    jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'product_id', v_product_a,
        'product_name', 'ZZ transacción A', 'quantity', 1, 'unit_price_ars', 100,
        'total_ars', 100, 'date', now(), 'paid', true, 'payment_method', 'efectivo'),
      jsonb_build_object('id', gen_random_uuid(), 'product_id', v_product_b,
        'product_name', 'ZZ transacción B', 'quantity', 2, 'unit_price_ars', 100,
        'total_ars', 200, 'date', now(), 'paid', true, 'payment_method', 'efectivo')
    ),
    'pos'
  ) INTO v_result;
  SELECT sales_used INTO v_usage FROM public.get_sales_plan_usage(v_org_id);

  BEGIN
    INSERT INTO public.sales (
      org_id, user_id, product_name, quantity, unit_price_ars, total_ars, source
    ) VALUES (
      v_org_id, v_user_id, 'ZZ directo bloqueado', 1, 1, 1, 'pos'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_blocked := true;
  END;
  EXECUTE 'RESET ROLE';

  SELECT count(*), count(DISTINCT sale_transaction_id), min(id::text)::uuid
    INTO v_sales_count, v_transaction_count, v_first_sale_id
  FROM public.sales
  WHERE org_id = v_org_id;

  IF v_sales_count <> 2 OR v_transaction_count <> 1 OR v_usage <> 1
     OR jsonb_array_length(v_result->'sale_ids') <> 2 THEN
    RAISE EXCEPTION 'El carrito POS no quedó como una sola transacción: ventas %, transacciones %, uso %',
      v_sales_count, v_transaction_count, v_usage;
  END IF;

  -- Simula una Function de canal: su operación SQL inserta dos renglones y el
  -- trigger les conserva la misma transacción, como hace la importación de ML.
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (
    org_id, user_id, product_id, product_name, quantity, unit_price_ars,
    total_ars, source, paid, payment_method
  ) VALUES
    (v_org_id, v_user_id, v_product_a, 'ZZ transacción A', 1, 100, 100, 'mercadolibre', true, 'mercadolibre'),
    (v_org_id, v_user_id, v_product_b, 'ZZ transacción B', 1, 100, 100, 'mercadolibre', true, 'mercadolibre');

  SELECT count(*) INTO v_transaction_count
  FROM public.sales
  WHERE org_id = v_org_id AND source = 'mercadolibre';

  -- El conteo de distintos es la comprobación portable de que ambas líneas
  -- quedaron en el mismo ticket de canal.
  SELECT count(DISTINCT sale_transaction_id) = 1
    INTO v_shared_transaction
  FROM public.sales
  WHERE org_id = v_org_id AND source = 'mercadolibre';

  IF v_transaction_count <> 2 OR NOT v_shared_transaction THEN
    RAISE EXCEPTION 'Las líneas de canal no se agruparon en una transacción';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.create_sales_transaction(
      v_org_id,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product_a, 'product_name', 'ZZ transacción A',
        'quantity', 1, 'unit_price_ars', 100, 'total_ars', 100
      )),
      'pos'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_limit_blocked := true;
  END;

  BEGIN
    UPDATE public.sales
    SET sale_transaction_id = gen_random_uuid()
    WHERE id = v_first_sale_id;
  EXCEPTION WHEN check_violation THEN
    v_reassignment_blocked := true;
  END;
  EXECUTE 'RESET ROLE';

  SELECT has_function_privilege(
    'anon', 'public.create_sales_transaction(uuid,jsonb,text)', 'EXECUTE'
  ) INTO v_can_create;
  SELECT has_function_privilege(
    'anon', 'public.get_sales_plan_usage(uuid)', 'EXECUTE'
  ) INTO v_can_usage;

  IF NOT (v_direct_blocked AND v_limit_blocked AND v_reassignment_blocked)
     OR v_can_create OR v_can_usage THEN
    RAISE EXCEPTION 'D4 dejó un bypass: directo %, límite %, reasignación %, anon create %, anon usage %',
      v_direct_blocked, v_limit_blocked, v_reassignment_blocked, v_can_create, v_can_usage;
  END IF;

  DELETE FROM public.sales WHERE org_id = v_org_id;
  DELETE FROM public.organizations WHERE id = v_org_id;
  DELETE FROM public.plans WHERE id = v_plan_id;

  IF EXISTS (SELECT 1 FROM public.sales WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.sale_transactions WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.plans WHERE id = v_plan_id) THEN
    RAISE EXCEPTION 'D4 dejó restos ZZ de transacciones de venta';
  END IF;

  INSERT INTO zz_sale_transaction_verification (check_name, passed, detail)
  VALUES
    ('transacciones', true, 'POS y canal agrupan renglones sin contar por línea'),
    ('autoridad', true, 'RPC, RLS, límite e inmutabilidad verificados'),
    ('zz_restos', true, 'sin restos de verificación');
END;
$verify$;

SELECT check_name, detail, passed
FROM zz_sale_transaction_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000004', 'sale_transactions_plan_limit') ON CONFLICT DO NOTHING;
